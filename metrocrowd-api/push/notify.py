# ══════════════════════════════════════════════════════════════
#  push/notify.py
#  Sends Web Push notifications using pywebpush.
#  Reads subscriptions from Supabase push_subscriptions table.
# ══════════════════════════════════════════════════════════════
import os, json
from pywebpush import webpush, WebPushException
from supabase import create_client

VAPID_PRIVATE_KEY = os.environ["VAPID_PRIVATE_KEY"]
VAPID_EMAIL       = os.environ.get("VAPID_EMAIL", "mailto:admin@metrocrowd.app")
SUPABASE_URL      = os.environ["SUPABASE_URL"]
SUPABASE_KEY      = os.environ["SUPABASE_KEY"]

def get_subscriptions_for_station(station_id: str) -> list[dict]:
    """Fetch all push subscriptions watching a given station."""
    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    resp = client.table("push_subscriptions") \
        .select("subscription_json") \
        .contains("station_ids", [station_id]) \
        .execute()
    return [row["subscription_json"] for row in resp.data]

def send_notification(subscription: dict, payload: dict) -> bool:
    """Send a single Web Push notification."""
    try:
        webpush(
            subscription_info=subscription,
            data=json.dumps(payload),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_EMAIL},
        )
        return True
    except WebPushException as e:
        if "410" in str(e) or "404" in str(e):
            # Subscription expired — clean up
            _delete_subscription(subscription.get("endpoint",""))
        else:
            print(f"[Push] Failed: {e}")
        return False

def notify_station(station_id: str, station_name: str, crowd_pct: int,
                   urgency: str = "normal"):
    """Notify all subscribers watching this station."""
    subs = get_subscriptions_for_station(station_id)
    if not subs:
        return

    level = "packed 🔴" if crowd_pct >= 80 else "crowded 🟡" if crowd_pct >= 55 else "moderate"
    payload = {
        "title":     f"🚇 {station_name}",
        "body":      f"Crowd is now {level} ({crowd_pct}%)",
        "icon":      "/icons/icon-192.png",
        "badge":     "/icons/badge-72.png",
        "tag":       f"crowd-{station_id}",
        "url":       f"/?tab=s-station&station={station_id}",
        "stationId": station_id,
        "urgency":   urgency,
    }
    sent = sum(1 for s in subs if send_notification(s, payload))
    print(f"[Push] {station_name}: {sent}/{len(subs)} delivered")

def _delete_subscription(endpoint: str):
    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    client.table("push_subscriptions").delete().eq("endpoint", endpoint).execute()
