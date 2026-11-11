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


_BASE_SETTINGS = "enabled,commute_points,referral_points,min_withdrawal_points,rupees_per_1000_points"


def _settings(db) -> dict:
    # report_points / daily_report_cap come from 20261111_report_rewards.sql;
    # fall back gracefully if that migration has not been applied yet.
    try:
        return db.table("reward_settings").select(
            _BASE_SETTINGS + ",report_points,daily_report_cap"
        ).eq("singleton", True).single().execute().data
    except Exception:
        data = db.table("reward_settings").select(_BASE_SETTINGS) \
            .eq("singleton", True).single().execute().data
        data.update({"report_points": 0, "daily_report_cap": 0})
        return data


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
    report_points: Optional[int] = Field(default=None, ge=0, le=100_000)
    daily_report_cap: Optional[int] = Field(default=None, ge=0, le=100)


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


@router.post("/report")
async def award_report(user_id: str = Depends(_user_id)):
    """Award points for the caller's latest crowd report (caps enforced in SQL)."""
    try:
        result = _db().rpc("rewards_award_report", {"p_user": user_id}).execute()
        return {"ok": True, "awarded": int(result.data or 0)}
    except Exception as exc:
        logger.warning("[Rewards] report award skipped for %s: %s", user_id, exc)
        return {"ok": True, "awarded": 0}


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


def _people(db) -> dict:
    """Map user_id -> {email, name} from Supabase Auth (service key)."""
    people = {}
    try:
        page = 1
        while page <= 20:
            users = db.auth.admin.list_users(page=page, per_page=1000) or []
            for u in users:
                meta = getattr(u, "user_metadata", None) or {}
                created = getattr(u, "created_at", None)
                last = getattr(u, "last_sign_in_at", None)
                people[str(u.id)] = {
                    "email": getattr(u, "email", None),
                    "name": meta.get("full_name") or meta.get("name") or meta.get("user_name"),
                    "anonymous": bool(getattr(u, "is_anonymous", False)) or not getattr(u, "email", None),
                    "created_at": created.isoformat() if hasattr(created, "isoformat") else created,
                    "last_sign_in_at": last.isoformat() if hasattr(last, "isoformat") else last,
                }
            if len(users) < 1000:
                break
            page += 1
    except Exception as exc:
        logger.warning("[Rewards] could not list auth users: %s", exc)
    return people


def _rupees(points: int, settings: dict) -> float:
    return round((points or 0) * float(settings.get("rupees_per_1000_points") or 0) / 1000, 2)


@router.get("/admin/me")
async def admin_me(user_id: str = Depends(_user_id)):
    """Lets the admin page check access and show the caller's user id."""
    allowed = {v.strip() for v in os.getenv("REWARDS_ADMIN_USER_IDS", "").split(",") if v.strip()}
    return {"ok": True, "user_id": user_id, "is_admin": user_id in allowed}


@router.get("/admin/overview")
async def admin_overview(_admin: str = Depends(_admin_id)):
    try:
        db = _db()
        settings = _settings(db)
        accounts = db.table("reward_accounts").select("balance_points").limit(100000).execute().data or []
        payouts = db.table("reward_payout_requests").select("status,points,amount_paise") \
            .limit(100000).execute().data or []
        since = datetime.now(timezone.utc).timestamp() - 7 * 86400
        recent = db.table("reward_ledger").select("points_delta,reason") \
            .gte("created_at", datetime.fromtimestamp(since, timezone.utc).isoformat()) \
            .limit(100000).execute().data or []
        outstanding = sum(a["balance_points"] or 0 for a in accounts)
        signed_up = sum(1 for p in _people(db).values() if not p.get("anonymous"))
        by_status = {}
        for p in payouts:
            s = by_status.setdefault(p["status"], {"count": 0, "points": 0, "rupees": 0.0})
            s["count"] += 1
            s["points"] += p["points"] or 0
            s["rupees"] += (p["amount_paise"] or 0) / 100
        earned_7d = sum(r["points_delta"] for r in recent if r["points_delta"] > 0 and r["reason"] != "payout_refund")
        return {
            "ok": True,
            "settings": settings,
            "users": len(accounts),
            "signed_up": signed_up,
            "outstanding_points": outstanding,
            "outstanding_rupees": _rupees(outstanding, settings),
            "payouts": by_status,
            "earned_7d_points": earned_7d,
        }
    except Exception as exc:
        logger.error("[Rewards] admin overview failed: %s", exc)
        raise HTTPException(status_code=503, detail="Could not load overview")


@router.get("/admin/users")
async def admin_users(_admin: str = Depends(_admin_id)):
    try:
        db = _db()
        settings = _settings(db)
        accounts = db.table("reward_accounts").select("user_id,referral_code,balance_points,created_at") \
            .order("balance_points", desc=True).limit(5000).execute().data or []
        ledger = db.table("reward_ledger").select("user_id,points_delta,reason") \
            .limit(100000).execute().data or []
        payouts = db.table("reward_payout_requests").select("user_id,status,amount_paise") \
            .limit(100000).execute().data or []
        people = _people(db)
        stats = {}
        for row in ledger:
            s = stats.setdefault(row["user_id"], {"earned": 0, "trips": 0, "reports": 0, "referrals": 0})
            if row["points_delta"] > 0 and row["reason"] != "payout_refund":
                s["earned"] += row["points_delta"]
            if row["reason"] == "commute": s["trips"] += 1
            elif row["reason"] == "report": s["reports"] += 1
            elif row["reason"] == "referral": s["referrals"] += 1
        paid = {}
        for p in payouts:
            if p["status"] == "paid":
                paid[p["user_id"]] = paid.get(p["user_id"], 0) + (p["amount_paise"] or 0) / 100
        # Reward accounts are created the first time someone opens Rewards, so
        # include every signed-up (non-anonymous) user, with 0 points if needed.
        by_id = {a["user_id"]: a for a in accounts}
        for uid, who in people.items():
            if uid not in by_id and not who.get("anonymous"):
                by_id[uid] = {"user_id": uid, "referral_code": None, "balance_points": 0,
                              "created_at": who.get("created_at")}
        account_ids = {x["user_id"] for x in accounts}
        users = []
        for uid, a in by_id.items():
            who = people.get(uid, {})
            users.append({
                **a,
                "has_account": uid in account_ids,
                "last_sign_in_at": who.get("last_sign_in_at"),
                "email": who.get("email"),
                "name": who.get("name"),
                "balance_rupees": _rupees(a["balance_points"], settings),
                "paid_rupees": round(paid.get(uid, 0), 2),
                **stats.get(uid, {"earned": 0, "trips": 0, "reports": 0, "referrals": 0}),
            })
        return {"ok": True, "users": users}
    except Exception as exc:
        logger.error("[Rewards] admin users failed: %s", exc)
        raise HTTPException(status_code=503, detail="Could not load users")


@router.get("/admin/activity")
async def admin_activity(_admin: str = Depends(_admin_id)):
    try:
        db = _db()
        rows = db.table("reward_ledger").select("user_id,points_delta,reason,reference_id,created_at") \
            .order("created_at", desc=True).limit(100).execute().data or []
        people = _people(db)
        for r in rows:
            r["email"] = people.get(r["user_id"], {}).get("email")
        return {"ok": True, "activity": rows}
    except Exception as exc:
        logger.error("[Rewards] admin activity failed: %s", exc)
        raise HTTPException(status_code=503, detail="Could not load activity")


@router.get("/admin/payouts")
async def admin_payouts(status: str = "pending", _admin: str = Depends(_admin_id)):
    if status not in {"pending", "approved", "paid", "rejected", "all"}:
        raise HTTPException(status_code=400, detail="Invalid payout status")
    try:
        db = _db()
        query = db.table("reward_payout_requests").select("*")
        if status != "all":
            query = query.eq("status", status)
        rows = query.order("created_at", desc=True).limit(200).execute().data or []
        if rows:
            people = _people(db)
            for r in rows:
                r["email"] = people.get(r["user_id"], {}).get("email")
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
        update = {
            "enabled": req.enabled,
            "commute_points": req.commute_points,
            "referral_points": req.referral_points,
            "min_withdrawal_points": req.min_withdrawal_points,
            "rupees_per_1000_points": req.rupees_per_1000_points,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if req.report_points is not None:
            update["report_points"] = req.report_points
        if req.daily_report_cap is not None:
            update["daily_report_cap"] = req.daily_report_cap
        result = _db().table("reward_settings").update(update).eq("singleton", True).execute()
        if not result.data:
            raise HTTPException(status_code=503, detail="Reward settings row is missing")
        return {"ok": True, "settings": result.data[0]}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[Rewards] settings update failed: %s", exc)
        raise HTTPException(status_code=503, detail="Could not update reward settings")
