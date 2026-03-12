# ══════════════════════════════════════════════════════════════
#  routers/trips.py
#  POST /trips/session/start   — open a new trip session
#  POST /trips/session/end     — close session with final stats
#  POST /trips/event           — log a station arrival event
#  GET  /trips/stats           — aggregate travel time stats (for API consumers)
# ══════════════════════════════════════════════════════════════
import os, logging
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
from supabase import create_client

router = APIRouter()
logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

def _client():
    return create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Request schemas ───────────────────────────────────────────
class SessionStartReq(BaseModel):
    user_id:          Optional[str] = None
    from_station:     str
    to_station:       str
    line_codes:       List[str] = []
    total_stops:      int
    est_duration_sec: int

class SessionEndReq(BaseModel):
    session_id:          str
    actual_duration_sec: int
    stops_tracked:       int
    completed:           bool = True

class TripEventReq(BaseModel):
    session_id:       str
    user_id:          Optional[str] = None
    station_id:       str
    station_index:    int
    line_code:        Optional[str] = None
    seconds_from_prev: Optional[int] = None
    crowd_pct:        Optional[int] = None

# ── Endpoints ─────────────────────────────────────────────────
@router.post("/session/start")
async def start_session(req: SessionStartReq):
    now = datetime.now(timezone.utc)
    row = {
        "user_id":          req.user_id,
        "from_station":     req.from_station,
        "to_station":       req.to_station,
        "line_codes":       req.line_codes,
        "total_stops":      req.total_stops,
        "est_duration_sec": req.est_duration_sec,
        "started_at":       now.isoformat(),
        "day_of_week":      now.weekday(),
        "hour_of_day":      now.hour,
    }
    try:
        resp = _client().table("trip_sessions").insert(row).execute()
        session_id = resp.data[0]["id"] if resp.data else None
        logger.info(f"[Trips] Session started: {session_id} {req.from_station}→{req.to_station}")
        return {"ok": True, "session_id": session_id}
    except Exception as e:
        logger.error(f"[Trips] start_session error: {e}")
        raise HTTPException(status_code=500, detail="Failed to start session")

@router.post("/session/end")
async def end_session(req: SessionEndReq):
    now = datetime.now(timezone.utc)
    update = {
        "ended_at":            now.isoformat(),
        "actual_duration_sec": req.actual_duration_sec,
        "stops_tracked":       req.stops_tracked,
        "completed":           req.completed,
    }
    try:
        _client().table("trip_sessions").update(update).eq("id", req.session_id).execute()
        logger.info(f"[Trips] Session ended: {req.session_id} in {req.actual_duration_sec}s")
        return {"ok": True}
    except Exception as e:
        logger.error(f"[Trips] end_session error: {e}")
        raise HTTPException(status_code=500, detail="Failed to end session")

@router.post("/event")
async def log_event(req: TripEventReq):
    now = datetime.now(timezone.utc)
    row = {
        "session_id":        req.session_id,
        "user_id":           req.user_id,
        "station_id":        req.station_id,
        "station_index":     req.station_index,
        "line_code":         req.line_code,
        "seconds_from_prev": req.seconds_from_prev,
        "crowd_pct":         req.crowd_pct,
        "arrived_at":        now.isoformat(),
        "hour_of_day":       now.hour,
        "day_of_week":       now.weekday(),
        "is_weekend":        now.weekday() >= 5,
    }
    try:
        _client().table("trip_events").insert(row).execute()
        return {"ok": True}
    except Exception as e:
        logger.error(f"[Trips] log_event error: {e}")
        # Don't fail the user's navigation — silently absorb
        return {"ok": False, "error": str(e)}

@router.get("/stats")
async def trip_stats(from_station: str, to_station: str, line: Optional[str] = None):
    """Return real measured travel time between two stations."""
    try:
        q = _client().table("trip_segment_stats") \
            .select("*") \
            .eq("from_station", from_station) \
            .eq("to_station", to_station)
        if line:
            q = q.eq("line_code", line)
        resp = q.order("sample_count", desc=True).limit(24).execute()
        return {"ok": True, "stats": resp.data or []}
    except Exception as e:
        return {"ok": False, "stats": []}
