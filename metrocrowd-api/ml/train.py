# ══════════════════════════════════════════════════════════════
#  ml/train.py  v2
#  Trains TWO models from Supabase data:
#
#  1. crowd_model.pkl      — XGBoost crowd % predictor
#     Features: hour, dow, weekend, holiday, line, station stats
#     Data: crowd_reports + trip_events (real observed crowd at station)
#
#  2. travel_time_model.pkl — XGBoost inter-station travel time predictor
#     Features: hour, dow, weekend, line, segment heat
#     Data: trip_events (real GPS-confirmed arrival times)
#
#  Scheduler calls train() every 6h if enough new data.
# ══════════════════════════════════════════════════════════════
import os, pickle, logging
import numpy as np
import pandas as pd
import xgboost as xgb
from datetime import datetime, timezone
from supabase import create_client
from ml.model import save_model, save_travel_model

logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

LINE_ENCODE = {
    "Y":0, "B":1, "R":2, "G":3, "V":4,
    "A":5, "P":6, "M":7, "Gr":8, "Aq":9
}

def _client():
    return create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Fetch crowd_reports ───────────────────────────────────────
def fetch_crowd_reports() -> pd.DataFrame:
    resp = _client().table("crowd_reports") \
        .select("station_id,line_codes,crowd_value,created_at") \
        .order("created_at").execute()
    return pd.DataFrame(resp.data or [])

# ── Fetch trip_events (real GPS-confirmed crowd + timing) ─────
def fetch_trip_events() -> pd.DataFrame:
    resp = _client().table("trip_events") \
        .select("station_id,line_code,crowd_pct,seconds_from_prev,"
                "hour_of_day,day_of_week,is_weekend,arrived_at") \
        .not_.is_("crowd_pct", "null") \
        .order("arrived_at").execute()
    return pd.DataFrame(resp.data or [])

# ── Fetch real segment travel times ───────────────────────────
def fetch_segment_events() -> pd.DataFrame:
    """Events with confirmed inter-station timing."""
    resp = _client().table("trip_events") \
        .select("station_id,line_code,seconds_from_prev,"
                "hour_of_day,day_of_week,is_weekend") \
        .not_.is_("seconds_from_prev", "null") \
        .gte("seconds_from_prev", 60) \
        .lte("seconds_from_prev", 600) \
        .execute()
    return pd.DataFrame(resp.data or [])

# ── Train crowd model ─────────────────────────────────────────
def train_crowd_model(reports_df: pd.DataFrame, events_df: pd.DataFrame):
    logger.info("[Train] Building crowd model…")

    frames = []

    # Source 1: manual crowd_reports
    if len(reports_df) >= 10:
        df = reports_df.copy()
        df["created_at"] = pd.to_datetime(df["created_at"])
        df["hour"]       = df["created_at"].dt.hour
        df["dow"]        = df["created_at"].dt.dayofweek
        df["is_weekend"] = (df["dow"] >= 5).astype(int)
        df["line_enc"]   = df["line_codes"].apply(
            lambda lc: LINE_ENCODE.get(lc[0] if isinstance(lc, list) and lc else "", 0))
        df["target"]     = df["crowd_value"]
        df["weight"]     = 1.0          # base weight for user reports
        frames.append(df[["station_id","hour","dow","is_weekend","line_enc","target","weight"]])

    # Source 2: real GPS trip events (higher weight — actual observations)
    if len(events_df) >= 5:
        df2 = events_df.copy()
        df2["hour"]      = df2["hour_of_day"]
        df2["dow"]       = df2["day_of_week"]
        df2["line_enc"]  = df2["line_code"].apply(lambda l: LINE_ENCODE.get(l or "", 0))
        df2["target"]    = df2["crowd_pct"]
        df2["weight"]    = 1.8          # GPS-confirmed → higher trust
        frames.append(df2[["station_id","hour","dow","is_weekend","line_enc","target","weight"]])

    if not frames:
        logger.warning("[Train] No crowd data. Skipping crowd model.")
        return

    combined = pd.concat(frames, ignore_index=True).dropna(subset=["target"])

    if len(combined) < 50:
        logger.warning(f"[Train] Only {len(combined)} crowd rows. Need ≥50. Skipping.")
        return

    # Station features
    counts      = combined["station_id"].value_counts(normalize=True)
    combined["station_importance"] = combined["station_id"].map(counts)
    hist_avg    = combined.groupby("station_id")["target"].mean()
    combined["historical_avg"] = combined["station_id"].map(hist_avg)
    recent      = combined.sort_values("hour").groupby("station_id").tail(10)
    recent_avg  = recent.groupby("station_id")["target"].mean()
    combined["recent_avg"] = combined["station_id"].map(recent_avg).fillna(combined["historical_avg"])

    FEATURES = ["hour","dow","is_weekend","line_enc",
                "station_importance","historical_avg","recent_avg"]
    X = combined[FEATURES].values
    y = combined["target"].values
    w = combined["weight"].values

    model = xgb.XGBRegressor(
        n_estimators=300, max_depth=6, learning_rate=0.04,
        subsample=0.8, colsample_bytree=0.8,
        objective="reg:squarederror", random_state=42
    )
    model.fit(X, y, sample_weight=w)
    save_model(model)
    logger.info(f"[Train] Crowd model trained on {len(combined)} rows "
                f"({len(reports_df)} reports + {len(events_df)} trip events). Saved.")

# ── Train travel time model ───────────────────────────────────
def train_travel_time_model(seg_df: pd.DataFrame):
    logger.info("[Train] Building travel time model…")

    if len(seg_df) < 30:
        logger.warning(f"[Train] Only {len(seg_df)} segment rows. Need ≥30. Skipping travel model.")
        return

    df = seg_df.copy().dropna(subset=["seconds_from_prev"])
    df["line_enc"]  = df["line_code"].apply(lambda l: LINE_ENCODE.get(l or "", 1))

    # Station pair heat: how often does this station appear (proxy for busy-ness)
    counts = df["station_id"].value_counts(normalize=True)
    df["station_heat"] = df["station_id"].map(counts).fillna(0)

    FEATURES = ["hour_of_day","day_of_week","is_weekend","line_enc","station_heat"]
    TARGET   = "seconds_from_prev"

    X = df[FEATURES].values.astype(float)
    y = df[TARGET].values.astype(float)

    model = xgb.XGBRegressor(
        n_estimators=200, max_depth=4, learning_rate=0.05,
        subsample=0.8, colsample_bytree=0.8,
        objective="reg:squarederror", random_state=42
    )
    model.fit(X, y)
    save_travel_model(model)
    logger.info(f"[Train] Travel time model trained on {len(df)} segment rows. Saved.")

# ── Main entry ────────────────────────────────────────────────
def train():
    logger.info("[Train] Starting training pipeline…")
    reports_df  = fetch_crowd_reports()
    events_df   = fetch_trip_events()
    seg_df      = fetch_segment_events()

    logger.info(f"[Train] Data: {len(reports_df)} crowd reports, "
                f"{len(events_df)} trip crowd events, "
                f"{len(seg_df)} segment timing events")

    train_crowd_model(reports_df, events_df)
    train_travel_time_model(seg_df)

    logger.info("[Train] Pipeline complete.")

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    train()
