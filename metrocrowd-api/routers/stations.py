# ══════════════════════════════════════════════════════════════
#  routers/stations.py
#  GET /stations          — list all with latest crowd
#  GET /stations/{id}     — single station detail
#  GET /stations/nearest  — nearest station to GPS coords
# ══════════════════════════════════════════════════════════════
import os
from fastapi import APIRouter, Query
from supabase import create_client
from zoneinfo import ZoneInfo

router = APIRouter()
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
IST = ZoneInfo("Asia/Kolkata")

@router.get("/")
def list_stations():
    """All stations with their latest crowd from ml_predictions (current hour)."""
    from datetime import datetime
    now  = datetime.now(IST)
    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    resp = client.table("ml_predictions") \
        .select("station_id,crowd_pct,confidence") \
        .eq("hour", now.hour) \
        .eq("day_of_week", now.weekday()) \
        .execute()
    return {"stations": resp.data or []}

@router.get("/nearest")
def nearest(lat: float = Query(..., ge=-90, le=90),
            lon: float = Query(..., ge=-180, le=180),
            n: int = Query(default=5, ge=1, le=50)):
    """Nearest N stations to a GPS coordinate using PostGIS."""
    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    resp = client.rpc("nearest_stations", {"user_lat": lat, "user_lon": lon, "limit_n": n}).execute()
    return {"stations": resp.data or []}

@router.get("/{station_id}")
def get_station(station_id: str):
    """Single station with crowd + 24h trend."""
    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    trend = client.rpc("station_hourly_trend", {"p_station_id": station_id}).execute()
    return {"station_id": station_id, "trend": trend.data or []}
