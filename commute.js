// ─────────────────────────────────────────────────────────────────────────────
//  COMMUTE.js — Smart Commute Mode
//  When set up: replaces the hero card on the home screen with commute info.
//  When not active hour: shows default hero card with a subtle "commute" label.
//  Station picker: opens SEARCH overlay, re-opens modal after pick.
// ─────────────────────────────────────────────────────────────────────────────
window.COMMUTE = (function () {
  'use strict';

  const KEY = 'mc_commute_v1';
  let state  = _load();
  let _tmpHome = null, _tmpWork = null;

  function _load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || _blank(); }
    catch { return _blank(); }
  }
  function _blank() {
    return { homeId: null, workId: null, homeName: '', workName: '',
             enabled: false, leaveHome: 8, leaveWork: 18 };
  }
  function _save() { localStorage.setItem(KEY, JSON.stringify(state)); }

  // ── Direction ─────────────────────────────────────────────────────────────
  function getDirection() {
    if (!state.enabled || !state.homeId || !state.workId) return null;
    const h = new Date().getHours();
    if (h >= 5  && h <= 12) return 'toWork';
    if (h >= 15 && h <= 23) return 'toHome';
    return null;
  }
  function getTrip() {
    const dir = getDirection(); if (!dir) return null;
    return {
      dir,
      fromId:   dir === 'toWork' ? state.homeId   : state.workId,
      toId:     dir === 'toWork' ? state.workId   : state.homeId,
      fromName: dir === 'toWork' ? state.homeName : state.workName,
      toName:   dir === 'toWork' ? state.workName : state.homeName,
    };
  }

  // ── Setup ─────────────────────────────────────────────────────────────────
  function setup(homeId, workId) {
    const hs = METRO.STATIONS[homeId], ws = METRO.STATIONS[workId];
    if (!hs || !ws) return false;
    state = { ...state, homeId, workId, homeName: hs.n, workName: ws.n, enabled: true };
    _save();
    renderCard();
    return true;
  }
  function disable() {
    state.enabled = false; _save(); renderCard();
  }
  function recordLeaveNow() {
    const dir = getDirection(), h = new Date().getHours();
    if (dir === 'toWork')  state.leaveHome = h;
    if (dir === 'toHome')  state.leaveWork = h;
    _save();
  }

  // ── Hero card takeover ────────────────────────────────────────────────────
  function renderCard() {
    const heroCard = document.getElementById('hero-card');
    const heroDef  = document.getElementById('hero-default');
    if (!heroCard) return;

    // Not configured — show default hero with setup button
    if (!state.enabled || !state.homeId || !state.workId) {
      if (heroDef) heroDef.style.display = 'block';
      heroCard.onclick = () => NAV.navTo('s-route');
      return;
    }

    const trip = getTrip();

    // Outside commute hours — show default hero, just update badge text
    if (!trip) {
      if (heroDef) heroDef.style.display = 'block';
      heroCard.onclick = () => NAV.navTo('s-route');
      const badge = document.getElementById('hero-commute-setup');
      if (badge) {
        const dir = new Date().getHours() < 5 ? 'toWork' : 'toHome';
        const nextH = dir === 'toWork' ? state.leaveHome : state.leaveWork;
        badge.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Next at ${_fmtH(nextH)}`;
        badge.onclick = (e) => { e.stopPropagation(); openSetup(); };
      }
      return;
    }

    // Active commute hours — take over the whole hero card
    if (heroDef) heroDef.style.display = 'none';
    heroCard.onclick = null; // leaveNow button handles tap

    // Data is local — render immediately, no loading state needed
    try {
      const line    = METRO.STATIONS[trip.fromId]?.l?.[0] || 'Y';
      const lc      = window.COACH?.LINE_CFG?.[line] || {};
      // Read from local crowd map (already computed, no network needed)
      const fromPct = CROWD.state?.crowdMap?.[trip.fromId] || 0;
      const coach    = window.COACH?.recommend(trip.fromId, line, fromPct, trip.toId);
      const bestCoach= coach?.best?.num || null;

      let mins = null;
      if (window.ROUTE) {
        try {
          const path = ROUTE.findPath?.(trip.fromId, trip.toId, false);
          const stops = path?.legs?.reduce((a, l) => a + (l.stops || 0), 0) || 0;
          if (stops > 0) mins = Math.round(stops * 2.5);
        } catch {}
      }

      heroCard.innerHTML = _commuteActive(trip, fromPct, bestCoach, lc, mins);
    } catch {
      heroCard.innerHTML = _commuteActive(trip, 0, null, {}, null);
    }
  }

  // ── HTML builders ─────────────────────────────────────────────────────────
  function _crowdColor(p) {
    return p < 40 ? '#4ade80' : p < 70 ? '#fbbf24' : '#ef4444';
  }
  function _crowdWord(p) {
    if (!p)      return 'No data';
    if (p < 30)  return 'Empty';
    if (p < 50)  return 'Light';
    if (p < 70)  return 'Moderate';
    if (p < 85)  return 'Busy';
    return 'Packed';
  }
  function _fmtH(h) {
    if (h === 0) return '12 AM'; if (h < 12) return `${h} AM`;
    if (h === 12) return '12 PM'; return `${h - 12} PM`;
  }

  function _commuteLoading(trip) {
    const tag = trip.dir === 'toWork' ? T('morning_commute') : T('evening_commute');
    return `<div style="padding:16px">
      <div style="font-size:9px;color:var(--y);letter-spacing:.1em;font-family:'DM Serif Display',sans-serif;
        display:flex;align-items:center;gap:5px;margin-bottom:10px">
        <div class="ldot"></div>${tag}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <div style="font-size:14px;font-weight:800;font-family:'DM Serif Display',sans-serif;color:var(--txt)">${trip.fromName}</div>
        <div style="color:var(--y);font-size:16px">→</div>
        <div style="font-size:14px;font-weight:800;font-family:'DM Serif Display',sans-serif;color:var(--txt)">${trip.toName}</div>
      </div>
      <div style="font-size:10px;color:var(--sub)">Loading live data…</div>
    </div>`;
  }

  function _commuteActive(trip, fromPct, bestCoach, lc, mins) {
    const cc  = _crowdColor(fromPct);
    const cw  = _crowdWord(fromPct);
    const tag = trip.dir === 'toWork' ? T('morning_commute') : T('evening_commute');
    const lineColor = lc.color || '#F5A800';
    const lineName  = lc.name  || '';

    return `
    <div style="padding:16px;position:relative;overflow:hidden">
      <!-- glow -->
      <div style="position:absolute;top:-40px;right:-40px;width:120px;height:120px;border-radius:50%;
        background:radial-gradient(circle,rgba(245,168,0,.07),transparent 70%);pointer-events:none"></div>

      <!-- header -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="font-size:9px;color:var(--y);letter-spacing:.1em;text-transform:uppercase;
          font-family:'DM Serif Display',sans-serif;display:flex;align-items:center;gap:5px">
          <div class="ldot"></div>${tag}
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          ${lineName ? `<div style="font-size:9px;padding:2px 7px;border-radius:8px;font-weight:700;
            background:${lineColor}18;color:${lineColor};border:1px solid ${lineColor}33">${lineName}</div>` : ''}
          <div onclick="event.stopPropagation();COMMUTE.openSetup()"
            style="font-size:9px;color:var(--sub);cursor:pointer;padding:2px 7px;
            border:1px solid var(--brd);border-radius:8px">Edit</div>
        </div>
      </div>

      <!-- route -->
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <div style="flex:1;min-width:0">
          <div style="font-size:9px;color:var(--sub);margin-bottom:1px">${T('from')}</div>
          <div style="font-size:15px;font-weight:900;font-family:'DM Serif Display',sans-serif;color:var(--txt);
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${trip.fromName}</div>
        </div>
        <div style="color:var(--y);font-size:20px;font-weight:900;flex-shrink:0">→</div>
        <div style="flex:1;min-width:0;text-align:right">
          <div style="font-size:9px;color:var(--sub);margin-bottom:1px">${T('to')}</div>
          <div style="font-size:15px;font-weight:900;font-family:'DM Serif Display',sans-serif;color:var(--txt);
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${trip.toName}</div>
        </div>
      </div>

      <!-- crowd bar -->
      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <div style="font-size:10px;color:var(--sub)">Crowd now</div>
          <div style="font-size:10px;font-weight:700;color:${cc}">${fromPct}% · ${cw}</div>
        </div>
        <div style="height:4px;background:var(--card2);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${fromPct}%;background:${cc};border-radius:3px;transition:width .8s"></div>
        </div>
      </div>

      <!-- badges -->
      <div style="display:flex;gap:8px;margin-bottom:14px">
        ${bestCoach ? `
        <div style="display:flex;align-items:center;gap:6px;padding:7px 10px;
          background:rgba(245,168,0,.07);border-radius:10px;border:1px solid rgba(245,168,0,.2)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#F5A800" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="7" width="20" height="11" rx="2"/><line x1="7" y1="12" x2="17" y2="12"/>
          </svg>
          <div>
            <div style="font-size:8px;color:var(--sub)">Board</div>
            <div style="font-size:12px;font-weight:900;font-family:'DM Serif Display',sans-serif;color:var(--y)">Coach ${bestCoach}</div>
          </div>
        </div>` : ''}
        ${mins ? `
        <div style="display:flex;align-items:center;gap:6px;padding:7px 10px;
          background:rgba(255,255,255,.04);border-radius:10px;border:1px solid var(--brd)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--sub)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <div>
            <div style="font-size:8px;color:var(--sub)">Journey</div>
            <div style="font-size:12px;font-weight:900;font-family:'DM Serif Display',sans-serif;color:var(--txt)">~${mins} min</div>
          </div>
        </div>` : ''}
      </div>

      <!-- CTA -->
      <button onclick="event.stopPropagation();COMMUTE.leaveNow()"
        style="width:100%;height:44px;background:var(--y);border:none;border-radius:13px;
        font-family:'DM Serif Display',sans-serif;font-size:13px;font-weight:800;color:#000;cursor:pointer;
        display:flex;align-items:center;justify-content:center;gap:8px;
        box-shadow:0 4px 20px rgba(245,168,0,.25)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 8 16 12 12 16"/>
          <line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
        Leaving Now
      </button>
    </div>`;
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  function leaveNow() {
    const trip = getTrip(); if (!trip) return;
    recordLeaveNow();
    if (window.ROUTE_UI) {
      ROUTE_UI.setStation('from', trip.fromId);
      ROUTE_UI.setStation('to',   trip.toId);
    }
    NAV.navTo('s-route');
  }

  // ── Setup modal ───────────────────────────────────────────────────────────
  function openSetup() {
    document.getElementById('commute-modal')?.remove();

    // Only seed from saved state on FIRST open — preserve any in-progress picks
    if (_tmpHome === null) _tmpHome = state.homeId;
    if (_tmpWork === null) _tmpWork = state.workId;

    const modal = document.createElement('div');
    modal.id = 'commute-modal';
    modal.style.cssText = `position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.88);
      backdrop-filter:blur(10px);display:flex;align-items:flex-end;justify-content:center`;

    modal.innerHTML = `
      <div style="background:#111;border-radius:24px 24px 0 0;padding:24px 20px
        calc(40px + env(safe-area-inset-bottom));width:100%;max-width:480px;
        border-top:1px solid #222;box-sizing:border-box">

        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
          <div style="font-family:'DM Serif Display',sans-serif;font-size:16px;font-weight:800;color:#fff">Smart Commute</div>
          <button onclick="COMMUTE._cancelSetup()"
            style="background:#1e1e1e;border:1px solid #333;color:#888;width:30px;height:30px;
            border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <!-- Home station -->
        <div style="margin-bottom:12px">
          <div style="font-size:10px;color:#666;margin-bottom:6px;display:flex;align-items:center;gap:5px">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            HOME STATION
          </div>
          <div onclick="COMMUTE._pickStation('home')"
            style="background:#1a1a1a;border:1px solid #333;border-radius:12px;
            padding:13px 14px;cursor:pointer;display:flex;align-items:center;justify-content:space-between">
            <div id="cm-home-val" style="font-size:13px;font-weight:600;
              color:${_tmpHome ? '#fff' : '#555'}">
              ${_tmpHome && METRO.STATIONS[_tmpHome] ? METRO.STATIONS[_tmpHome].n : 'Select home station'}
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>
          <button onclick="COMMUTE._useCurrentFor('home')"
            style="margin-top:7px;background:transparent;border:1px solid #333;border-radius:9px;
            padding:7px 10px;color:#ccc;font-size:10px;cursor:pointer">Use my current station</button>
        </div>

        <!-- Work station -->
        <div style="margin-bottom:20px">
          <div style="font-size:10px;color:#666;margin-bottom:6px;display:flex;align-items:center;gap:5px">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="1"/><rect x="8" y="6" width="2" height="2"/><rect x="14" y="6" width="2" height="2"/><rect x="8" y="11" width="2" height="2"/><rect x="14" y="11" width="2" height="2"/></svg>
            WORK / DESTINATION
          </div>
          <div onclick="COMMUTE._pickStation('work')"
            style="background:#1a1a1a;border:1px solid #333;border-radius:12px;
            padding:13px 14px;cursor:pointer;display:flex;align-items:center;justify-content:space-between">
            <div id="cm-work-val" style="font-size:13px;font-weight:600;
              color:${_tmpWork ? '#fff' : '#555'}">
              ${_tmpWork && METRO.STATIONS[_tmpWork] ? METRO.STATIONS[_tmpWork].n : 'Select work station'}
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>
        </div>

        <button onclick="COMMUTE._saveFromModal()"
          style="width:100%;height:48px;background:var(--y);border:none;border-radius:14px;
          font-family:'DM Serif Display',sans-serif;font-size:14px;font-weight:800;color:#000;
          cursor:pointer;margin-bottom:10px">Save Commute</button>

        ${state.enabled ? `
        <button onclick="COMMUTE.disable();document.getElementById('commute-modal').remove()"
          style="width:100%;height:40px;background:transparent;border:1px solid #333;
          border-radius:12px;font-size:12px;font-weight:600;color:#555;cursor:pointer">
          Disable Smart Commute
        </button>` : ''}
      </div>`;

    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) COMMUTE._cancelSetup(); });
  }

  // Station picker — opens search overlay, re-opens modal on pick
  function _pickStation(which) {
    window._commutePickTarget = which;
    // Close modal temporarily so search overlay is visible on top
    document.getElementById('commute-modal')?.remove();
    SEARCH.open('commute-pick');
  }

  function _useCurrentFor(which) {
    if (!window.GPS?.locateOnce) {
      NAV.showToast('warn', 'Location is unavailable on this device');
      return;
    }
    GPS.locateOnce(result => {
      if (!result) {
        NAV.showToast('warn', 'Could not determine your nearest station');
        return;
      }
      if (which === 'home') _tmpHome = result.id;
      else _tmpWork = result.id;
      const label = document.getElementById(which === 'home' ? 'cm-home-val' : 'cm-work-val');
      if (label) { label.textContent = result.name; label.style.color = '#fff'; }
      NAV.showToast('ok', `${result.name} set as your ${which} station`);
    });
  }

  function _onSearchPick(id) {
    const s = METRO.STATIONS[id]; if (!s) return;
    const which = window._commutePickTarget;
    if (which === 'home') _tmpHome = id;
    else                  _tmpWork = id;
    // Re-open modal with updated values
    setTimeout(openSetup, 60);
  }

  function _saveFromModal() {
    if (!_tmpHome || !_tmpWork) {
      NAV.showToast('warn', 'Select both stations first');
      return;
    }
    setup(_tmpHome, _tmpWork);
    document.getElementById('commute-modal')?.remove();
  }

  function _cancelSetup() {
    // Reset tmp so next open re-seeds from saved state
    _tmpHome = null;
    _tmpWork = null;
    document.getElementById('commute-modal')?.remove();
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    renderCard();
    setInterval(renderCard, 3 * 60 * 1000);
  }

  return {
    init, renderCard, setup, disable, leaveNow, openSetup, _cancelSetup,
    getTrip, getDirection,
    _pickStation, _useCurrentFor, _onSearchPick, _saveFromModal,
    get state() { return state; },
  };
})();
