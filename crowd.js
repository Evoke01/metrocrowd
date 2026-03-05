// ══════════════════════════════════════════════════════════════════
//  CROWD ENGINE  — combines DMRC timetable model + events + reports
// ══════════════════════════════════════════════════════════════════
window.CROWD = (function() {
  const state = {
    hour: new Date().getHours(),
    isLive: true,
    userReports: {},   // id → 'empty'|'moderate'|'packed'
    newsEvents: [],    // from GNews API
    crowdMap: {}
  };

  function compute(id) {
    const s = METRO.STATIONS[id];
    if (!s) return 0;

    // Base prediction from DMRC timetable model
    let v = s.b * METRO.RUSH[state.hour];

    // Apply news event boosts (auto-detected from GNews API)
    state.newsEvents.forEach(ev => {
      if (ev.active && ev.affected.includes(id)) v *= ev.boost;
    });

    // Blend with user crowdsource report (40% weight)
    if (state.userReports[id]) {
      const rv = state.userReports[id] === 'empty' ? 14 :
                 state.userReports[id] === 'moderate' ? 50 : 88;
      v = v * 0.6 + rv * 0.4;
    }

    return Math.min(100, Math.max(5, Math.round(v)));
  }

  function recomputeAll() {
    Object.keys(METRO.STATIONS).forEach(id => {
      state.crowdMap[id] = compute(id);
    });
    // Trigger confidence + anomaly + threshold alerts
    if(typeof NOTIFY !== 'undefined') NOTIFY.onCrowdUpdate();
  }

  // ── Helpers ──────────────────────────────────────────────────
  function color(v) {
    if (v < 36) return '#00E676';
    if (v < 61) return '#FFD600';
    if (v < 81) return '#FF6D00';
    return '#FF1744';
  }

  function label(v) {
    if (v < 36) return 'Low';
    if (v < 61) return 'Moderate';
    if (v < 81) return 'High';
    return 'Packed';
  }

  function waitLabel(v) {
    if (v < 40) return 'Board now';
    if (v < 65) return '~1 train';
    if (v < 82) return '2 trains';
    return '3+ trains';
  }

  function hourLabel(h) {
    const a = h < 12 ? 'AM' : 'PM';
    return `${(h % 12) || 12}:00 ${a}`;
  }

  // Forecast for a single station across 24h (for sparkline)
  function stationForecast(id) {
    const s = METRO.STATIONS[id];
    if (!s) return new Array(24).fill(0);
    return METRO.RUSH.map(r => Math.min(100, Math.round(s.b * r)));
  }

  // Network averages for stats
  function networkStats() {
    const vals = Object.values(state.crowdMap);
    if (!vals.length) return {};
    return {
      avg: Math.round(vals.reduce((a, v) => a + v, 0) / vals.length),
      max: Math.max(...vals),
      low: vals.filter(v => v < 36).length,
      med: vals.filter(v => v >= 36 && v < 61).length,
      hi:  vals.filter(v => v >= 61 && v < 81).length,
      pk:  vals.filter(v => v >= 81).length,
      total: vals.length,
      maxId: Object.entries(state.crowdMap).sort((a,b) => b[1]-a[1])[0]?.[0] || ''
    };
  }

  // Top N busiest stations
  function topStations(n = 10) {
    return Object.entries(state.crowdMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([id, v]) => ({ id, v, s: METRO.STATIONS[id] }));
  }

  // Interchange pressure
  function interchangePressure(n = 10) {
    return Object.entries(METRO.STATIONS)
      .filter(([, s]) => s.ix)
      .map(([id, s]) => ({ id, n: s.n, v: state.crowdMap[id] || 0 }))
      .sort((a, b) => b.v - a.v)
      .slice(0, n);
  }

  // Line averages
  function lineAverages() {
    const lineIds = {};
    Object.entries(METRO.STATIONS).forEach(([id, s]) => {
      s.l.forEach(l => {
        if (!lineIds[l]) lineIds[l] = [];
        lineIds[l].push(id);
      });
    });
    return Object.entries(lineIds).map(([l, ids]) => {
      const avg = Math.round(ids.reduce((s, id) => s + (state.crowdMap[id] || 0), 0) / ids.length);
      return { l, avg, name: METRO.LINE_NAMES[l], color: METRO.LINE_COLORS[l], count: ids.length };
    }).sort((a, b) => b.avg - a.avg);
  }

  // Network timeline (24h average across all stations)
  function networkTimeline() {
    const ids = Object.keys(METRO.STATIONS);
    return METRO.RUSH.map((r, h) => {
      const avg = ids.reduce((s, id) => s + Math.min(100, METRO.STATIONS[id].b * r), 0) / ids.length;
      return Math.round(avg);
    });
  }

  return {
    state,
    recomputeAll,
    color, label, waitLabel, hourLabel,
    stationForecast,
    networkStats, topStations, interchangePressure, lineAverages, networkTimeline
  };
})();
