"""App ratings and bug reports. Anyone can submit; admins review."""
import logging
import os
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from supabase import create_client

from middleware.auth import get_token_from_request, require_supabase_user
from routers.rewards import _admin_id

router = APIRouter()
logger = logging.getLogger(__name__)


def _db():
    return create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])


# Simple per-IP limit: 8 submissions per hour per instance.
_HITS: dict = defaultdict(deque)
_LIMIT, _WINDOW = 8, 3600


def _rate_limit(request: Request):
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "?")).split(",")[0].strip()
    now = time.time()
    q = _HITS[ip]
    while q and now - q[0] > _WINDOW:
        q.popleft()
    if len(q) >= _LIMIT:
        raise HTTPException(status_code=429, detail="Too many submissions. Please try again later.")
    q.append(now)


class FeedbackIn(BaseModel):
    kind: str = Field(pattern=r"^(rating|bug|idea)$")
    rating: Optional[int] = Field(default=None, ge=1, le=5)
    message: Optional[str] = Field(default=None, max_length=2000)
    page: Optional[str] = Field(default=None, max_length=120)
    device: Optional[str] = Field(default=None, max_length=300)
    app_version: Optional[str] = Field(default=None, max_length=40)


@router.post("")
async def submit_feedback(body: FeedbackIn, request: Request):
    _rate_limit(request)
    message = (body.message or "").strip() or None
    if body.kind == "rating" and not body.rating:
        raise HTTPException(status_code=400, detail="Pick a star rating")
    if body.kind != "rating" and (not message or len(message) < 3):
        raise HTTPException(status_code=400, detail="Please describe the problem")

    # Attach the account if the caller is signed in; guests are fine too.
    user_id = email = None
    if get_token_from_request(request):
        try:
            claims = require_supabase_user(request)
            if not claims.get("is_anonymous"):
                user_id, email = claims.get("sub"), claims.get("email")
        except HTTPException:
            pass

    row = {
        "kind": body.kind,
        "rating": body.rating if body.kind == "rating" else None,
        "message": message,
        "user_id": user_id,
        "email": email,
        "page": body.page,
        "device": body.device,
        "app_version": body.app_version,
    }
    try:
        _db().table("app_feedback").insert(row).execute()
        return {"ok": True}
    except Exception as exc:
        logger.error("[Feedback] insert failed: %s", exc)
        raise HTTPException(status_code=503, detail="Could not send feedback right now")


# ── Admin ─────────────────────────────────────────────────────

class FeedbackUpdate(BaseModel):
    status: str = Field(pattern=r"^(open|in_progress|resolved|dismissed)$")
    admin_note: Optional[str] = Field(default=None, max_length=1000)


@router.get("/admin")
async def admin_list(kind: str = "all", status: str = "all", _admin: str = Depends(_admin_id)):
    if kind not in {"all", "rating", "bug", "idea"} or status not in {"all", "open", "in_progress", "resolved", "dismissed"}:
        raise HTTPException(status_code=400, detail="Invalid filter")
    try:
        db = _db()
        q = db.table("app_feedback").select("*")
        if kind != "all":
            q = q.eq("kind", kind)
        if status != "all":
            q = q.eq("status", status)
        rows = q.order("created_at", desc=True).limit(300).execute().data or []
        ratings = db.table("app_feedback").select("rating").eq("kind", "rating").limit(100000).execute().data or []
        bugs_open = db.table("app_feedback").select("id", count="exact").eq("kind", "bug") \
            .in_("status", ["open", "in_progress"]).limit(1).execute().count or 0
        dist = {str(i): 0 for i in range(1, 6)}
        for r in ratings:
            if r.get("rating"):
                dist[str(r["rating"])] += 1
        total = sum(dist.values())
        avg = round(sum(int(k) * v for k, v in dist.items()) / total, 2) if total else None
        return {"ok": True, "items": rows,
                "summary": {"ratings": total, "average": avg, "distribution": dist, "open_bugs": bugs_open}}
    except Exception as exc:
        logger.error("[Feedback] admin list failed: %s", exc)
        raise HTTPException(status_code=503, detail="Could not load feedback. Has the app_feedback migration been run?")


@router.post("/admin/{item_id}")
async def admin_update(item_id: UUID, body: FeedbackUpdate, _admin: str = Depends(_admin_id)):
    try:
        update = {"status": body.status, "updated_at": datetime.now(timezone.utc).isoformat()}
        if body.admin_note is not None:
            update["admin_note"] = body.admin_note.strip() or None
        res = _db().table("app_feedback").update(update).eq("id", str(item_id)).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Feedback not found")
        return {"ok": True, "item": res.data[0]}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[Feedback] admin update failed: %s", exc)
        raise HTTPException(status_code=503, detail="Could not update feedback")
