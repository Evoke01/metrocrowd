# ══════════════════════════════════════════════════════════════
#  routers/stats.py
#  GET /stats/me          — personal summary stats
#  GET /stats/trips       — last 30 trips with details
#  GET /stats/monthly     — month-by-month breakdown
# ══════════════════════════════════════════════════════════════
import os, logging
from fastapi import APIRouter, Query
from supabase import create_client

router = APIRouter()
logger = logging.getLogger(__name__)
SB_URL = os.environ["SUPABASE_URL"]
SB_KEY = os.environ["SUPABASE_KEY"]

def _db(): return create_client(SB_URL, SB_KEY)

@router.get("/me")
async def my_stats(user_id: str = Query(...)):
    db = _db()
    try:
        r = db.table("user_commute_stats").select("*").eq("user_id", user_id).execute()
        return {"ok": True, "stats": r.data[0] if r.data else {}}
    except Exception as e:
        logger.error(f"[Stats] me error: {e}")
        return {"ok": False, "stats": {}}

@router.get("/trips")
async def my_trips(user_id: str = Query(...), limit: int = Query(default=30, ge=1, le=100)):
    db = _db()
    try:
        r = db.table("trip_sessions") \
            .select("id,from_station,to_station,line_codes,total_stops,"
                    "started_at,ended_at,actual_duration_sec,est_duration_sec,"
                    "completed,stops_tracked,hour_of_day,day_of_week") \
            .eq("user_id", user_id) \
            .order("started_at", desc=True) \
            .limit(limit) \
            .execute()
        return {"ok": True, "trips": r.data or []}
    except Exception as e:
        return {"ok": False, "trips": []}

@router.get("/monthly")
async def monthly_stats(user_id: str = Query(...)):
    db = _db()
    try:
        r = db.table("user_monthly_stats").select("*") \
            .eq("user_id", user_id).order("month", desc=True).limit(6).execute()
        return {"ok": True, "monthly": r.data or []}
    except Exception as e:
        return {"ok": False, "monthly": []}
