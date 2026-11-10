// ══════════════════════════════════════════════════════════════════
//  stats.js — Commute History & Personal Stats
//  Full screen dashboard showing last 30 trips + lifetime stats
//
//  STATS.open()  — open the screen from auth modal / nav
//  STATS.close() — close it
// ══════════════════════════════════════════════════════════════════
window.STATS = (function () {
  'use strict';

  const API = 'https://metrocrowd.onrender.com';
  let _screen = null;

  const DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const DOW_HI = ['सोम','मंगल','बुध','गुरु','शुक्र','शनि','रवि'];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  async function _getMe() {
    try { const { data } = await SB.client.auth.getUser(); return data?.user || null; }
    catch { return null; }
  }

  async function _fetch(path) {
    try {
      const r = await fetch(API + path);
      return r.json();
    } catch { return null; }
  }

  // ── Open the stats screen ─────────────────────────────────────
  async function open() {
    if (_screen) _screen.remove();

    const user = await _getMe();
    if (!user) { NAV.showToast('warn', 'Sign in to view stats'); return; }

    // Build skeleton screen immediately
    _screen = document.createElement('div');
    _screen.id = 'stats-screen';
    _screen.style.cssText = `
      position:fixed;inset:0;z-index:900;background:var(--blk);
      overflow-y:auto;padding-bottom:80px;
      font-family:'DM Sans',sans-serif;
      transform:translateY(100%);transition:transform .35s cubic-bezier(.22,1,.36,1);
    `;
    _screen.innerHTML = _skeleton();
    document.body.appendChild(_screen);
    requestAnimationFrame(() => { _screen.style.transform = 'translateY(0)'; });

    // Fetch all data in parallel
    const uid = user.id;
    const [summaryRes, tripsRes, monthlyRes] = await Promise.all([
      _fetch(`/stats/me?user_id=${uid}`),
      _fetch(`/stats/trips?user_id=${uid}&limit=30`),
      _fetch(`/stats/monthly?user_id=${uid}`),
    ]);

    const summary = summaryRes?.stats  || {};
    const trips   = tripsRes?.trips    || [];
    const monthly = monthlyRes?.monthly || [];

    _screen.innerHTML = _render(summary, trips, monthly, user);
  }

  function close() {
    if (!_screen) return;
    _screen.style.transform = 'translateY(100%)';
    setTimeout(() => { _screen?.remove(); _screen = null; }, 350);
  }

  // ── Skeleton loading state ────────────────────────────────────
  function _skeleton() {
    return `
      <div style="max-width:480px;margin:0 auto;padding:20px 16px">
        ${_header()}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
          ${[1,2,3,4].map(() => `<div style="height:80px;background:var(--card);border-radius:16px;
            animation:skPulse 1.2s ease-in-out infinite"></div>`).join('')}
        </div>
        ${[1,2,3].map(() => `<div style="height:72px;background:var(--card);border-radius:16px;
          margin-bottom:8px;animation:skPulse 1.2s ease-in-out infinite"></div>`).join('')}
      </div>
      <style>@keyframes skPulse{0%,100%{opacity:1}50%{opacity:.4}}</style>
    `;
  }

  // ── Header (back button + title) ─────────────────────────────
  function _header() {
    return `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;padding-top:8px">
        <button onclick="STATS.close()"
          style="width:36px;height:36px;border-radius:50%;background:var(--card2);
          border:1px solid var(--brd);color:var(--sub);cursor:pointer;
          display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div>
          <div style="font-family:'DM Serif Display',sans-serif;font-size:18px;font-weight:900;
            color:var(--txt)">My Commute Stats</div>
          <div style="font-size:11px;color:var(--sub)">Last 30 trips · All time</div>
        </div>
      </div>
    `;
  }

  // ── Full render ───────────────────────────────────────────────
  function _render(s, trips, monthly, user) {
    const totalTrips    = s.total_trips       || 0;
    const avgMin        = s.avg_duration_min  || 0;
    const avgEst        = s.avg_est_min       || 0;
    const minSaved      = s.total_minutes_saved || 0;
    const smartTrips    = s.smart_trips       || 0;
    const hrsSaved      = minSaved >= 60
      ? `${(minSaved/60).toFixed(1)}h` : `${Math.round(minSaved)}m`;

    // Accuracy: how close actual was to estimated
    const accuracy = avgEst > 0
      ? Math.round(Math.min(100, (1 - Math.abs(avgMin - avgEst) / avgEst) * 100))
      : null;

    // Streak: consecutive days with at least one trip
    const streak = _calcStreak(trips);

    return `
      <div style="max-width:480px;margin:0 auto;padding:20px 16px">
        ${_header()}

        <!-- Hero stat: avg commute time -->
        ${totalTrips === 0 ? _emptyState() : `

        <div style="background:linear-gradient(135deg,rgba(255,208,0,.08),rgba(255,208,0,.03));
          border:1px solid rgba(255,208,0,.2);border-radius:20px;padding:20px;
          margin-bottom:16px;text-align:center">
          <div style="font-size:11px;color:var(--sub);letter-spacing:.08em;
            text-transform:uppercase;font-family:'DM Serif Display',sans-serif;margin-bottom:6px">
            Average Commute
          </div>
          <div style="font-family:'DM Serif Display',sans-serif;font-size:52px;font-weight:900;
            color:var(--y);line-height:1">${avgMin > 0 ? avgMin : '—'}</div>
          <div style="font-size:13px;color:var(--sub);margin-top:2px">minutes</div>
          ${avgEst > 0 ? `<div style="font-size:11px;color:var(--sub);margin-top:6px">
            Estimated was ${avgEst}m · ${avgMin < avgEst
              ? `<span style="color:#4ade80">You beat the estimate by ${(avgEst-avgMin).toFixed(1)}m avg</span>`
              : `<span style="color:var(--sub)">Close to estimate</span>`}
          </div>` : ''}
        </div>

        <!-- 4 stat cards -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
          ${_statCard('Total Trips', totalTrips, 'trips',
            '<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
            'var(--y)')}
          ${_statCard('Time Saved', hrsSaved, 'vs estimates',
            '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
            '#4ade80')}
          ${_statCard('Smart Trips', smartTrips, 'beat estimate',
            '<polyline points="20 6 9 17 4 12"/>',
            '#6366f1')}
          ${_statCard('Day Streak', streak+'d', 'in a row',
            '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
            '#f97316')}
        </div>

        ${accuracy !== null ? `
        <!-- Prediction accuracy bar -->
        <div style="background:var(--card);border:1px solid var(--brd);border-radius:16px;
          padding:14px 16px;margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div style="font-size:11px;font-weight:700;color:var(--txt)">Estimate Accuracy</div>
            <div style="font-family:'DM Serif Display',sans-serif;font-size:14px;font-weight:800;
              color:${accuracy>80?'#4ade80':accuracy>60?'var(--y)':'#f87171'}">${accuracy}%</div>
          </div>
          <div style="height:6px;background:var(--brd2);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${accuracy}%;border-radius:3px;
              background:${accuracy>80?'#4ade80':accuracy>60?'var(--y)':'#f87171'};
              transition:width .8s ease"></div>
          </div>
          <div style="font-size:10px;color:var(--sub);margin-top:5px">
            How close our time estimates were to your real journeys
          </div>
        </div>` : ''}

        <!-- Monthly chart -->
        ${monthly.length > 0 ? _monthlyChart(monthly) : ''}

        <!-- Trip history list -->
        <div style="font-family:'DM Serif Display',sans-serif;font-size:10px;font-weight:800;
          color:var(--sub);letter-spacing:.08em;text-transform:uppercase;
          margin-bottom:10px;margin-top:4px">
          Recent Trips
        </div>
        ${trips.length === 0
          ? `<div style="text-align:center;padding:24px;color:var(--sub);font-size:12px">
              No trips recorded yet</div>`
          : trips.map(_tripRow).join('')}

        `}
      </div>
    `;
  }

  // ── Empty state ───────────────────────────────────────────────
  function _emptyState() {
    return `
      <div style="text-align:center;padding:48px 24px">
        <div style="font-size:48px;margin-bottom:12px">🚇</div>
        <div style="font-family:'DM Serif Display',sans-serif;font-size:16px;font-weight:800;
          color:var(--txt);margin-bottom:8px">No trips yet</div>
        <div style="font-size:12px;color:var(--sub);line-height:1.6">
          Use the Route planner and tap<br>"Start Live Navigation" to log your first trip.<br>
          Your stats will appear here automatically.
        </div>
      </div>
    `;
  }

  // ── Stat card ─────────────────────────────────────────────────
  function _statCard(label, value, sub, svgPath, color) {
    return `
      <div style="background:var(--card);border:1px solid var(--brd);border-radius:16px;
        padding:14px;display:flex;flex-direction:column;gap:4px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          style="margin-bottom:2px">${svgPath}</svg>
        <div style="font-family:'DM Serif Display',sans-serif;font-size:22px;font-weight:900;
          color:${color};line-height:1">${value}</div>
        <div style="font-size:10px;color:var(--txt);font-weight:600">${label}</div>
        <div style="font-size:9px;color:var(--sub)">${sub}</div>
      </div>
    `;
  }

  // ── Monthly bar chart ─────────────────────────────────────────
  function _monthlyChart(monthly) {
    const maxTrips = Math.max(1, ...monthly.map(m => m.trips));
    const BAR_MAX_PX = 56; // fixed pixel height for chart area
    const bars = monthly.slice().reverse().map(m => {
      const date   = new Date(m.month);
      const label  = MONTHS[date.getMonth()];
      // Use px not % — % height on flex children requires definite parent height
      const barPx  = Math.max(4, Math.round((m.trips / maxTrips) * BAR_MAX_PX));
      return `
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
          <div style="font-size:9px;color:var(--sub);font-weight:600">${m.trips}</div>
          <div style="height:${BAR_MAX_PX}px;width:100%;display:flex;align-items:flex-end">
            <div style="width:100%;height:${barPx}px;background:var(--y);
              border-radius:3px 3px 0 0;opacity:.85;transition:height .4s ease">
            </div>
          </div>
          <div style="font-size:9px;color:var(--sub)">${label}</div>
        </div>`;
    }).join('');

    return `
      <div style="background:var(--card);border:1px solid var(--brd);border-radius:16px;
        padding:14px 16px;margin-bottom:16px">
        <div style="font-size:11px;font-weight:700;color:var(--txt);margin-bottom:12px">
          Monthly Trips
        </div>
        <div style="display:flex;gap:6px;height:80px;align-items:flex-end">
          ${bars}
        </div>
      </div>
    `;
  }

  // ── Single trip row ───────────────────────────────────────────
  function _tripRow(trip) {
    const from  = METRO.STATIONS[trip.from_station]?.n || trip.from_station;
    const to    = METRO.STATIONS[trip.to_station]?.n   || trip.to_station;
    const date  = new Date(trip.started_at);
    const dow   = DOW[date.getDay() === 0 ? 6 : date.getDay() - 1];
    const time  = `${date.getHours()}:${String(date.getMinutes()).padStart(2,'0')}`;
    const dateStr = `${dow} ${date.getDate()} ${MONTHS[date.getMonth()]}`;

    const actMin = trip.actual_duration_sec ? Math.round(trip.actual_duration_sec / 60) : null;
    const estMin = trip.est_duration_sec    ? Math.round(trip.est_duration_sec    / 60) : null;

    // Performance badge
    let badge = '', badgeCol = '';
    if (actMin && estMin) {
      if (actMin <= estMin * 0.9) {
        badge = '⚡ Fast'; badgeCol = '#4ade80';
      } else if (actMin <= estMin * 1.05) {
        badge = '✓ On time'; badgeCol = 'var(--sub)';
      } else {
        badge = '↑ Delayed'; badgeCol = '#f87171';
      }
    }

    // Line colour dots
    const lineDots = (trip.line_codes || []).map(l =>
      `<div style="width:7px;height:7px;border-radius:50%;
        background:${METRO.LINE_COLORS?.[l] || '#888'};flex-shrink:0"></div>`
    ).join('');

    // Completion state
    const completed = trip.completed;
    const opacity   = completed ? '1' : '0.55';

    return `
      <div style="background:var(--card);border:1px solid var(--brd);border-radius:14px;
        padding:12px 14px;margin-bottom:8px;opacity:${opacity}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;
          margin-bottom:6px">
          <!-- Route -->
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
              <div style="display:flex;gap:3px">${lineDots}</div>
              ${badge ? `<span style="font-size:9px;font-weight:700;color:${badgeCol}">${badge}</span>` : ''}
              ${!completed ? '<span style="font-size:9px;color:var(--sub)">Cancelled</span>' : ''}
            </div>
            <div style="font-size:12px;font-weight:700;color:var(--txt);
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${from}
              <span style="color:var(--sub);font-weight:400"> → </span>
              ${to}
            </div>
            <div style="font-size:10px;color:var(--sub);margin-top:2px">
              ${dateStr} · ${time} · ${trip.total_stops || 0} stops
            </div>
          </div>
          <!-- Time -->
          <div style="text-align:right;flex-shrink:0;margin-left:12px">
            ${actMin ? `
              <div style="font-family:'DM Serif Display',sans-serif;font-size:16px;font-weight:800;
                color:var(--txt)">${actMin}m</div>
              ${estMin ? `<div style="font-size:9px;color:var(--sub)">est ${estMin}m</div>` : ''}
            ` : '<div style="font-size:10px;color:var(--sub)">—</div>'}
          </div>
        </div>

        ${actMin && estMin ? `
        <!-- Time comparison bar -->
        <div style="height:3px;background:var(--brd2);border-radius:2px;
          margin-top:6px;overflow:hidden;position:relative">
          <div style="height:100%;width:${Math.min(100, Math.round(actMin/Math.max(actMin,estMin)*100))}%;
            background:${actMin<=estMin ? '#4ade80' : '#f87171'};
            border-radius:2px;transition:width .5s ease"></div>
          ${actMin <= estMin ? '' :
            `<div style="position:absolute;top:0;left:${Math.round(estMin/actMin*100)}%;
              width:1.5px;height:100%;background:var(--sub);opacity:.5"></div>`}
        </div>` : ''}
      </div>
    `;
  }

  // ── Streak calculator ─────────────────────────────────────────
  function _calcStreak(trips) {
    if (!trips.length) return 0;
    // Use YYYY-MM-DD strings in IST to avoid DST millisecond drift
    function _toISTDate(ts) {
      const d = new Date(ts);
      // IST = UTC+5:30 → add 330 min
      const ist = new Date(d.getTime() + 330 * 60000);
      return ist.toISOString().slice(0, 10); // "YYYY-MM-DD"
    }
    function _addDays(dateStr, n) {
      const d = new Date(dateStr + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    }

    const days = [...new Set(trips.map(t => _toISTDate(t.started_at)))];
    // days[0] is most recent (trips ordered desc). Check it's today or yesterday IST.
    const todayIST = _toISTDate(new Date().toISOString());
    const yestIST  = _addDays(todayIST, -1);
    if (days[0] !== todayIST && days[0] !== yestIST) return 0;

    let streak = 1;
    for (let i = 0; i < days.length - 1; i++) {
      // Each next day in the sorted-desc array should be exactly 1 day earlier
      if (days[i + 1] === _addDays(days[i], -1)) streak++;
      else break;
    }
    return streak;
  }

  return { open, close };
})();
