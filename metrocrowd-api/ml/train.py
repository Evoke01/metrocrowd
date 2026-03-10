# ══════════════════════════════════════════════════════════════
#  ml/train.py
#  Pulls crowd_reports from Supabase, trains XGBoost, saves model.
#  Run manually: python -m ml.train
#  Or called by scheduler every 24h.
# ══════════════════════════════════════════════════════════════
import os, pickle
import numpy as np
import pandas as pd
import xgboost as xgb
from datetime import datetime
from supabase import create_client
from ml.model import build_features, save_model

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

def fetch_training_data() -> pd.DataFrame:
    """Pull all crowd reports from Supabase."""
    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    resp = client.table("crowd_reports") \
        .select("station_id,line_codes,crowd_value,created_at") \
        .order("created_at") \
        .execute()
    return pd.DataFrame(resp.data)

def train():
    print("[Train] Fetching data from Supabase…")
    df = fetch_training_data()

    if len(df) < 50:
        print(f"[Train] Not enough data ({len(df)} rows). Need ≥ 50. Skipping.")
        return

    df["created_at"] = pd.to_datetime(df["created_at"])
    df["hour"]       = df["created_at"].dt.hour
    df["dow"]        = df["created_at"].dt.dayofweek
    df["is_weekend"] = (df["dow"] >= 5).astype(int)
    df["is_holiday"] = 0  # TODO: integrate Indian holiday calendar

    LINE_ENCODE = {
        "Yellow": 0, "Blue": 1, "Red": 2, "Green": 3,
        "Violet": 4, "Orange": 5, "Pink": 6, "Magenta": 7,
        "Grey": 8, "Rapid": 9, "Aqua": 10
    }

    # Use first line code per report
    df["line_enc"] = df["line_codes"].apply(
        lambda lc: LINE_ENCODE.get(lc[0] if isinstance(lc, list) and lc else "", 0)
    )

    # Station importance: how often it appears in reports (normalised)
    counts = df["station_id"].value_counts(normalize=True)
    df["station_importance"] = df["station_id"].map(counts)

    # Historical avg per station
    hist_avg = df.groupby("station_id")["crowd_value"].mean()
    df["historical_avg"] = df["station_id"].map(hist_avg)

    # Recent avg (last 10 reports per station)
    recent = df.sort_values("created_at").groupby("station_id").tail(10)
    recent_avg = recent.groupby("station_id")["crowd_value"].mean()
    df["recent_avg"] = df["station_id"].map(recent_avg).fillna(df["historical_avg"])

    FEATURES = ["hour","dow","is_weekend","is_holiday","line_enc",
                "station_importance","historical_avg","recent_avg"]
    TARGET   = "crowd_value"

    X = df[FEATURES].values
    y = df[TARGET].values

    model = xgb.XGBRegressor(
        n_estimators=200, max_depth=5, learning_rate=0.05,
        subsample=0.8, colsample_bytree=0.8,
        objective="reg:squarederror", random_state=42
    )
    model.fit(X, y)
    save_model(model)
    print(f"[Train] Model trained on {len(df)} rows. Saved to ml/crowd_model.pkl")

if __name__ == "__main__":
    train()
