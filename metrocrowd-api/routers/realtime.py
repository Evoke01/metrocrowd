# ══════════════════════════════════════════════════════════════
#  routers/realtime.py  — OTD GTFS-RT proxy
#
#  OTD only exposes ONE real-time feed:
#    GET /api/realtime/VehiclePositions.pb?key=KEY
#    → GTFS-RT FeedMessage with VehiclePosition entities (Delhi buses/cluster buses)
#
#  We expose:
#    GET /realtime/vehicles            — all vehicle positions (raw)
#    GET /realtime/vehicles/near       — vehicles near a lat/lng
#    GET /realtime/status              — health-check / feed metadata
# ══════════════════════════════════════════════════════════════
import os, time, math, logging
from fastapi import APIRouter, Query
from google.transit import gtfs_realtime_pb2
import requests

router = APIRouter()
log    = logging.getLogger(__name__)

OTD_KEY  = os.getenv("OOTD_API_KEY", "")
OTD_URL  = f"https://otd.delhi.gov.in/api/realtime/VehiclePositions.pb?key={OTD_KEY}"
TIMEOUT  = 10
CACHE_TTL = 30  # seconds

_cache: dict = {}


def _fetch_vehicles() -> list[dict] | None:
    """Fetch + parse VehiclePositions feed. Returns list of vehicle dicts or None."""
    now = time.time()
    if "vp" in _cache and now - _cache["vp"]["ts"] < CACHE_TTL:
        return _cache["vp"]["data"]

    if not OTD_KEY:
        log.warning("OOTD_API_KEY not set — skipping OTD fetch")
        return None

    try:
        r = requests.get(
            OTD_URL,
            headers={"Accept": "application/x-google-protobuf,application/octet-stream,*/*"},
            timeout=TIMEOUT,
        )
        r.raise_for_status()

        feed = gtfs_realtime_pb2.FeedMessage()
        feed.ParseFromString(r.content)

        vehicles = []
        for entity in feed.entity:
            if not entity.HasField("vehicle"):
                continue
            v   = entity.vehicle
            pos = v.position if v.HasField("position") else None
            if not pos:
                continue
            vehicles.append({
                "id":        entity.id,
                "trip_id":   v.trip.trip_id    if v.HasField("trip") else "",
                "route_id":  v.trip.route_id   if v.HasField("trip") else "",
                "direction": v.trip.direction_id if v.HasField("trip") else -1,
                "lat":       round(pos.latitude,  6),
                "lng":       round(pos.longitude, 6),
                "bearing":   round(pos.bearing, 1) if pos.bearing else None,
                "speed_kmh": round(pos.speed * 3.6, 1) if pos.speed else None,
                "timestamp": v.timestamp,
                "stop_id":   v.stop_id or "",
                "status":    v.current_status,
            })

        _cache["vp"] = {
            "data": vehicles,
            "ts":   now,
            "feed_ts": feed.header.timestamp if feed.header else 0,
        }
        log.info(f"OTD: fetched {len(vehicles)} vehicles")
        return vehicles

    except Exception as e:
        log.error(f"OTD fetch error: {e}")
        # Return stale cache on error rather than nothing
        return _cache.get("vp", {}).get("data")


def _haversine(lat1, lng1, lat2, lng2) -> float:
    """Distance in km between two GPS coords."""
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng/2)**2
    return R * 2 * math.asin(math.sqrt(a))


# ── /realtime/status ──────────────────────────────────────────
@router.get("/status")
def get_status():
    key_set = bool(OTD_KEY)
    vehicles = _fetch_vehicles()
    cached   = _cache.get("vp")
    return {
        "key_configured": key_set,
        "vehicle_count":  len(vehicles) if vehicles else 0,
        "feed_ts":        cached["feed_ts"] if cached else 0,
        "cache_age_sec":  round(time.time() - cached["ts"]) if cached else None,
        "source":         "ok" if vehicles else ("no_key" if not key_set else "unavailable"),
    }


# ── /realtime/vehicles ────────────────────────────────────────
@router.get("/vehicles")
def get_vehicles(route_id: str = ""):
    vehicles = _fetch_vehicles()
    if vehicles is None:
        return {"vehicles": [], "source": "unavailable", "key_set": bool(OTD_KEY)}
    if route_id:
        vehicles = [v for v in vehicles if v["route_id"] == route_id]
    cached = _cache.get("vp", {})
    return {
        "vehicles": vehicles,
        "count":    len(vehicles),
        "feed_ts":  cached.get("feed_ts", 0),
        "source":   "ok",
    }


# ── /realtime/vehicles/near ───────────────────────────────────
@router.get("/vehicles/near")
def get_vehicles_near(
    lat:    float = Query(..., description="Latitude"),
    lng:    float = Query(..., description="Longitude"),
    radius: float = Query(1.0,  description="Search radius in km"),
    limit:  int   = Query(10,   description="Max results"),
):
    vehicles = _fetch_vehicles()
    if not vehicles:
        return {"vehicles": [], "source": "unavailable"}

    nearby = []
    for v in vehicles:
        dist = _haversine(lat, lng, v["lat"], v["lng"])
        if dist <= radius:
            nearby.append({**v, "dist_km": round(dist, 3)})

    nearby.sort(key=lambda x: x["dist_km"])
    return {
        "vehicles": nearby[:limit],
        "count":    len(nearby),
        "radius_km": radius,
        "feed_ts":  _cache.get("vp", {}).get("feed_ts", 0),
        "source":   "ok",
    }


# ── /realtime/alerts  (stub — OTD has no alerts feed) ────────
@router.get("/alerts")
def get_alerts():
    """OTD does not publish a GTFS-RT Alerts feed. Returns empty list."""
    return {"alerts": [], "source": "no_alerts_feed"}


# ── /realtime/station/{stop_id} ───────────────────────────────
@router.get("/station/{stop_id}")
def get_station(stop_id: str):
    """
    Vehicles currently stopped at or heading to this stop_id.
    OTD doesn't publish TripUpdates so we can't give ETAs —
    we return vehicles whose current stop_id matches.
    """
    vehicles = _fetch_vehicles()
    if not vehicles:
        return {"stop_id": stop_id, "vehicles": [], "source": "unavailable"}

    at_stop = [v for v in vehicles if v.get("stop_id") == stop_id]
    return {
        "stop_id":  stop_id,
        "vehicles": at_stop,
        "count":    len(at_stop),
        "feed_ts":  _cache.get("vp", {}).get("feed_ts", 0),
        "source":   "ok",
    }
