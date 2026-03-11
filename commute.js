// ─────────────────────────────────────────────────────────────────────────────
//  COMMUTE.js — Smart Commute Mode
//  • User sets Home station + Work station once
//  • Auto-detects direction: morning = home→work, evening = work→home
//  • Shows live crowd, coach pick, journey time on home screen
//  • "Leaving now" button pre-fills Route tab instantly
//  • Remembers usual leave time per direction
// ─────────────────────────────────────────────────────────────────────────────
window.COMMUTE = (function () {
  'use strict';

  const KEY = 'mc_commute_v1';

  // ── STATE ─────────────────────────────────────────────────────────────────
  let state = _load();

  function _load() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || _blank();
    } catch { return _blank(); }
  }

  function _blank() {
    return {
      homeId:    null,   // station ID
      workId:    null,
      homeName:  '',
      workName:  '',
      enabled:   false,
      // learned leave times (hour, 24h)
      leaveHome: 8,      // default 8am
      leaveWork: 18,     // default 6pm
    };
  }

  function _save() {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  // ── DIRECTION LOGIC ───────────────────────────────────────────────────────
  // Returns 'toWork' | 'toHome' | null
  function getDirection() {
    if (!state.enabled || !state.homeId || !state.workId) return null;
    const h = new Date().getHours();
    // Morning window: 5am–12pm → home to work
    if (h >= 5  && h <= 12) return 'toWork';
    // Evening window: 3pm–11pm → work to home
    if (h >= 15 && h <= 23) return 'toHome';
    return null;
  }

  function getTrip() {
    const dir = getDirection();
    if (!dir) return null;
    return {
      dir,
      fromId:   dir === 'toWork' ? state.homeId  : state.workId,
      toId:     dir === 'toWork' ? state.workId  : state.homeId,
      fromName: dir === 'toWork' ? state.homeName : state.workName,
      toName:   dir === 'toWork' ? state.workName : state.homeName,
    };
  }

  // ── SETUP ─────────────────────────────────────────────────────────────────
  function setup(homeId, workId) {
    const hs = METRO.STATIONS[homeId];
    const ws = METRO.STATIONS[workId];
    if (!hs || !ws) return false;
    state.homeId   = homeId;
    state.workId   = workId;
    state.homeName = hs.n;
    state.workName = ws.n;
    state.enabled  = true;
    _save();
    renderCard();
    return true;
  }

  function disable() {
    state.enabled = false;
    _save();
    renderCard();
  }

  // Record actual leave time to improve future suggestions
  function recordLeaveNow() {
    const dir = getDirection();
    const h   = new Date().getHours();
    if (dir === 'toWork')  state.leaveHome = h;
    if (dir === 'toHome')  state.leaveWork = h;
    _save();
  }

  // ── CARD RENDER ───────────────────────────────────────────────────────────
  async function renderCard() {
    const el = document.getElementById('commute-card');
    if (!el) return;

    // Not set up yet
    if (!state.enabled || !state.homeId || !state.workId) {
      el.innerHTML = _setupPrompt();
      return;
    }

    const trip = getTrip();

    // Outside commute hours
    if (!trip) {
      el.innerHTML = _offHoursCard();
      return;
    }

    // Loading state
    el.innerHTML = _loadingCard(trip);

    // Fetch live data
    try {
      const [crowdFrom, crowdTo] = await Promise.all([
        API.getCrowd(trip.fromId, _lineFor(trip.fromId)).catch(() => ({ crowd_pct: 0 })),
        API.getCrowd(trip.toId,   _lineFor(trip.toId)).catch(()   => ({ crowd_pct: 0 })),
      ]);

      const fromPct  = crowdFrom.crowd_pct || 0;
      const toPct    = crowdTo.crowd_pct   || 0;
      const avgCrowd = Math.round((fromPct + toPct) / 2);

      // Get coach recommendation
      const line  = _lineFor(trip.fromId);
      const coach = window.COACH?.recommend(trip.fromId, line, fromPct, trip.toId);
      const bestCoach = coach?.best?.num || null;

      // Estimate journey time (rough: 2.5 min per station on BFS path)
      let stops = 0;
      if (window.ROUTE) {
        try {
          const path = ROUTE.findPath(trip.fromId, trip.toId, false);
          stops = path?.legs?.reduce((a, l) => a + (l.stops || 0), 0) || 0;
        } catch {}
      }
      const mins = stops > 0 ? Math.round(stops * 2.5) : null;

      el.innerHTML = _activeCard(trip, fromPct, avgCrowd, bestCoach, line, mins);
    } catch (e) {
      el.innerHTML = _activeCard(trip, 0, 0, null, _lineFor(trip.fromId), null);
    }
  }

  function _lineFor(stationId) {
    return METRO.STATIONS[stationId]?.l?.[0] || 'Y';
  }

  // ── HTML BUILDERS ─────────────────────────────────────────────────────────

  function _crowdColor(p) {
    if (p < 40) return '#4ade80';
    if (p < 70) return '#fbbf24';
    return '#f87171';
  }

  function _crowdWord(p) {
    if (p === 0)  return 'No data';
    if (p < 30)   return 'Empty';
    if (p < 50)   return 'Light';
    if (p < 70)   return 'Moderate';
    if (p < 85)   return 'Busy';
    return 'Packed';
  }

  function _setupPrompt() {
    return `
      <div id="commute-setup-card" style="background:var(--card);border:1px dashed rgba(245,168,0,.4);
        border-radius:18px;padding:16px;margin-bottom:12px;cursor:pointer"
        onclick="COMMUTE.openSetup()">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:44px;height:44px;border-radius:14px;background:rgba(245,168,0,.12);
            display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F5A800" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
          <div style="flex:1">
            <div style="font-family:'Syne',sans-serif;font-size:13px;font-weight:800;color:var(--txt)">Set up Smart Commute</div>
            <div style="font-size:10px;color:var(--sub);margin-top:2px">Auto crowd updates for your daily route</div>
          </div>
          <div style="color:var(--y);font-size:18px">›</div>
        </div>
        <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap">
          ${['Live crowd on your route','Coach recommendation','One-tap navigation','Smart direction switching'].map(f =>
            `<div style="font-size:9px;padding:3px 8px;border-radius:20px;background:rgba(245,168,0,.08);
              color:var(--y);border:1px solid rgba(245,168,0,.2)">${f}</div>`
          ).join('')}
        </div>
      </div>`;
  }

  function _offHoursCard() {
    const dir = new Date().getHours() < 5 ? 'toWork' : 'toHome';
    const next = dir === 'toWork'
      ? `Commute to ${state.workName} starts at ${_fmtH(state.leaveHome)}`
      : `Commute home starts at ${_fmtH(state.leaveWork)}`;
    return `
      <div style="background:var(--card);border:1px solid var(--brd);border-radius:18px;
        padding:14px 16px;margin-bottom:12px;display:flex;align-items:center;gap:12px">
        <div style="width:40px;height:40px;border-radius:12px;background:var(--card2);
          display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--sub)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>
        <div style="flex:1">
          <div style="font-size:11px;font-weight:700;color:var(--txt)">Next commute</div>
          <div style="font-size:10px;color:var(--sub);margin-top:2px">${next}</div>
        </div>
        <div onclick="COMMUTE.openSetup()" style="font-size:9px;color:var(--sub);cursor:pointer;
          padding:4px 8px;border:1px solid var(--brd);border-radius:8px">Edit</div>
      </div>`;
  }

  function _loadingCard(trip) {
    return `
      <div style="background:var(--card);border:1px solid var(--brd);border-radius:18px;
        padding:16px;margin-bottom:12px;opacity:.7">
        <div style="font-size:9px;color:var(--y);letter-spacing:.1em;text-transform:uppercase;
          font-family:'Syne',sans-serif;margin-bottom:10px;display:flex;align-items:center;gap:6px">
          <div class="ldot"></div>
          ${trip.dir === 'toWork' ? 'MORNING COMMUTE' : 'EVENING COMMUTE'}
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <div style="font-size:13px;font-weight:700;color:var(--txt)">${trip.fromName}</div>
          <div style="color:var(--sub)">→</div>
          <div style="font-size:13px;font-weight:700;color:var(--txt)">${trip.toName}</div>
        </div>
        <div style="font-size:10px;color:var(--sub)">Loading live data…</div>
      </div>`;
  }

  function _activeCard(trip, fromPct, avgCrowd, bestCoach, line, mins) {
    const cc  = _crowdColor(fromPct);
    const cw  = _crowdWord(fromPct);
    const tag = trip.dir === 'toWork' ? 'MORNING COMMUTE' : 'EVENING COMMUTE';
    const lc  = window.COACH?.LINE_CFG?.[line];
    const lineName = lc ? lc.name : line;
    const lineColor = lc ? lc.color : '#F5A800';

    const coachBadge = bestCoach ? `
      <div style="display:flex;align-items:center;gap:6px;padding:8px 10px;
        background:rgba(245,168,0,.07);border-radius:10px;border:1px solid rgba(245,168,0,.2)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F5A800" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="7" width="20" height="11" rx="2"/>
          <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>
          <line x1="7" y1="12" x2="17" y2="12"/>
        </svg>
        <div>
          <div style="font-size:9px;color:var(--sub)">Best coach</div>
          <div style="font-size:12px;font-weight:800;font-family:'Syne',sans-serif;color:var(--y)">Coach ${bestCoach}</div>
        </div>
      </div>` : '';

    const timeBadge = mins ? `
      <div style="display:flex;align-items:center;gap:6px;padding:8px 10px;
        background:rgba(255,255,255,.04);border-radius:10px;border:1px solid var(--brd)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--sub)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        <div>
          <div style="font-size:9px;color:var(--sub)">Journey</div>
          <div style="font-size:12px;font-weight:800;font-family:'Syne',sans-serif;color:var(--txt)">~${mins} min</div>
        </div>
      </div>` : '';

    return `
      <div style="background:var(--card);border:1px solid var(--brd);border-radius:18px;
        padding:16px;margin-bottom:12px;position:relative;overflow:hidden">

        <!-- glow accent -->
        <div style="position:absolute;top:-40px;right:-40px;width:120px;height:120px;border-radius:50%;
          background:radial-gradient(circle,rgba(245,168,0,.07),transparent 70%);pointer-events:none"></div>

        <!-- header -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div style="font-size:9px;color:var(--y);letter-spacing:.1em;text-transform:uppercase;
            font-family:'Syne',sans-serif;display:flex;align-items:center;gap:5px">
            <div class="ldot"></div>${tag}
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            <div style="font-size:9px;padding:2px 7px;border-radius:8px;font-weight:700;
              background:${lineColor}18;color:${lineColor};border:1px solid ${lineColor}33">${lineName}</div>
            <div onclick="COMMUTE.openSetup()" style="font-size:9px;color:var(--sub);cursor:pointer;
              padding:2px 7px;border:1px solid var(--brd);border-radius:8px">Edit</div>
          </div>
        </div>

        <!-- route -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <div style="flex:1">
            <div style="font-size:10px;color:var(--sub);margin-bottom:1px">From</div>
            <div style="font-size:14px;font-weight:800;font-family:'Syne',sans-serif;color:var(--txt);
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${trip.fromName}</div>
          </div>
          <div style="color:var(--y);font-size:18px;font-weight:800;flex-shrink:0">→</div>
          <div style="flex:1;text-align:right">
            <div style="font-size:10px;color:var(--sub);margin-bottom:1px">To</div>
            <div style="font-size:14px;font-weight:800;font-family:'Syne',sans-serif;color:var(--txt);
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${trip.toName}</div>
          </div>
        </div>

        <!-- crowd bar -->
        <div style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <div style="font-size:10px;color:var(--sub)">Crowd at ${trip.fromName}</div>
            <div style="font-size:10px;font-weight:700;color:${cc}">${fromPct}% · ${cw}</div>
          </div>
          <div style="height:5px;background:var(--card2);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${fromPct}%;background:${cc};border-radius:3px;transition:width .8s"></div>
          </div>
        </div>

        <!-- info badges -->
        <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
          ${coachBadge}${timeBadge}
        </div>

        <!-- CTA -->
        <button onclick="COMMUTE.leaveNow()" style="width:100%;height:46px;
          background:var(--y);border:none;border-radius:13px;
          font-family:'Syne',sans-serif;font-size:13px;font-weight:800;color:#000;
          cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;
          box-shadow:0 4px 20px rgba(245,168,0,.25);transition:transform .15s,box-shadow .15s"
          onmouseover="this.style.transform='scale(1.02)'"
          onmouseout="this.style.transform=''">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 8 16 12 12 16"/><line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
          Leaving Now
        </button>
      </div>`;
  }

  function _fmtH(h) {
    if (h === 0)  return '12:00 AM';
    if (h < 12)   return `${h}:00 AM`;
    if (h === 12) return '12:00 PM';
    return `${h-12}:00 PM`;
  }

  // ── ACTIONS ───────────────────────────────────────────────────────────────

  function leaveNow() {
    const trip = getTrip();
    if (!trip) return;
    recordLeaveNow();
    // Pre-fill Route tab and switch to it
    if (window.ROUTE_UI) {
      ROUTE_UI.setStation('from', trip.fromId);
      ROUTE_UI.setStation('to',   trip.toId);
    }
    if (window.UI) UI.navTo('s-route');
  }

  // ── SETUP MODAL ───────────────────────────────────────────────────────────
  function openSetup() {
    // Remove existing if any
    document.getElementById('commute-modal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'commute-modal';
    modal.style.cssText = `position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.88);
      backdrop-filter:blur(10px);display:flex;align-items:flex-end;justify-content:center`;

    modal.innerHTML = `
      <div style="background:#111;border-radius:24px 24px 0 0;padding:24px 20px calc(36px + env(safe-area-inset-bottom));
        width:100%;max-width:480px;border-top:1px solid #222">

        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
          <div style="font-family:'Syne',sans-serif;font-size:16px;font-weight:800;color:#fff">Smart Commute</div>
          <button onclick="document.getElementById('commute-modal').remove()"
            style="background:#1e1e1e;border:1px solid #333;color:#666;width:30px;height:30px;
            border-radius:50%;font-size:14px;cursor:pointer">✕</button>
        </div>

        <!-- Home station -->
        <div style="margin-bottom:12px">
          <div style="font-size:10px;color:var(--sub);margin-bottom:6px;letter-spacing:.05em">🏠 HOME STATION</div>
          <div id="cm-home-row" onclick="COMMUTE._pickStation('home')"
            style="background:#1a1a1a;border:1px solid #333;border-radius:12px;
            padding:12px 14px;cursor:pointer;display:flex;align-items:center;justify-content:space-between">
            <div id="cm-home-val" style="font-size:13px;font-weight:600;color:${state.homeName ? '#fff' : '#555'}">
              ${_tmpHome && METRO.STATIONS[_tmpHome] ? METRO.STATIONS[_tmpHome].n : (state.homeName || 'Select home station')}
            </div>
            <div style="color:#555;font-size:16px">›</div>
          </div>
        </div>

        <!-- Work station -->
        <div style="margin-bottom:20px">
          <div style="font-size:10px;color:var(--sub);margin-bottom:6px;letter-spacing:.05em">🏢 WORK / DESTINATION</div>
          <div id="cm-work-row" onclick="COMMUTE._pickStation('work')"
            style="background:#1a1a1a;border:1px solid #333;border-radius:12px;
            padding:12px 14px;cursor:pointer;display:flex;align-items:center;justify-content:space-between">
            <div id="cm-work-val" style="font-size:13px;font-weight:600;color:${state.workName ? '#fff' : '#555'}">
              ${_tmpWork && METRO.STATIONS[_tmpWork] ? METRO.STATIONS[_tmpWork].n : (state.workName || 'Select work station')}
            </div>
            <div style="color:#555;font-size:16px">›</div>
          </div>
        </div>

        <!-- Features list -->
        <div style="background:#1a1a1a;border-radius:12px;padding:12px 14px;margin-bottom:20px">
          ${[
            ['🕐','Auto direction','Morning = home→work, Evening = work→home'],
            ['🚃','Coach pick',    'Best coach for your exact journey'],
            ['📊','Live crowd',    'Real-time % at your departure station'],
            ['⚡','One tap go',    '"Leaving Now" pre-fills the Route planner'],
          ].map(([ico,t,d]) => `
            <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:10px">
              <div style="font-size:14px;flex-shrink:0">${ico}</div>
              <div>
                <div style="font-size:11px;font-weight:700;color:#ccc">${t}</div>
                <div style="font-size:10px;color:#555;margin-top:1px">${d}</div>
              </div>
            </div>`).join('')}
        </div>

        <button id="cm-save-btn" onclick="COMMUTE._saveFromModal()"
          style="width:100%;height:48px;background:var(--y);border:none;border-radius:14px;
          font-family:'Syne',sans-serif;font-size:14px;font-weight:800;color:#000;cursor:pointer;
          margin-bottom:10px">Save Commute</button>

        ${state.enabled ? `<button onclick="COMMUTE.disable();document.getElementById('commute-modal').remove()"
          style="width:100%;height:40px;background:transparent;border:1px solid #333;border-radius:12px;
          font-size:12px;font-weight:600;color:#555;cursor:pointer">Disable Smart Commute</button>` : ''}
      </div>`;

    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if(e.target===modal) modal.remove(); });
  }

  // Temp state for modal picks
  let _tmpHome = state.homeId;
  let _tmpWork = state.workId;

  function _pickStation(which) {
    // Store which we're picking then open search
    window._commutePickTarget = which;
    if (typeof SEARCH !== 'undefined') SEARCH.open('commute-pick');
  }

  function _onSearchPick(id) {
    const s = METRO.STATIONS[id]; if (!s) return;
    const which = window._commutePickTarget;
    if (which === 'home') {
      _tmpHome = id;
      state.homeName = s.n; // update immediately for display
    } else {
      _tmpWork = id;
      state.workName = s.n;
    }
    // Re-open the setup modal (search overlay closed it)
    setTimeout(() => openSetup(), 80);
  }

  function _saveFromModal() {
    if (!_tmpHome || !_tmpWork) {
      alert('Please select both home and work stations.');
      return;
    }
    setup(_tmpHome, _tmpWork);
    document.getElementById('commute-modal')?.remove();
  }

  // ── AUTO REFRESH ──────────────────────────────────────────────────────────
  function init() {
    _tmpHome = state.homeId;
    _tmpWork = state.workId;
    renderCard();
    // Refresh every 3 minutes
    setInterval(renderCard, 3 * 60 * 1000);
  }

  return {
    init, renderCard, setup, disable,
    leaveNow, openSetup, getTrip, getDirection,
    _pickStation, _onSearchPick, _saveFromModal,
    get state() { return state; },
  };
})();
