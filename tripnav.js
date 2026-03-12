// ══════════════════════════════════════════════════════════════════
//  TRIPNAV — Live Trip Navigation
//  Shows a persistent bottom panel tracking the user's position
//  along a computed route using GPS.
//
//  Public API:
//    TRIPNAV.start(result)   — called after route is computed
//    TRIPNAV.stop()          — end navigation
// ══════════════════════════════════════════════════════════════════
window.TRIPNAV = (function () {
  'use strict';

  let _result     = null;   // route result from ROUTE.compute()
  let _path       = [];     // array of station IDs in order
  let _currentIdx = -1;     // index in _path of current station
  let _watchId    = null;   // geolocation watchId
  let _panel      = null;   // DOM panel element
  let _overlay    = null;   // DOM overlay on route list
  let _active     = false;

  // ── Haversine ────────────────────────────────────────────────
  function _hav(lat1, lng1, lat2, lng2) {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  // Find nearest station *along the route path* (not all 255 stations)
  function _nearestOnPath(lat, lng) {
    let bestIdx = 0, bestDist = Infinity;
    _path.forEach((id, i) => {
      const coord = METRO.GPS && METRO.GPS[id];
      if (!coord) return;
      const d = _hav(lat, lng, coord[0], coord[1]);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });
    return { idx: bestIdx, dist: bestDist };
  }

  // ── Main entry ───────────────────────────────────────────────
  function start(result) {
    if (!result || !result.ok) return;
    if (_active) stop();

    _result  = result;
    _path    = result.path || result.hops.map(h => h.id);
    _active  = true;
    _currentIdx = 0;

    _buildPanel();
    _buildRouteHighlights();
    _startGPS();
    _render();

    // Scroll route results into view
    document.getElementById('rres')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    NAV.showToast('train', T ? T('nav_started') || 'Navigation started' : 'Navigation started');
  }

  function stop() {
    _active = false;
    if (_watchId !== null) {
      navigator.geolocation.clearWatch(_watchId);
      _watchId = null;
    }
    _panel?.remove();  _panel = null;
    _clearHighlights();
    // Remove start-nav button active state
    const btn = document.getElementById('trip-start-btn');
    if (btn) {
      btn.textContent = T ? T('start_navigation') || 'Start Navigation' : 'Start Navigation';
      btn.style.background = 'var(--card2)';
      btn.style.color = 'var(--sub)';
      btn.disabled = false;
    }
    NAV.showToast('train', T ? T('nav_ended') || 'Navigation ended' : 'Navigation ended');
  }

  // ── GPS watch ────────────────────────────────────────────────
  function _startGPS() {
    if (!navigator.geolocation) {
      NAV.showToast('warn', 'GPS not available');
      return;
    }
    _watchId = navigator.geolocation.watchPosition(
      pos => {
        const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords;
        if (acc > 150) return; // ignore very imprecise fixes

        const { idx, dist } = _nearestOnPath(lat, lng);

        // Only move forward along the route (prevent jumping back)
        if (idx >= _currentIdx && dist < 400) {
          if (idx !== _currentIdx) {
            _currentIdx = idx;
            _render();
            // Vibrate on station change if supported
            if (navigator.vibrate) navigator.vibrate([60, 30, 60]);
          }
        }

        // Update accuracy badge
        const accEl = document.getElementById('tnav-acc');
        if (accEl) {
          accEl.textContent = `±${Math.round(acc)}m`;
          accEl.style.color = acc < 30 ? '#4ade80' : acc < 80 ? 'var(--y)' : '#f87171';
        }
      },
      err => {
        const accEl = document.getElementById('tnav-acc');
        if (accEl) accEl.textContent = 'GPS error';
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  // ── Build persistent bottom panel ────────────────────────────
  function _buildPanel() {
    _panel = document.createElement('div');
    _panel.id = 'tripnav-panel';
    _panel.style.cssText = `
      position:fixed;bottom:calc(56px + env(safe-area-inset-bottom));left:0;right:0;
      z-index:800;max-width:480px;margin:0 auto;
      background:var(--card);border-top:2px solid var(--y);
      border-radius:20px 20px 0 0;padding:14px 16px 10px;
      box-shadow:0 -8px 32px rgba(0,0,0,.4);
      font-family:'DM Sans',sans-serif;
      transform:translateY(100%);transition:transform .35s cubic-bezier(.22,1,.36,1);
    `;
    _panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:8px;height:8px;border-radius:50%;background:var(--y);
            animation:tnavPulse 1.2s ease-in-out infinite"></div>
          <span style="font-family:'Syne',sans-serif;font-size:11px;font-weight:800;
            color:var(--y);letter-spacing:.06em">NAVIGATING</span>
          <span id="tnav-acc" style="font-size:9px;color:var(--sub)"></span>
        </div>
        <button onclick="TRIPNAV.stop()"
          style="background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.25);
          border-radius:8px;padding:4px 10px;font-size:10px;font-weight:700;
          color:#ef4444;cursor:pointer">
          End
        </button>
      </div>

      <!-- Progress bar -->
      <div style="height:3px;background:var(--brd);border-radius:2px;margin-bottom:12px;overflow:hidden">
        <div id="tnav-progress" style="height:100%;background:var(--y);border-radius:2px;
          transition:width .5s ease;width:0%"></div>
      </div>

      <!-- Current → Next -->
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center;margin-bottom:10px">
        <div>
          <div style="font-size:9px;color:var(--sub);text-transform:uppercase;
            letter-spacing:.06em;margin-bottom:3px">You are at</div>
          <div id="tnav-current" style="font-family:'Syne',sans-serif;font-size:13px;
            font-weight:800;color:var(--y);line-height:1.2">—</div>
          <div id="tnav-current-crowd" style="font-size:10px;color:var(--sub);margin-top:2px"></div>
        </div>
        <div style="color:var(--sub);font-size:18px">→</div>
        <div style="text-align:right">
          <div style="font-size:9px;color:var(--sub);text-transform:uppercase;
            letter-spacing:.06em;margin-bottom:3px">Next stop</div>
          <div id="tnav-next" style="font-family:'Syne',sans-serif;font-size:13px;
            font-weight:700;color:var(--txt);line-height:1.2">—</div>
          <div id="tnav-next-crowd" style="font-size:10px;color:var(--sub);margin-top:2px"></div>
        </div>
      </div>

      <!-- Remaining info row -->
      <div style="display:flex;gap:12px;padding:8px 0;border-top:1px solid var(--brd)">
        <div style="flex:1;text-align:center">
          <div id="tnav-remaining" style="font-family:'Syne',sans-serif;font-size:16px;
            font-weight:800;color:var(--txt)">—</div>
          <div style="font-size:9px;color:var(--sub)">stops left</div>
        </div>
        <div style="flex:1;text-align:center">
          <div id="tnav-time" style="font-family:'Syne',sans-serif;font-size:16px;
            font-weight:800;color:var(--txt)">—</div>
          <div style="font-size:9px;color:var(--sub)">est. remaining</div>
        </div>
        <div style="flex:1;text-align:center">
          <div id="tnav-dest" style="font-family:'Syne',sans-serif;font-size:10px;
            font-weight:700;color:var(--sub);line-height:1.3">—</div>
          <div style="font-size:9px;color:var(--sub)">destination</div>
        </div>
      </div>
    `;

    document.body.appendChild(_panel);
    // Animate in
    requestAnimationFrame(() => {
      _panel.style.transform = 'translateY(0)';
    });
  }

  // ── Render live panel data ────────────────────────────────────
  function _render() {
    if (!_panel || !_active) return;

    const path       = _path;
    const total      = path.length - 1;
    const curIdx     = _currentIdx;
    const remaining  = total - curIdx;
    const pct        = total > 0 ? Math.round((curIdx / total) * 100) : 0;
    const estMin     = Math.round(remaining * 2.5);

    const curId  = path[curIdx];
    const nextId = curIdx < total ? path[curIdx + 1] : null;
    const destId = path[total];

    const curS   = METRO.STATIONS[curId]  || { n: curId };
    const nextS  = nextId ? (METRO.STATIONS[nextId] || { n: nextId }) : null;
    const destS  = METRO.STATIONS[destId] || { n: destId };

    const curV   = CROWD.state?.crowdMap?.[curId]  || 0;
    const nextV  = nextId ? (CROWD.state?.crowdMap?.[nextId] || 0) : 0;

    const _cc = v => v < 40 ? '#4ade80' : v < 70 ? 'var(--y)' : '#f87171';

    // Panel fields
    _set('tnav-progress',  null, { width: pct + '%' });
    _set('tnav-current',   curS.n);
    _set('tnav-current-crowd', curV ? `${curV}% · ${CROWD.label ? CROWD.label(curV) : ''}` : '');
    _set('tnav-next',      nextS ? nextS.n : '🏁 Arrived!');
    _set('tnav-next-crowd', nextId && nextV ? `${nextV}%` : '');
    _set('tnav-remaining', remaining);
    _set('tnav-time',      remaining > 0 ? `~${estMin}m` : '0m');
    _set('tnav-dest',      destS.n);

    // Colour crowd
    const ccEl = document.getElementById('tnav-current-crowd');
    if (ccEl && curV) ccEl.style.color = _cc(curV);
    const ncEl = document.getElementById('tnav-next-crowd');
    if (ncEl && nextV) ncEl.style.color = _cc(nextV);

    // If arrived
    if (curIdx >= total) {
      _set('tnav-current', '🏁 ' + destS.n);
      _set('tnav-next', 'You have arrived!');
      setTimeout(() => {
        stop();
        NAV.showToast('check', T ? T('nav_arrived') || 'You have arrived!' : 'You have arrived!');
      }, 3000);
    }

    // Highlight route list
    _updateHighlights(curIdx);
  }

  // ── Highlight current station in route list ───────────────────
  function _buildRouteHighlights() {
    // Inject CSS for highlights once
    if (!document.getElementById('_tripnav_css')) {
      const s = document.createElement('style');
      s.id = '_tripnav_css';
      s.textContent = `
        .rhop.tnav-passed  { opacity: .35; }
        .rhop.tnav-current { background: rgba(255,208,0,.07);
          border-radius: 10px; outline: 1.5px solid rgba(255,208,0,.35); }
        .rhop.tnav-current .hnm { color: var(--y); font-weight: 800; }
        .rhop.tnav-current::before {
          content:'📍';font-size:10px;position:absolute;right:8px;top:50%;
          transform:translateY(-50%);
        }
        .rhop { position:relative; }
        @keyframes tnavPulse {
          0%,100%{ opacity:1;transform:scale(1); }
          50%{ opacity:.4;transform:scale(.7); }
        }
      `;
      document.head.appendChild(s);
    }
  }

  function _updateHighlights(curIdx) {
    const hops = document.querySelectorAll('.rhop');
    hops.forEach((el, i) => {
      el.classList.remove('tnav-passed', 'tnav-current');
      if (i < curIdx)      el.classList.add('tnav-passed');
      else if (i === curIdx) {
        el.classList.add('tnav-current');
        // Scroll into view inside the route container
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  function _clearHighlights() {
    document.querySelectorAll('.rhop').forEach(el => {
      el.classList.remove('tnav-passed', 'tnav-current');
    });
  }

  // ── DOM helper ───────────────────────────────────────────────
  function _set(id, text, styles) {
    const el = document.getElementById(id);
    if (!el) return;
    if (text !== null && text !== undefined) el.textContent = text;
    if (styles) Object.assign(el.style, styles);
  }

  return { start, stop, get active() { return _active; } };
})();
