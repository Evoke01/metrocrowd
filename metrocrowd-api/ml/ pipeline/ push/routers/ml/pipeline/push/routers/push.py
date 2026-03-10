# ══════════════════════════════════════════════════════════════
#  routers/push.py
#  POST /push/subscribe   — save device subscription
#  DELETE /push/subscribe — remove subscription
#  POST /push/notify/{station_id} — internal trigger
# ══════════════════════════════════════════════════════════════
import os
from fastapi import APIRouter, Body, HTTPException
from supabase import create_client
from push.notify import notify_station

router = APIRouter()
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

@router.post("/subscribe")
def subscribe(payload: dict = Body(...)):
    """
    Save a Web Push subscription.
    payload: { subscription_json, station_ids, user_id }
    """
    sub = payload.get("subscription_json", {})
    endpoint = sub.get("endpoint")
    if not endpoint:
        raise HTTPException(400, "Missing endpoint")

    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    client.table("push_subscriptions").upsert({
        "endpoint":          endpoint,
        "subscription_json": sub,
        "station_ids":       payload.get("station_ids", []),
        "user_id":           payload.get("user_id"),
    }, on_conflict="endpoint").execute()
    return {"ok": True}

@router.delete("/subscribe")
def unsubscribe(endpoint: str = Body(..., embed=True)):
    """Remove a subscription by endpoint."""
    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    client.table("push_subscriptions").delete().eq("endpoint", endpoint).execute()
    return {"ok": True}

@router.post("/notify/{station_id}")
def trigger_notify(station_id: str, station_name: str = "", crowd_pct: int = 80):
    """Internal: manually trigger push for a station."""
    notify_station(station_id, station_name or station_id, crowd_pct)
    return {"ok": True}
