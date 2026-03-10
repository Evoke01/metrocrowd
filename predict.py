# ══════════════════════════════════════════════════════════════
#  routers/predict.py
#  GET /predict/{station_id}
#  GET /predict/{station_id}/forecast
#
#  Priority:
#    1. ml_predictions table (written by worker every hour + realtime every 30s)
#    2. Live ML inference (fallback if no cached prediction)
#    3. Historical average (fallback if no model)
# ══════════════════════════════════════════════════════════════
import os
from fastapi import APIRouter, Query
from datetime import datetime
from supabase import create_client
from ml.model import predict as ml_predict

router = APIRouter()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

def _get_cached(station_id: str, hour: int, dow: int) -> dict | None:
    """Read the latest cached prediction for this station+hour from Supabase."""
    try:
        client = create_client(SUPABASE_URL, SUPABASE_KEY)
        resp = client.table("ml_predictions") \
            .select("crowd_pct,confidence,model_ver") \
            .eq("station_id", station_id) \
            .eq("hour", hour) \
            .eq("day_of_week", dow) \
            .maybe_single() \
            .execute()
        return resp.data
    except Exception:
        return None


@router.get("/{station_id}")
def predict_crowd(
    station_id: str,
    line: str            = Query(default="Yellow"),
    historical_avg: float = Query(default=40.0),
    recent_avg: float    = Query(default=40.0),
):
    """Returns crowd % for a station right now."""
    now  = datetime.now()
    hour = now.hour
    dow  = now.weekday()

    cached = _get_cached(station_id, hour, dow)
    if cached:
        return {
            "station_id": station_id,
            "crowd_pct":  cached["crowd_pct"],
            "confidence": cached["confidence"],
            "source":     f"cache:{cached['model_ver']}",
            "hour":       hour,
        }

    # Cache miss — run live inference
    result = ml_predict(station_id, line, now, historical_avg, recent_avg)
    return {"station_id": station_id, **result}


@router.get("/{station_id}/forecast")
def forecast(
    station_id: str,
    line: str             = Query(default="Yellow"),
    historical_avg: float = Query(default=40.0),
):
    """Returns 24-hour forecast array. Uses cached predictions where available."""
    now = datetime.now()
    dow = now.weekday()

    # Try to load all 24 hours from cache at once
    try:
        client = create_client(SUPABASE_URL, SUPABASE_KEY)
        resp = client.table("ml_predictions") \
            .select("hour,crowd_pct,confidence") \
            .eq("station_id", station_id) \
            .eq("day_of_week", dow) \
            .order("hour") \
            .execute()
        cached_map = {row["hour"]: row["crowd_pct"] for row in (resp.data or [])}
    except Exception:
        cached_map = {}

    hours = []
    for h in range(24):
        if h in cached_map:
            hours.append({"hour": h, "crowd_pct": cached_map[h]})
        else:
            dt = now.replace(hour=h, minute=0, second=0)
            r  = ml_predict(station_id, line, dt, historical_avg, historical_avg)
            hours.append({"hour": h, "crowd_pct": r["crowd_pct"]})

    return {"station_id": station_id, "forecast": hours}

