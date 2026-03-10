# ══════════════════════════════════════════════════════════════
#  pipeline/gtfs.py
#  Downloads Delhi Metro GTFS from Open Transit Data (OTD),
#  parses stops.txt and stop_times.txt, stores in Supabase.
# ══════════════════════════════════════════════════════════════
import io, os, zipfile, requests, csv
from supabase import create_client

GTFS_URL     = "https://otd.delhi.gov.in/api/realtime/DelhiMetro.zip"
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

def download_gtfs() -> zipfile.ZipFile:
    print("[GTFS] Downloading feed…")
    r = requests.get(GTFS_URL, timeout=30)
    r.raise_for_status()
    return zipfile.ZipFile(io.BytesIO(r.content))

def parse_stops(zf: zipfile.ZipFile) -> list[dict]:
    """Parse stops.txt → list of station dicts."""
    with zf.open("stops.txt") as f:
        reader = csv.DictReader(io.TextIOWrapper(f))
        return [
            {
                "stop_id":   row["stop_id"],
                "name":      row["stop_name"],
                "lat":       float(row["stop_lat"]),
                "lon":       float(row["stop_lon"]),
            }
            for row in reader
        ]

def parse_routes(zf: zipfile.ZipFile) -> dict:
    """Parse routes.txt → {route_id: route_name}"""
    with zf.open("routes.txt") as f:
        reader = csv.DictReader(io.TextIOWrapper(f))
        return {row["route_id"]: row["route_long_name"] for row in reader}

def parse_stop_times(zf: zipfile.ZipFile) -> list[dict]:
    """Parse stop_times.txt for timetable data."""
    with zf.open("stop_times.txt") as f:
        reader = csv.DictReader(io.TextIOWrapper(f))
        return [
            {
                "trip_id":        row["trip_id"],
                "stop_id":        row["stop_id"],
                "arrival_time":   row["arrival_time"],
                "departure_time": row["departure_time"],
                "stop_sequence":  int(row["stop_sequence"]),
            }
            for row in reader
        ]

def sync_to_supabase(stops: list[dict]):
    """Upsert parsed stops into Supabase gtfs_stops table."""
    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    # Upsert in batches of 200
    for i in range(0, len(stops), 200):
        batch = stops[i:i+200]
        client.table("gtfs_stops").upsert(batch, on_conflict="stop_id").execute()
    print(f"[GTFS] Synced {len(stops)} stops to Supabase")

def run():
    zf    = download_gtfs()
    stops = parse_stops(zf)
    sync_to_supabase(stops)
    return stops

if __name__ == "__main__":
    run()
