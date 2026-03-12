# ══════════════════════════════════════════════════════════════
#  routers/guide.py — Platform & Exit Gate Guide
#
#  GET /guide/station/{station_id}
#       → all gates + platforms for a station
#
#  GET /guide/journey?from=X&to=Y&line=B
#       → which platform to board at origin
#       → which gate to exit at destination
#       → transfer platform if line change
# ══════════════════════════════════════════════════════════════
import os, logging
from fastapi import APIRouter, Query, HTTPException
from supabase import create_client

router = APIRouter()
logger = logging.getLogger(__name__)
SB_URL = os.environ["SUPABASE_URL"]
SB_KEY = os.environ["SUPABASE_KEY"]

# Line terminal IDs — used to determine direction
LINE_TERMINALS = {
    'Y':  ('samaypur-badli',    'huda-city-centre'),
    'B':  ('dwarka-sec-21',     'vaishali'),        # Noida branch shares same platform logic
    'R':  ('rithala',           'shaheed-sthal'),
    'G':  ('inderlok',          'brigadier-hoshiyar-singh'),
    'V':  ('kashmere-gate',     'raja-nahari-singh-ballabhgarh'),
    'O':  ('new-delhi',         'dwarka-sec-21'),
    'M':  ('janakpuri-west',    'botanical-garden'),
    'P':  ('majlis-park',       'shiv-vihar'),
    'Gr': ('dwarka',            'najafgarh'),
    'Aq': ('noida-sec-51',      'depot'),
}

def _db():
    return create_client(SB_URL, SB_KEY)

def _toward_terminal(line, destination_id, all_station_ids_on_line):
    """
    Given a line and destination, return which terminal the train is heading toward.
    We look up where destination sits relative to the midpoint of the line.
    Falls back to terminal_b if unknown.
    """
    terminals = LINE_TERMINALS.get(line)
    if not terminals:
        return None
    t_a, t_b = terminals
    # If destination IS a terminal, that's the toward
    if destination_id == t_a:
        return t_a
    if destination_id == t_b:
        return t_b
    # Use index position in the station list to determine direction
    try:
        idx_dest = all_station_ids_on_line.index(destination_id)
        midpoint = len(all_station_ids_on_line) / 2
        return t_a if idx_dest < midpoint else t_b
    except ValueError:
        return t_b

@router.get("/station/{station_id}")
async def station_guide(station_id: str):
    """Full platform + gate info for one station."""
    db = _db()
    platforms = db.table("station_platforms").select("*") \
                  .eq("station_id", station_id).execute()
    gates = db.table("station_gates").select("*") \
              .eq("station_id", station_id).execute()
    recs  = db.table("gate_recommendations").select("*") \
              .eq("station_id", station_id).execute()

    return {
        "ok":              True,
        "station_id":      station_id,
        "platforms":       platforms.data or [],
        "gates":           gates.data    or [],
        "recommendations": recs.data     or [],
    }

@router.get("/journey")
async def journey_guide(
    from_id:  str = Query(..., alias="from"),
    to_id:    str = Query(..., alias="to"),
    line:     str = Query(...),
    via_line: str = Query(default=None),  # second line if there's a transfer
    via_at:   str = Query(default=None),  # interchange station_id
):
    """
    Given a journey (from → to on line, optionally with a transfer),
    return:
      - board_platform: which platform to stand on at origin
      - board_direction: which terminal you're heading toward
      - exit_gates: best gates at destination + what's nearby
      - transfer_platform: if there's a line change, which platform at the interchange
    """
    db = _db()

    # ── 1. Get all station IDs on the origin line (ordered) ──
    all_platforms = db.table("station_platforms") \
                      .select("station_id,toward_id,platform_no") \
                      .eq("line_code", line).execute()
    station_ids_on_line = list({r["station_id"] for r in (all_platforms.data or [])})

    # ── 2. Determine which terminal the train goes toward ─────
    toward = _toward_terminal(line, to_id if not via_at else via_at,
                              station_ids_on_line)

    # ── 3. Look up origin platform for that direction ─────────
    origin_platform = None
    if toward:
        r = db.table("station_platforms").select("platform_no,side") \
              .eq("station_id", from_id) \
              .eq("line_code", line) \
              .eq("toward_id", toward).execute()
        if r.data:
            origin_platform = r.data[0]

    # ── 4. Transfer platform (if line change) ─────────────────
    transfer_platform = None
    if via_at and via_line:
        # Determine direction on second line
        all_p2 = db.table("station_platforms").select("station_id") \
                   .eq("line_code", via_line).execute()
        ids_line2 = list({r["station_id"] for r in (all_p2.data or [])})
        toward2 = _toward_terminal(via_line, to_id, ids_line2)
        if toward2:
            r2 = db.table("station_platforms").select("platform_no,side,toward") \
                   .eq("station_id", via_at) \
                   .eq("line_code", via_line) \
                   .eq("toward_id", toward2).execute()
            if r2.data:
                transfer_platform = {**r2.data[0], "station_id": via_at, "line": via_line}

    # ── 5. Exit gates at destination ──────────────────────────
    dest_gates = db.table("station_gates").select("*") \
                   .eq("station_id", to_id).execute()
    dest_recs  = db.table("gate_recommendations").select("*") \
                   .eq("station_id", to_id).execute()

    # ── 6. Terminal name for the board direction ──────────────
    toward_name = None
    if toward and all_platforms.data:
        match = next((r for r in all_platforms.data
                      if r["station_id"] == from_id and r.get("toward_id") == toward), None)
        if match:
            # Get the toward display name from the platform row
            r3 = db.table("station_platforms").select("toward") \
                   .eq("station_id", from_id) \
                   .eq("line_code", line) \
                   .eq("toward_id", toward).execute()
            if r3.data:
                toward_name = r3.data[0]["toward"]

    return {
        "ok":               True,
        "from_id":          from_id,
        "to_id":            to_id,
        "line":             line,
        "board_platform":   origin_platform,
        "board_toward":     toward_name or toward,
        "transfer_platform":transfer_platform,
        "destination_gates":dest_gates.data or [],
        "gate_recommendations": dest_recs.data or [],
    }
