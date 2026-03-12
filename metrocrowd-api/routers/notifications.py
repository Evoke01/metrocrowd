# ══════════════════════════════════════════════════════════════
#  routers/notifications.py
#  GET  /notifications/prefs         — get user's prefs
#  POST /notifications/prefs         — save user's prefs
#  POST /notifications/test          — send a test push right now
# ══════════════════════════════════════════════════════════════
import os, logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
from supabase import create_client

router = APIRouter()
logger = logging.getLogger(__name__)
SB_URL = os.environ["SUPABASE_URL"]
SB_KEY = os.environ["SUPABASE_KEY"]

def _db(): return create_client(SB_URL, SB_KEY)

class PrefsModel(BaseModel):
    user_id:           str
    morning_brief:     bool = True
    beat_the_rush:     bool = True
    crowd_drop:        bool = True
    weekly_digest:     bool = True
    streak_reminder:   bool = True
    network_alert:     bool = True
    home_station:      Optional[str] = None
    drop_threshold:    int = 45
    quiet_start:       int = 22
    quiet_end:         int = 7
    morning_peak_hour: int = 8
    evening_peak_hour: int = 18

class TestReq(BaseModel):
    user_id: str
    type:    str = "morning_brief"

@router.get("/prefs")
async def get_prefs(user_id: str):
    db = _db()
    r = db.table("notification_prefs").select("*").eq("user_id", user_id).execute()
    return {"ok": True, "prefs": r.data[0] if r.data else {}}

@router.post("/prefs")
async def save_prefs(req: PrefsModel):
    db = _db()
    data = req.dict()
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    try:
        db.table("notification_prefs").upsert(data, on_conflict="user_id").execute()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))

@router.post("/test")
async def test_notif(req: TestReq):
    from push.engine import NotificationEngine
    engine = NotificationEngine()
    await engine.send_test(req.user_id, req.type)
    return {"ok": True}
