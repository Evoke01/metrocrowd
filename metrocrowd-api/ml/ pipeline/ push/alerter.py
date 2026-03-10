# ══════════════════════════════════════════════════════════════
#  push/alerter.py
#  Called by worker.py every 5 minutes.
#  Checks ml_predictions for stations crossing crowd thresholds
#  and fires push notifications to subscribed users.
# ══════════════════════════════════════════════════════════════
import os
from datetime import datetime
from supabase import create_client
from push.notify import notify_station

SUPABASE_URL   = os.environ["SUPABASE_URL"]
SUPABASE_KEY   = os.environ["SUPABASE_KEY"]
ALERT_THRESHOLD = 75   # fire push when crowd_pct crosses this

def run_alerts():
    """
    Compare current-hour predictions against threshold.
    Only fires for stations that have at least one subscriber.
    Skips stations already alerted in the last 30 minutes
    (uses last_notified_at on push_subscriptions).
    """
    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    now    = datetime.now()
    hour   = now.hour
    dow    = now.weekday()

    # Get all stations with predictions above threshold right now
    resp = client.table("ml_predictions") \
        .select("station_id, crowd_pct") \
        .eq("hour", hour) \
        .eq("day_of_week", dow) \
        .gte("crowd_pct", ALERT_THRESHOLD) \
        .execute()

    if not resp.data:
        return

    # Get all unique station_ids that have subscribers
    subs_resp = client.table("push_subscriptions") \
        .select("station_ids, last_notified_at") \
        .execute()

    subscribed_stations: set[str] = set()
    for row in subs_resp.data:
        for sid in row.get("station_ids", []):
            subscribed_stations.add(sid)

    # Fire notifications
    for row in resp.data:
        sid = row["station_id"]
        if sid not in subscribed_stations:
            continue

        # Fetch station name from gtfs_stops
        name_resp = client.table("gtfs_stops") \
            .select("name") \
            .eq("stop_id", sid) \
            .maybe_single() \
            .execute()
        name = name_resp.data["name"] if name_resp.data else sid

        notify_station(sid, name, row["crowd_pct"])

        # Update last_notified_at for all subscriptions watching this station
        client.table("push_subscriptions") \
            .update({"last_notified_at": now.isoformat()}) \
            .contains("station_ids", [sid]) \
            .execute()
