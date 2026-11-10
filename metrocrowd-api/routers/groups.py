# ══════════════════════════════════════════════════════════════
#  routers/groups.py
#  POST /groups/create          — create a group session
#  POST /groups/join            — join via 6-char code
#  POST /groups/update-position — push my current station
#  GET  /groups/{code}          — get all members + positions
#  POST /groups/leave           — leave / end session
# ══════════════════════════════════════════════════════════════
import os, secrets, string, logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime, timezone, timedelta
from supabase import create_client, Client
from functools import lru_cache

router = APIRouter()
logger = logging.getLogger(__name__)

# ── Singleton DB client (not a new client per request) ────────
@lru_cache(maxsize=1)
def _db() -> Client:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_KEY"]
    return create_client(url, key)

# ── Helpers ───────────────────────────────────────────────────
def _new_code() -> str:
    """Generate a 6-char uppercase alphanumeric code."""
    return ''.join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(6))

def _unique_code() -> str:
    """Keep generating until we get one not in use."""
    db = _db()
    for _ in range(10):
        code = _new_code()
        exists = db.table("group_sessions").select("id").eq("id", code).execute()
        if not exists.data:
            return code
    raise HTTPException(500, "Could not generate unique code — try again")

def _parse_dt(val: str) -> datetime:
    """Parse ISO datetime string safely, with or without Z."""
    parsed = datetime.fromisoformat(val.replace("Z", "+00:00"))
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _expires() -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()

# ── Schemas ───────────────────────────────────────────────────
class CreateReq(BaseModel):
    user_id:      str
    display_name: str
    avatar_url:   Optional[str] = None
    from_station: str
    to_station:   str
    route_path:   List[str]

    @field_validator("display_name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("display_name cannot be empty")
        return v[:40]   # cap length

    @field_validator("route_path")
    @classmethod
    def path_not_empty(cls, v: List[str]) -> List[str]:
        if not v:
            raise ValueError("route_path must have at least one station")
        return v

class JoinReq(BaseModel):
    code:         str
    user_id:      str
    display_name: str
    avatar_url:   Optional[str] = None

    @field_validator("code")
    @classmethod
    def normalise_code(cls, v: str) -> str:
        v = v.strip().upper()
        if len(v) != 6:
            raise ValueError("code must be exactly 6 characters")
        return v

    @field_validator("display_name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("display_name cannot be empty")
        return v[:40]

class UpdatePosReq(BaseModel):
    code:            str
    user_id:         str
    current_station: str
    station_index:   int

    @field_validator("code")
    @classmethod
    def normalise_code(cls, v: str) -> str:
        v = v.strip().upper()
        if len(v) != 6:
            raise ValueError("code must be exactly 6 characters")
        return v

    @field_validator("station_index")
    @classmethod
    def index_non_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("station_index must be >= 0")
        return v

class LeaveReq(BaseModel):
    code:    str
    user_id: str

    @field_validator("code")
    @classmethod
    def normalise_code(cls, v: str) -> str:
        v = v.strip().upper()
        if len(v) != 6:
            raise ValueError("code must be exactly 6 characters")
        return v

# ── Endpoints ─────────────────────────────────────────────────
@router.post("/create")
async def create_group(req: CreateReq):
    code = None
    try:
        db   = _db()
        code = _unique_code()

        db.table("group_sessions").insert({
            "id":           code,
            "created_by":   req.user_id,
            "from_station": req.from_station,
            "to_station":   req.to_station,
            "route_path":   req.route_path,
            "active":       True,           # FIX: was missing — caused join to fail
            "expires_at":   _expires(),
        }).execute()
        try:
            db.table("group_members").insert({
                "session_id":      code,
                "user_id":         req.user_id,
                "display_name":    req.display_name,
                "avatar_url":      req.avatar_url,
                "current_station": req.from_station,
                "station_index":   0,
                "last_seen":       _now(),
            }).execute()
        except Exception:
            # Avoid leaving an active session that has no creator member.
            db.table("group_sessions").delete().eq("id", code).execute()
            raise

        logger.info(f"[Groups] Created {code} by {req.user_id}")
        return {"ok": True, "code": code}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Groups] create error: {e}", exc_info=True)
        raise HTTPException(500, f"Failed to create group: {str(e)}")


@router.post("/join")
async def join_group(req: JoinReq):
    db = _db()

    sess = db.table("group_sessions") \
             .select("*") \
             .eq("id", req.code) \
             .eq("active", True) \
             .execute()

    if not sess.data:
        raise HTTPException(404, "Group not found or already ended")

    s = sess.data[0]

    # FIX: safe expiry check
    if s.get("expires_at"):
        expires_at = _parse_dt(s["expires_at"])
        if expires_at < datetime.now(timezone.utc):
            raise HTTPException(410, "Group session has expired")

    try:
        db.table("group_members").upsert({
            "session_id":      req.code,
            "user_id":         req.user_id,
            "display_name":    req.display_name,
            "avatar_url":      req.avatar_url,
            "current_station": s["from_station"],
            "station_index":   0,
            "last_seen":       _now(),
        }, on_conflict="session_id,user_id").execute()

        logger.info(f"[Groups] {req.user_id} joined {req.code}")
        return {"ok": True, "session": s}

    except Exception as e:
        logger.error(f"[Groups] join error: {e}", exc_info=True)
        raise HTTPException(500, str(e))


@router.post("/update-position")
async def update_position(req: UpdatePosReq):
    db = _db()
    try:
        sess = db.table("group_sessions").select("active,expires_at") \
            .eq("id", req.code).eq("active", True).maybe_single().execute()
        if not sess.data:
            raise HTTPException(404, "Group not found or already ended")
        if sess.data.get("expires_at") and _parse_dt(sess.data["expires_at"]) < datetime.now(timezone.utc):
            raise HTTPException(410, "Group session has expired")

        result = db.table("group_members").update({
            "current_station": req.current_station,
            "station_index":   req.station_index,
            "last_seen":       _now(),
        }).eq("session_id", req.code) \
          .eq("user_id", req.user_id) \
          .execute()

        # FIX: check if row actually existed
        if not result.data:
            raise HTTPException(404, "Member not found in this group")

        return {"ok": True}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Groups] update-position error: {e}", exc_info=True)
        raise HTTPException(500, str(e))


@router.get("/{code}")
async def get_group(code: str):
    code = code.upper().strip()
    if len(code) != 6:
        raise HTTPException(400, "Invalid group code")

    db   = _db()
    sess = db.table("group_sessions").select("*").eq("id", code).eq("active", True).execute()

    if not sess.data:
        raise HTTPException(404, "Group not found")

    session = sess.data[0]
    if session.get("expires_at") and _parse_dt(session["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(410, "Group session has expired")

    members = db.table("group_members") \
                .select("*") \
                .eq("session_id", code) \
                .execute()

    return {
        "ok":      True,
        "session": session,
        "members": members.data or [],
    }


@router.post("/leave")
async def leave_group(req: LeaveReq):
    db = _db()
    try:
        db.table("group_members") \
          .delete() \
          .eq("session_id", req.code) \
          .eq("user_id", req.user_id) \
          .execute()

        # If creator leaves → deactivate whole session
        sess = db.table("group_sessions") \
                 .select("created_by") \
                 .eq("id", req.code) \
                 .execute()

        if sess.data and sess.data[0]["created_by"] == req.user_id:
            db.table("group_sessions") \
              .update({"active": False}) \
              .eq("id", req.code) \
              .execute()
            logger.info(f"[Groups] Session {req.code} deactivated — creator left")

        return {"ok": True}

    except Exception as e:
        logger.error(f"[Groups] leave error: {e}", exc_info=True)
        raise HTTPException(500, str(e))
