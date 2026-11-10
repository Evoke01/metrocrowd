#!/usr/bin/env python3
# ══════════════════════════════════════════════════════════════
#  ml/predict_all.py
#  Runs ML predictions for every station × every hour × today's DOW
#  Writes results to Supabase ml_predictions table via upsert_predictions().
#  Called by worker.py every hour.
# ══════════════════════════════════════════════════════════════
import os
from datetime import datetime
from zoneinfo import ZoneInfo
from supabase import create_client
from ml.model import predict, load_model

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
IST = ZoneInfo("Asia/Kolkata")

# Station list (in production, fetch from Supabase gtfs_stops)
# For now, import from the static data as a fallback reference
STATION_LINES: dict[str, str] = {}  # station_id → line name, loaded from DB

def _load_stations(client) -> dict[str, str]:
    """Load all stations and their primary line from Supabase."""
    resp = client.table("gtfs_stops").select("stop_id,name").execute()
    # Line information comes from crowd_reports where available. Include all
    # GTFS stops so stations without a report still receive fallback forecasts.
    lines_resp = client.table("crowd_reports") \
        .select("station_id,line_codes") \
        .limit(1000).execute()
    line_map = {}
    for row in lines_resp.data:
        if row["station_id"] not in line_map and row.get("line_codes"):
            line_map[row["station_id"]] = row["line_codes"][0] if row["line_codes"] else "Yellow"
    stations = {row["stop_id"]: line_map.get(row["stop_id"], "Yellow")
                for row in (resp.data or []) if row.get("stop_id")}
    stations.update(line_map)
    return stations

def _get_historical_avgs(client) -> dict[str, float]:
    """Get average crowd value per station from crowd_reports."""
    try:
        resp = client.rpc("get_station_averages", {}).execute()
        if resp.data:
            return {row["station_id"]: row["avg_crowd"] for row in resp.data}
    except Exception:
        pass
    # Fallback: query directly
    resp = client.table("crowd_reports").select("station_id,crowd_value").execute()
    from collections import defaultdict
    sums, counts = defaultdict(float), defaultdict(int)
    for row in resp.data:
        sums[row["station_id"]]   += row["crowd_value"]
        counts[row["station_id"]] += 1
    return {sid: sums[sid]/counts[sid] for sid in sums}

def run() -> int:
    client   = create_client(SUPABASE_URL, SUPABASE_KEY)
    now      = datetime.now(IST)
    dow      = now.weekday()
    model    = load_model()  # None = fall back to historical avg in predict()
    hist     = _get_historical_avgs(client)
    lines    = _load_stations(client)

    rows = []
    for station_id, line in lines.items():
        h_avg = hist.get(station_id, 40.0)
        for hour in range(24):
            dt = now.replace(hour=hour, minute=0, second=0)
            result = predict(station_id, line, dt, h_avg, h_avg)
            rows.append({
                "station_id":  station_id,
                "hour":        hour,
                "day_of_week": dow,
                "crowd_pct":   result["crowd_pct"],
                "confidence":  result["confidence"],
                "model_ver":   "1.0" if model else "fallback",
            })

    if not rows:
        return 0

    # Write via the SQL function (handles upsert efficiently)
    import json
    client.rpc("upsert_predictions", {"rows": json.dumps(rows)}).execute()
    return len(rows)
