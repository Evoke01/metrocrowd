"""Task rewards, referral attribution, and manually reviewed payout requests."""
import logging
import os
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from supabase import create_client

from middleware.auth import require_supabase_user

router = APIRouter()
logger = logging.getLogger(__name__)
SB_URL = os.environ["SUPABASE_URL"]
SB_KEY = os.environ["SUPABASE_KEY"]


def _db():
    return create_client(SB_URL, SB_KEY)


def _user_id(claims: dict = Depends(require_supabase_user)) -> str:
    if claims.get("is_anonymous") or not claims.get("email"):
        raise HTTPException(status_code=401, detail="Sign in with Google or GitHub to use rewards")
    try:
        return str(UUID(claims["sub"]))
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid account token")


def _admin_id(user_id: str = Depends(_user_id)) -> str:
    allowed = {value.strip() for value in os.getenv("REWARDS_ADMIN_USER_IDS", "").split(",") if value.strip()}
    if user_id not in allowed:
        raise HTTPException(status_code=403, detail="Rewards admin access required")
    return user_id


def _ensure_account(db, user_id: str) -> dict:
    db.table("reward_accounts").upsert(
        {"user_id": user_id}, on_conflict="user_id", ignore_duplicates=True
    ).execute()
    result = db.table("reward_accounts").select("user_id,referral_code,balance_points,created_at") \
        .eq("user_id", user_id).single().execute()
    return result.data


def _settings(db) -> dict:
    result = db.table("reward_settings").select(
        "enabled,commute_points,referral_points,min_withdrawal_points,rupees_per_1000_points"
    ).eq("singleton", True).single().execute()
    return result.data


class ReferralClaim(BaseModel):
    code: str = Field(min_length=4, max_length=20, pattern=r"^[A-Za-z0-9]+$")


class PayoutRequest(BaseModel):
    points: int = Field(gt=0, le=10_000_000)
    upi_id: str = Field(min_length=3, max_length=100)


class PayoutAction(BaseModel):
    action: str = Field(pattern=r"^(approve|paid|reject)$")
    note: Optional[str] = Field(default=None, max_length=500)
    payout_reference: Optional[str] = Field(default=None, max_length=200)


class SettingsUpdate(BaseModel):
    enabled: bool
    commute_points: int = Field(ge=0, le=100_000)
    referral_points: int = Field(ge=0, le=100_000)
    min_withdrawal_points: int = Field(gt=0, le=10_000_000)
    rupees_per_1000_points: float = Field(gt=0, le=1_000_000)


@router.get("/me")
async def rewards_me(user_id: str = Depends(_user_id)):
    db = _db()
    try:
        account = _ensure_account(db, user_id)
        settings = _settings(db)
        ledger = db.table("reward_ledger").select(
            "points_delta,reason,created_at"
        ).eq("user_id", user_id).order("created_at", desc=True).limit(20).execute().data or []
        payouts = db.table("reward_payout_requests").select(
            "id,points,amount_paise,status,admin_note,created_at,reviewed_at,paid_at"
        ).eq("user_id", user_id).order("created_at", desc=True).limit(10).execute().data or []
        return {
            "ok": True,
            "account": account,
            "settings": settings,
            "referral_url": f"https://metrocrowd.vercel.app/?ref={account['referral_code']}",
            "ledger": ledger,
            "payouts": payouts,
        }
    except Exception as exc:
        logger.error("[Rewards] me failed: %s", exc)
        raise HTTPException(status_code=503, detail="Rewards are not ready yet. Please try again later.")


@router.post("/claim-referral")
async def claim_referral(req: ReferralClaim, user_id: str = Depends(_user_id)):
    try:
        result = _db().rpc("rewards_claim_referral", {
            "p_invitee": user_id,
            "p_code": req.code.upper(),
        }).execute()
        return {"ok": True, "claimed": bool(result.data)}
    except Exception as exc:
        logger.error("[Rewards] referral claim failed for %s: %s", user_id, exc)
        raise HTTPException(status_code=503, detail="Could not save referral code yet")


@router.post("/payouts")
async def request_payout(req: PayoutRequest, user_id: str = Depends(_user_id)):
    try:
        result = _db().rpc("rewards_request_payout", {
            "p_user": user_id,
            "p_points": req.points,
            "p_upi": req.upi_id.strip(),
        }).execute()
        row = result.data[0] if isinstance(result.data, list) else result.data
        return {"ok": True, "payout": row}
    except Exception as exc:
        message = str(exc)
        if any(term in message.lower() for term in ("minimum", "insufficient", "valid upi", "not enabled", "too small")):
            raise HTTPException(status_code=400, detail=message)
        logger.error("[Rewards] payout request failed: %s", exc)
        raise HTTPException(status_code=503, detail="Could not create payout request")


@router.get("/admin/payouts")
async def admin_payouts(status: str = "pending", _admin: str = Depends(_admin_id)):
    if status not in {"pending", "approved", "paid", "rejected", "all"}:
        raise HTTPException(status_code=400, detail="Invalid payout status")
    try:
        query = _db().table("reward_payout_requests").select("*")
        if status != "all":
            query = query.eq("status", status)
        rows = query.order("created_at", desc=True).limit(100).execute().data or []
        return {"ok": True, "payouts": rows}
    except Exception as exc:
        logger.error("[Rewards] admin payouts failed: %s", exc)
        raise HTTPException(status_code=503, detail="Could not load payout requests")


@router.post("/admin/payouts/{request_id}")
async def admin_resolve_payout(request_id: UUID, req: PayoutAction, _admin: str = Depends(_admin_id)):
    if req.action == "paid" and not req.payout_reference:
        raise HTTPException(status_code=400, detail="Add the transfer reference before marking paid")
    try:
        result = _db().rpc("rewards_resolve_payout", {
            "p_request": str(request_id),
            "p_action": req.action,
            "p_note": req.note,
            "p_reference": req.payout_reference,
        }).execute()
        row = result.data[0] if isinstance(result.data, list) else result.data
        return {"ok": True, "payout": row}
    except Exception as exc:
        message = str(exc)
        if "Invalid payout status" in message or "not found" in message.lower():
            raise HTTPException(status_code=409, detail=message)
        logger.error("[Rewards] payout resolution failed: %s", exc)
        raise HTTPException(status_code=503, detail="Could not update payout request")


@router.put("/admin/settings")
async def admin_update_settings(req: SettingsUpdate, _admin: str = Depends(_admin_id)):
    try:
        result = _db().table("reward_settings").update({
            "enabled": req.enabled,
            "commute_points": req.commute_points,
            "referral_points": req.referral_points,
            "min_withdrawal_points": req.min_withdrawal_points,
            "rupees_per_1000_points": req.rupees_per_1000_points,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("singleton", True).execute()
        if not result.data:
            raise HTTPException(status_code=503, detail="Reward settings row is missing")
        return {"ok": True, "settings": result.data[0]}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[Rewards] settings update failed: %s", exc)
        raise HTTPException(status_code=503, detail="Could not update reward settings")
