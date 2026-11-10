# ══════════════════════════════════════════════════════════════
#  pipeline/realtime.py
#  Fetches GTFS-RT VehiclePositions from OTD.
#  Maps occupancy_status → crowd_pct per stop.
#  Writes into Supabase ml_predictions (current hour slot).
# ══════════════════════════════════════════════════════════════
import os, json, requests
from datetime import datetime
from zoneinfo import ZoneInfo
from google.transit import gtfs_realtime_pb2
from supabase import create_client

VEHICLE_URL  = "https://otd.delhi.gov.in/api/realtime/VehiclePositions.pb?key={key}"
OTD_API_KEY  = os.environ.get("OTD_API_KEY", "")
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

# GTFS-RT occupancy_status → crowd %
OCCUPANCY_MAP = {
    0: 10,   # EMPTY
    1: 25,   # MANY_SEATS_AVAILABLE
    2: 45,   # FEW_SEATS_AVAILABLE
    3: 65,   # STANDING_ROOM_ONLY
    4: 80,   # CRUSHED_STANDING_ROOM_ONLY
    5: 95,   # FULL
    6: 100,  # NOT_ACCEPTING_PASSENGERS
}
IST = ZoneInfo("Asia/Kolkata")

def fetch_vehicle_positions() -> list[dict]:
    """Fetch raw vehicle positions from OTD. Returns empty list on failure."""
    if not OTD_API_KEY:
        return []
    url = VEHICLE_URL.format(key=OTD_API_KEY)
    r   = requests.get(url, timeout=10)
    r.raise_for_status()
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(r.content)
    positions = []
    for entity in feed.entity:
        if not entity.HasField("vehicle"):
            continue
        v = entity.vehicle
        if not v.stop_id:
            continue
        positions.append({
            "trip_id":   v.trip.trip_id,
            "route_id":  v.trip.route_id,
            "stop_id":   v.stop_id,
            "lat":       v.position.latitude,
            "lon":       v.position.longitude,
            "crowd_pct": OCCUPANCY_MAP.get(v.occupancy_status, 40),
            "timestamp": v.timestamp,
        })
    return positions

def fetch_and_store() -> int:
    """
    Called by worker.py every 30s.
    Aggregates crowd by stop_id (takes max if multiple vehicles),
    upserts into ml_predictions for current hour.
    Returns number of stops updated.
    """
    positions = fetch_vehicle_positions()
    if not positions:
        return 0

    now  = datetime.now(IST)
    hour = now.hour
    dow  = now.weekday()

    # If multiple trains at same stop, take the max crowd reading
    stop_crowd: dict[str, int] = {}
    for p in positions:
        sid = p["stop_id"]
        stop_crowd[sid] = max(stop_crowd.get(sid, 0), p["crowd_pct"])

    rows = [
        {
            "station_id":  sid,
            "hour":        hour,
            "day_of_week": dow,
            "crowd_pct":   crowd,
            "confidence":  "high",       # real-time data = high confidence
            "model_ver":   "realtime",
        }
        for sid, crowd in stop_crowd.items()
    ]

    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    client.rpc("upsert_predictions", {"rows": json.dumps(rows)}).execute()
    return len(rows)
