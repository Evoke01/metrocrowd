# ══════════════════════════════════════════════════════════════
#  routers/realtime.py  — OTD GTFS-RT proxy + parser
#  Endpoints:
#    GET /realtime/alerts           — service disruptions
#    GET /realtime/trips/{stop_id}  — ETAs at a stop
#    GET /realtime/vehicles         — all vehicle positions
#    GET /realtime/station/{stop_id}— combined: ETAs + alerts for one station
#
#  OTD feeds (protobuf):
#    VehiclePositions.pb  — GPS locations of buses/metro
#    TripUpdates.pb       — arrival/departure predictions per stop
#    Alerts.pb            — service disruption messages (no key needed)
# ══════════════════════════════════════════════════════════════
import os, time, logging
from functools import lru_cache
from fastapi import APIRouter, HTTPException
from google.transit import gtfs_realtime_pb2
import requests

router = APIRouter()
log    = logging.getLogger(__name__)

OTD_KEY  = os.getenv("OOTD_API_KEY", "")
OTD_BASE = "https://otd.delhi.gov.in/api/realtime"

HEADERS = {"Accept": "application/x-google-protobuf"}
TIMEOUT = 8  # seconds

# ── Simple in-process cache (TTL 30s) ────────────────────────
_cache: dict = {}
CACHE_TTL = 30  # seconds

def _fetch_pb(url: str) -> gtfs_realtime_pb2.FeedMessage | None:
    now = time.time()
    if url in _cache and now - _cache[url]["ts"] < CACHE_TTL:
        return _cache[url]["data"]
    try:
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        feed = gtfs_realtime_pb2.FeedMessage()
        feed.ParseFromString(r.content)
        _cache[url] = {"data": feed, "ts": now}
        return feed
    except Exception as e:
        log.warning(f"OTD fetch failed {url}: {e}")
        return _cache.get(url, {}).get("data")  # return stale if available

def _vehicles_url(): return f"{OTD_BASE}/VehiclePositions.pb?key={OTD_KEY}"
def _trips_url():    return f"{OTD_BASE}/TripUpdates.pb?key={OTD_KEY}"
def _alerts_url():   return f"{OTD_BASE}/Alerts.pb"  # no key required


# ── /realtime/alerts ─────────────────────────────────────────
@router.get("/alerts")
def get_alerts():
    feed = _fetch_pb(_alerts_url())
    if not feed:
        return {"alerts": [], "source": "unavailable"}

    alerts = []
    for entity in feed.entity:
        if not entity.HasField("alert"):
            continue
        a = entity.alert
        # Header text
        header = ""
        if a.header_text.translation:
            header = a.header_text.translation[0].text
        desc = ""
        if a.description_text.translation:
            desc = a.description_text.translation[0].text

        # Informed entities (which routes/stops affected)
        affected = []
        for ie in a.informed_entity:
            part = {}
            if ie.route_id:  part["route_id"]  = ie.route_id
            if ie.stop_id:   part["stop_id"]   = ie.stop_id
            if ie.agency_id: part["agency_id"] = ie.agency_id
            if part:         affected.append(part)

        cause_map = {0:"UNKNOWN",1:"OTHER",2:"TECHNICAL",3:"STRIKE",4:"DEMONSTRATION",
                     5:"ACCIDENT",6:"HOLIDAY",7:"WEATHER",8:"MAINTENANCE",
                     9:"CONSTRUCTION",10:"POLICE",11:"MEDICAL"}
        effect_map = {0:"UNKNOWN",1:"NO_SERVICE",2:"REDUCED_SERVICE",3:"SIGNIFICANT_DELAYS",
                      4:"DETOUR",5:"ADDITIONAL_SERVICE",6:"MODIFIED_SERVICE",
                      7:"OTHER",8:"STOP_MOVED",9:"NO_EFFECT",10:"ACCESSIBILITY"}

        alerts.append({
            "id":       entity.id,
            "header":   header,
            "desc":     desc,
            "cause":    cause_map.get(a.cause, "UNKNOWN"),
            "effect":   effect_map.get(a.effect, "UNKNOWN"),
            "affected": affected,
            "active_periods": [
                {"start": p.start, "end": p.end}
                for p in a.active_period
                if p.start or p.end
            ],
        })

    ts = feed.header.timestamp if feed.header else 0
    return {
        "alerts":    alerts,
        "count":     len(alerts),
        "feed_ts":   ts,
        "cached_at": int(time.time()),
    }


# ── /realtime/trips/{stop_id} ─────────────────────────────────
@router.get("/trips/{stop_id}")
def get_trips(stop_id: str, limit: int = 5):
    """Return upcoming train/bus ETAs at a given stop_id."""
    feed = _fetch_pb(_trips_url())
    if not feed:
        return {"stop_id": stop_id, "arrivals": [], "source": "unavailable"}

    now = int(time.time())
    arrivals = []

    for entity in feed.entity:
        if not entity.HasField("trip_update"):
            continue
        tu = entity.trip_update
        for stu in tu.stop_time_update:
            if stu.stop_id != stop_id:
                continue
            arr_time = stu.arrival.time   if stu.HasField("arrival")   else 0
            dep_time = stu.departure.time if stu.HasField("departure") else 0
            t = arr_time or dep_time
            if t < now - 60:  # skip stops more than 1min in the past
                continue
            delay = stu.arrival.delay if stu.HasField("arrival") else 0
            arrivals.append({
                "trip_id":    tu.trip.trip_id,
                "route_id":   tu.trip.route_id,
                "direction":  tu.trip.direction_id,
                "arr_epoch":  arr_time,
                "dep_epoch":  dep_time,
                "arr_in_sec": max(0, t - now),
                "delay_sec":  delay,
                "schedule":   stu.schedule_relationship,
            })

    arrivals.sort(key=lambda x: x["arr_in_sec"])
    return {
        "stop_id":  stop_id,
        "arrivals": arrivals[:limit],
        "total":    len(arrivals),
        "feed_ts":  feed.header.timestamp if feed.header else 0,
    }


# ── /realtime/vehicles ────────────────────────────────────────
@router.get("/vehicles")
def get_vehicles(route_id: str = ""):
    feed = _fetch_pb(_vehicles_url())
    if not feed:
        return {"vehicles": [], "source": "unavailable"}

    vehicles = []
    for entity in feed.entity:
        if not entity.HasField("vehicle"):
            continue
        v = entity.vehicle
        pos = v.position if v.HasField("position") else None
        if not pos:
            continue
        rec = {
            "id":         entity.id,
            "trip_id":    v.trip.trip_id    if v.HasField("trip") else "",
            "route_id":   v.trip.route_id   if v.HasField("trip") else "",
            "direction":  v.trip.direction_id if v.HasField("trip") else -1,
            "lat":        round(pos.latitude,  6),
            "lng":        round(pos.longitude, 6),
            "bearing":    round(pos.bearing,   1) if pos.bearing else None,
            "speed_kmh":  round(pos.speed * 3.6, 1) if pos.speed else None,
            "timestamp":  v.timestamp,
            "status":     v.current_status,  # 0=IN_TRANSIT, 1=STOPPED, 2=IN_TRANSIT
            "stop_id":    v.stop_id,
        }
        if route_id and rec["route_id"] != route_id:
            continue
        vehicles.append(rec)

    return {
        "vehicles": vehicles,
        "count":    len(vehicles),
        "feed_ts":  feed.header.timestamp if feed.header else 0,
    }


# ── /realtime/station/{stop_id} ───────────────────────────────
@router.get("/station/{stop_id}")
def get_station_realtime(stop_id: str):
    """Combined endpoint: ETAs + any alerts for this stop."""
    trips_data  = get_trips(stop_id, limit=6)
    alerts_data = get_alerts()

    # Filter alerts that mention this stop
    relevant_alerts = [
        a for a in alerts_data["alerts"]
        if any(e.get("stop_id") == stop_id for e in a["affected"])
        or not a["affected"]  # network-wide alerts
    ][:3]

    return {
        "stop_id":  stop_id,
        "arrivals": trips_data["arrivals"],
        "alerts":   relevant_alerts,
        "feed_ts":  trips_data.get("feed_ts", 0),
    }
