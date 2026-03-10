# ══════════════════════════════════════════════════════════════
#  routers/reports.py
#  GET /reports/{station_id}  — recent reports for a station
#  GET /reports/network       — recent reports network-wide
# ══════════════════════════════════════════════════════════════
import os
from fastapi import APIRouter, Query
from datetime import datetime, timedelta
from supabase import create_client

router = APIRouter()
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
EXPIRY_HOURS = 2

@router.get("/network")
def network_reports(limit: int = Query(default=30)):
    """Recent crowd reports across entire network."""
    since = (datetime.utcnow() - timedelta(hours=EXPIRY_HOURS)).isoformat()
    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    resp = client.table("crowd_reports") \
        .select("id,station_id,station_name,level,created_at") \
        .gt("created_at", since) \
        .order("created_at", desc=True) \
        .limit(limit) \
        .execute()
    return {"reports": resp.data or []}

@router.get("/{station_id}")
def station_reports(station_id: str, limit: int = Query(default=10)):
    """Recent crowd reports for a single station."""
    since = (datetime.utcnow() - timedelta(hours=EXPIRY_HOURS)).isoformat()
    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    resp = client.table("crowd_reports") \
        .select("id,station_id,station_name,level,created_at") \
        .eq("station_id", station_id) \
        .gt("created_at", since) \
        .order("created_at", desc=True) \
        .limit(limit) \
        .execute()
    return {"reports": resp.data or []}
