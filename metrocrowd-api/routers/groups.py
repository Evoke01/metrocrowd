# ══════════════════════════════════════════════════════════════
#  routers/groups.py
#  POST /groups/create          — create a group session
#  POST /groups/join            — join via 6-char code
#  POST /groups/update-position — push my current station
#  GET  /groups/{code}          — get all members + positions
#  POST /groups/leave           — leave / end session
# ══════════════════════════════════════════════════════════════
import os, random, string, logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
from supabase import create_client

router  = APIRouter()
logger  = logging.getLogger(__name__)
SB_URL  = os.environ["SUPABASE_URL"]
SB_KEY  = os.environ["SUPABASE_KEY"]

def _db(): return create_client(SB_URL, SB_KEY)

def _code():
    """Generate a unique 6-char uppercase code."""
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))

# ── Schemas ───────────────────────────────────────────────────
class CreateReq(BaseModel):
    user_id:      str
    display_name: str
    avatar_url:   Optional[str] = None
    from_station: str
    to_station:   str
    route_path:   List[str]

class JoinReq(BaseModel):
    code:         str
    user_id:      str
    display_name: str
    avatar_url:   Optional[str] = None

class UpdatePosReq(BaseModel):
    code:            str
    user_id:         str
    current_station: str
    station_index:   int

class LeaveReq(BaseModel):
    code:    str
    user_id: str

# ── Endpoints ─────────────────────────────────────────────────
@router.post("/create")
async def create_group(req: CreateReq):
    db   = _db()
    code = _code()
    # Ensure unique
    for _ in range(5):
        exists = db.table("group_sessions").select("id").eq("id", code).execute()
        if not exists.data: break
        code = _code()

    expires = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
    try:
        db.table("group_sessions").insert({
            "id": code, "created_by": req.user_id,
            "from_station": req.from_station, "to_station": req.to_station,
            "route_path": req.route_path, "expires_at": expires,
        }).execute()
        db.table("group_members").insert({
            "session_id": code, "user_id": req.user_id,
            "display_name": req.display_name, "avatar_url": req.avatar_url,
            "current_station": req.from_station, "station_index": 0,
        }).execute()
        logger.info(f"[Groups] Created {code} by {req.user_id}")
        return {"ok": True, "code": code}
    except Exception as e:
        logger.error(f"[Groups] create error: {e}")
        raise HTTPException(500, "Failed to create group")

@router.post("/join")
async def join_group(req: JoinReq):
    db = _db()
    sess = db.table("group_sessions").select("*").eq("id", req.code.upper()) \
              .eq("active", True).execute()
    if not sess.data:
        raise HTTPException(404, "Group not found or expired")
    s = sess.data[0]
    if s["expires_at"] and datetime.fromisoformat(s["expires_at"].replace("Z","+00:00")) \
       < datetime.now(timezone.utc):
        raise HTTPException(410, "Group session has expired")
    try:
        # upsert — handles re-joining
        db.table("group_members").upsert({
            "session_id": req.code.upper(), "user_id": req.user_id,
            "display_name": req.display_name, "avatar_url": req.avatar_url,
            "current_station": s["from_station"], "station_index": 0,
            "last_seen": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="session_id,user_id").execute()
        logger.info(f"[Groups] {req.user_id} joined {req.code}")
        return {"ok": True, "session": s}
    except Exception as e:
        raise HTTPException(500, str(e))

@router.post("/update-position")
async def update_position(req: UpdatePosReq):
    db = _db()
    try:
        db.table("group_members").update({
            "current_station": req.current_station,
            "station_index":   req.station_index,
            "last_seen":       datetime.now(timezone.utc).isoformat(),
        }).eq("session_id", req.code).eq("user_id", req.user_id).execute()
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@router.get("/{code}")
async def get_group(code: str):
    db = _db()
    sess = db.table("group_sessions").select("*").eq("id", code.upper()).execute()
    if not sess.data:
        raise HTTPException(404, "Group not found")
    members = db.table("group_members").select("*") \
                .eq("session_id", code.upper()).execute()
    return {"ok": True, "session": sess.data[0], "members": members.data or []}

@router.post("/leave")
async def leave_group(req: LeaveReq):
    db = _db()
    try:
        db.table("group_members").delete() \
          .eq("session_id", req.code).eq("user_id", req.user_id).execute()
        # If creator leaves, deactivate session
        sess = db.table("group_sessions").select("created_by") \
                 .eq("id", req.code).execute()
        if sess.data and sess.data[0]["created_by"] == req.user_id:
            db.table("group_sessions").update({"active": False}) \
              .eq("id", req.code).execute()
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}
