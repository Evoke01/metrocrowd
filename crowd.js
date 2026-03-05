// ══════════════════════════════════════════════════════════════════
//  CROWD ENGINE  — DMRC timetable model + service hours + events + reports
//
//  Service hours are per-line, scraped from official DMRC/NMRC sources.
//  Each station's window = widest span across all its lines.
//
//  Compute pipeline (per station, per hour):
//    1. Service hours gate  → 0 if metro closed
//    2. Ramp multiplier     → tapers crowd at open/close edges
//    3. Base prediction     → station_base × RUSH[hour]
//    4. News event boosts   → multiply by active event boost
//    5. User report blend   → 60% model + 40% crowdsource
// ══════════════════════════════════════════════════════════════════
window.CROWD = (function() {
  const state = {
    hour: new Date().getHours(),
    isLive: true,
    userReports: {},
    newsEvents: [],
    crowdMap: {}
  };

  // ── Service-hour ramp table ──────────────────────────────────
  // Returns a 0–1 multiplier for edges of service window.
  // Metro doesn't go from 0→full instantly — there's a build-up
  // in the first two hours and a wind-down in the last two.
  //
  //  open+0  (e.g. 5 AM): first trains just departing terminals → 30%
  //  open+1  (e.g. 6 AM): filling up                            → 72%
  //  open+2+ :            full operation                        → 100%
  //  close-1 (e.g. 22):   last trains approaching              → 65%
  //  close   (e.g. 23):   final trains, platforms thinning     → 28%
  //  outside window      :                                      → 0
  function serviceRamp(h, open, close) {
    if (h < open || h > close) return 0;
    if (h === open)       return 0.30;
    if (h === open + 1)   return 0.72;
    if (h === close)      return 0.28;
    if (h === close - 1)  return 0.65;
    return 1.0;
  }

  // ── Core compute ─────────────────────────────────────────────
  function compute(id) {
    const s = METRO.STATIONS[id];
    if (!s) return 0;

    // 1. Service hours gate
    const sh  = METRO.stationServiceHours(id);
    const ramp = serviceRamp(state.hour, sh.open, sh.close);
    if (ramp === 0) return 0;

    // 2. Base prediction × ramp
    let v = s.b * METRO.RUSH[state.hour] * ramp;

    // 3. News event boosts (operational events only)
    state.newsEvents.forEach(ev => {
      if (ev.active && ev.category !== 'informational' && (ev.affected||[]).includes(id)){
        v *= ev.boost;
      }
    });

    // 4. User report blend (40% weight)
    if (state.userReports[id]) {
      const rv = state.userReports[id] === 'empty'    ? 14
               : state.userReports[id] === 'moderate' ? 50
               :                                         88;
      v = v * 0.6 + rv * 0.4;
    }

    // Closed stations can truly be 0; open stations have floor of 2
    return Math.min(100, Math.max(2, Math.round(v)));
  }

  // ── Model-only value (no reports) — used by anomaly detection ─
  function modelValue(id, hour) {
    const s = METRO.STATIONS[id];
    if (!s) return 0;
    const sh   = METRO.stationServiceHours(id);
    const ramp = serviceRamp(hour ?? state.hour, sh.open, sh.close);
    if (ramp === 0) return 0;
    return Math.min(100, Math.max(0, Math.round(s.b * METRO.RUSH[hour ?? state.hour] * ramp)));
  }

  function recomputeAll() {
    Object.keys(METRO.STATIONS).forEach(id => {
      state.crowdMap[id] = compute(id);
    });
    if (typeof NOTIFY !== 'undefined') NOTIFY.onCrowdUpdate();
  }

  // ── Helpers ──────────────────────────────────────────────────
  function color(v) {
    if (v === 0)   return '#3E5272';  // closed — muted
    if (v < 36)    return '#00E676';
    if (v < 61)    return '#FFD600';
    if (v < 81)    return '#FF6D00';
    return '#FF1744';
  }

  function label(v) {
    if (v === 0)  return 'Closed';
    if (v < 36)   return 'Low';
    if (v < 61)   return 'Moderate';
    if (v < 81)   return 'High';
    return 'Packed';
  }

  function waitLabel(v) {
    if (v === 0)  return 'Closed now';
    if (v < 40)   return 'Board now';
    if (v < 65)   return '~1 train';
    if (v < 82)   return '2 trains';
    return '3+ trains';
  }

  function hourLabel(h) {
    const a = h < 12 ? 'AM' : 'PM';
    return `${(h % 12) || 12}:00 ${a}`;
  }

  // ── Forecast for station sparkline (24h, respects service hours) ─
  function stationForecast(id) {
    const s = METRO.STATIONS[id];
    if (!s) return new Array(24).fill(0);
    const sh = METRO.stationServiceHours(id);
    return METRO.RUSH.map((r, h) => {
      const ramp = serviceRamp(h, sh.open, sh.close);
      if (ramp === 0) return 0;
      return Math.min(100, Math.round(s.b * r * ramp));
    });
  }

  // ── Network stats (exclude closed stations from averages) ───
  function networkStats() {
    const entries = Object.entries(state.crowdMap);
    const open    = entries.filter(([,v]) => v > 0);
    const vals    = open.map(([,v]) => v);
    const allVals = entries.map(([,v]) => v);
    if (!vals.length) return { avg:0, max:0, low:0, med:0, hi:0, pk:0, total:entries.length, maxId:'' };
    return {
      avg:   Math.round(vals.reduce((a,v) => a+v, 0) / vals.length),
      max:   Math.max(...vals),
      low:   vals.filter(v => v > 0 && v < 36).length,
      med:   vals.filter(v => v >= 36 && v < 61).length,
      hi:    vals.filter(v => v >= 61 && v < 81).length,
      pk:    vals.filter(v => v >= 81).length,
      closed:allVals.filter(v => v === 0).length,
      total: entries.length,
      maxId: open.sort((a,b) => b[1]-a[1])[0]?.[0] || ''
    };
  }

  function topStations(n = 10) {
    return Object.entries(state.crowdMap)
      .filter(([,v]) => v > 0)   // don't list closed stations as "busiest"
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([id, v]) => ({ id, v, s: METRO.STATIONS[id] }));
  }

  function interchangePressure(n = 10) {
    return Object.entries(METRO.STATIONS)
      .filter(([, s]) => s.ix)
      .map(([id, s]) => ({ id, n: s.n, v: state.crowdMap[id] || 0 }))
      .sort((a, b) => b.v - a.v)
      .slice(0, n);
  }

  function lineAverages() {
    const lineIds = {};
    Object.entries(METRO.STATIONS).forEach(([id, s]) => {
      s.l.forEach(l => {
        if (!lineIds[l]) lineIds[l] = [];
        lineIds[l].push(id);
      });
    });
    return Object.entries(lineIds).map(([l, ids]) => {
      // Average of open stations on this line only
      const openIds = ids.filter(id => (state.crowdMap[id]||0) > 0);
      const avg = openIds.length
        ? Math.round(openIds.reduce((s, id) => s + (state.crowdMap[id]||0), 0) / openIds.length)
        : 0;
      const sh = METRO.SERVICE_HOURS[l];
      const h  = state.hour;
      const isOpen = sh && h >= sh.open && h <= sh.close;
      return { l, avg, name: METRO.LINE_NAMES[l], color: METRO.LINE_COLORS[l],
               count: ids.length, isOpen,
               firstTrain: sh?.firstTrain||'—', lastTrain: sh?.lastTrain||'—' };
    }).sort((a, b) => {
      // Open lines first, then by avg
      if(a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
      return b.avg - a.avg;
    });
  }

  // ── Network timeline (24h, respects per-station service hours) ─
  function networkTimeline() {
    const ids = Object.keys(METRO.STATIONS);
    return METRO.RUSH.map((r, h) => {
      let sum = 0, count = 0;
      ids.forEach(id => {
        const s    = METRO.STATIONS[id];
        const sh   = METRO.stationServiceHours(id);
        const ramp = serviceRamp(h, sh.open, sh.close);
        if (ramp > 0) { sum += Math.min(100, s.b * r * ramp); count++; }
      });
      return count ? Math.round(sum / count) : 0;
    });
  }

  return {
    state,
    recomputeAll,
    modelValue,
    color, label, waitLabel, hourLabel,
    stationForecast,
    networkStats, topStations, interchangePressure, lineAverages, networkTimeline
  };
})();
