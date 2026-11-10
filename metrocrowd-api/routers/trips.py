# ══════════════════════════════════════════════════════════════
#  routers/trips.py
#  POST /trips/session/start   — open a new trip session
#  POST /trips/session/end     — close session with final stats
#  POST /trips/event           — log a station arrival event
#  GET  /trips/stats           — aggregate travel time stats (for API consumers)
# ══════════════════════════════════════════════════════════════
import os, logging
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from supabase import create_client
from middleware.auth import require_supabase_user

router = APIRouter()
logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
IST = ZoneInfo("Asia/Kolkata")

def _client():
    return create_client(SUPABASE_URL, SUPABASE_KEY)

def _verified_user_id(claims: dict) -> str:
    if claims.get("is_anonymous") or not claims.get("email"):
        raise HTTPException(status_code=401, detail="Sign in to record a commute")
    try:
        return str(UUID(claims["sub"]))
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid account token")

# ── Request schemas ───────────────────────────────────────────
class SessionStartReq(BaseModel):
    from_station:     str
    to_station:       str
    line_codes:       List[str] = Field(default_factory=list)
    path_station_ids: List[str] = Field(min_length=2, max_length=501)
    total_stops:      int = Field(ge=0, le=500)
    est_duration_sec: int = Field(gt=0, le=86400)

class SessionEndReq(BaseModel):
    session_id:          str
    actual_duration_sec: int = Field(gt=0, le=86400)
    stops_tracked:       int = Field(ge=0, le=500)
    completed:           bool = True

class TripEventReq(BaseModel):
    session_id:       str
    station_id:       str
    station_index:    int = Field(ge=0, le=500)
    line_code:        Optional[str] = None
    seconds_from_prev: Optional[int] = Field(default=None, ge=0, le=86400)
    crowd_pct:        Optional[int] = Field(default=None, ge=0, le=100)

# ── Endpoints ─────────────────────────────────────────────────
@router.post("/session/start")
async def start_session(req: SessionStartReq, claims: dict = Depends(require_supabase_user)):
    user_id = _verified_user_id(claims)
    if req.total_stops != len(req.path_station_ids) - 1:
        raise HTTPException(status_code=400, detail="Route stop count does not match its station path")
    if req.path_station_ids[0] != req.from_station or req.path_station_ids[-1] != req.to_station:
        raise HTTPException(status_code=400, detail="Route endpoints do not match its station path")
    if any(not station_id.strip() for station_id in req.path_station_ids):
        raise HTTPException(status_code=400, detail="Route contains an invalid station")
    now = datetime.now(timezone.utc)
    local_now = now.astimezone(IST)
    row = {
        "user_id":          user_id,
        "from_station":     req.from_station,
        "to_station":       req.to_station,
        "line_codes":       req.line_codes,
        "path_station_ids": req.path_station_ids,
        "total_stops":      req.total_stops,
        "est_duration_sec": req.est_duration_sec,
        "started_at":       now.isoformat(),
        "day_of_week":      local_now.weekday(),
        "hour_of_day":      local_now.hour,
    }
    try:
        resp = _client().table("trip_sessions").insert(row).execute()
        session_id = resp.data[0]["id"] if resp.data else None
        if not session_id:
            raise RuntimeError("Database did not return the created trip session id")
        logger.info(f"[Trips] Session started: {session_id} {req.from_station}→{req.to_station}")
        return {"ok": True, "session_id": session_id}
    except Exception as e:
        logger.error(f"[Trips] start_session error: {e}")
        raise HTTPException(status_code=500, detail="Failed to start session")

@router.post("/session/end")
async def end_session(req: SessionEndReq, claims: dict = Depends(require_supabase_user)):
    user_id = _verified_user_id(claims)
    now = datetime.now(timezone.utc)
    try:
        db = _client()
        existing = db.table("trip_sessions").select(
            "id,user_id,started_at,total_stops,path_station_ids,ended_at"
        ).eq("id", req.session_id).eq("user_id", user_id).single().execute().data
        if not existing:
            raise HTTPException(status_code=404, detail="Trip session not found")
        if existing.get("ended_at"):
            raise HTTPException(status_code=409, detail="Trip session has already ended")

        last_event = db.table("trip_events").select("station_index,station_id") \
            .eq("session_id", req.session_id).eq("user_id", user_id) \
            .order("station_index", desc=True).limit(1).execute().data or []
        path = existing.get("path_station_ids") or []
        last_index = last_event[0]["station_index"] if last_event else -1
        at_destination = bool(
            req.completed and path and last_index == existing["total_stops"]
            and last_event[0]["station_id"] == path[-1]
        )
        started_at = datetime.fromisoformat(existing["started_at"].replace("Z", "+00:00"))
        actual_sec = max(1, min(86400, int((now - started_at).total_seconds())))
        update = {
            "ended_at": now.isoformat(),
            "actual_duration_sec": actual_sec,
            "stops_tracked": max(0, last_index + 1),
            "completed": at_destination,
        }
        result = db.table("trip_sessions").update(update).eq("id", req.session_id) \
            .eq("user_id", user_id).is_("ended_at", "null").execute()
        if not result.data:
            raise HTTPException(status_code=409, detail="Trip session could not be closed")
        if at_destination:
            try:
                db.rpc("rewards_award_completed_commute", {
                    "p_user": user_id,
                    "p_session": req.session_id,
                }).execute()
            except Exception as reward_error:
                # Commute logging must succeed even if the rewards migration is not enabled yet.
                logger.warning("[Trips] Reward award skipped for %s: %s", req.session_id, reward_error)
        logger.info("[Trips] Session ended: %s in %ss completed=%s", req.session_id, actual_sec, at_destination)
        return {"ok": True, "completed": at_destination}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Trips] end_session error: {e}")
        raise HTTPException(status_code=500, detail="Failed to end session")

@router.post("/event")
async def log_event(req: TripEventReq, claims: dict = Depends(require_supabase_user)):
    user_id = _verified_user_id(claims)
    now = datetime.now(timezone.utc)
    local_now = now.astimezone(IST)
    try:
        db = _client()
        session = db.table("trip_sessions").select("user_id,ended_at,path_station_ids") \
            .eq("id", req.session_id).eq("user_id", user_id).single().execute().data
        if not session or session.get("ended_at"):
            raise HTTPException(status_code=404, detail="Active trip session not found")
        path = session.get("path_station_ids") or []
        if req.station_index >= len(path) or path[req.station_index] != req.station_id:
            raise HTTPException(status_code=400, detail="Station does not match this route")
        existing = db.table("trip_events").select("station_id") \
            .eq("session_id", req.session_id).eq("station_index", req.station_index).limit(1).execute().data
        if existing:
            return {"ok": True, "duplicate": True}
        previous = db.table("trip_events").select("station_index") \
            .eq("session_id", req.session_id).order("station_index", desc=True).limit(1).execute().data or []
        expected_index = (previous[0]["station_index"] + 1) if previous else 0
        if req.station_index != expected_index:
            raise HTTPException(status_code=409, detail="Stations must be recorded in route order")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("[Trips] event session check failed: %s", e)
        raise HTTPException(status_code=500, detail="Could not verify trip event")

    row = {
        "session_id":        req.session_id,
        "user_id":           user_id,
        "station_id":        req.station_id,
        "station_index":     req.station_index,
        "line_code":         req.line_code,
        "seconds_from_prev": req.seconds_from_prev,
        "crowd_pct":         req.crowd_pct,
        "arrived_at":        now.isoformat(),
        "hour_of_day":       local_now.hour,
        "day_of_week":       local_now.weekday(),
        "is_weekend":        local_now.weekday() >= 5,
    }
    try:
        db.table("trip_events").insert(row).execute()
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
