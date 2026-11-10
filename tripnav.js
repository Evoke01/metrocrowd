// ══════════════════════════════════════════════════════════════════
//  TRIPNAV — Live Trip Navigation + Data Collection
//  Tracks user through their journey via GPS.
//  Logs every station arrival + session stats → Supabase via API
//  → feeds ML crowd + travel time models.
//
//  Public API:
//    TRIPNAV.start(result)   — called after route computed
//    TRIPNAV.stop()          — end navigation
// ══════════════════════════════════════════════════════════════════
window.TRIPNAV = (function () {
  'use strict';

  const API_BASE = 'https://metrocrowd.onrender.com';

  let _result      = null;
  let _path        = [];
  let _currentIdx  = -1;
  let _watchId     = null;
  let _panel       = null;
  let _active      = false;
  let _sessionId   = null;          // returned from API after session/start
  let _startedAt   = null;          // Date.now() when navigation began
  let _prevArrival = null;          // Date.now() of last station arrival
  let _sessionStartPromise = null;
  let _sessionReady = false;
  let _sessionStopped = null;
  let _eventQueue = Promise.resolve();
  let _candidateIdx = -1;
  let _candidateHits = 0;

  // ── Haversine ────────────────────────────────────────────────
  function _hav(lat1, lng1, lat2, lng2) {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

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

  // ── Data collection helpers ───────────────────────────────────
  async function _authHeaders() {
    try {
      const { data } = await window.SB.client.auth.getSession();
      const token = data?.session?.access_token;
      return token ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } : null;
    } catch { return null; }
  }

  async function _apiPost(path, body) {
    try {
      const headers = await _authHeaders();
      if (!headers) return;
      await fetch(API_BASE + path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        // fire-and-forget: don't block navigation on this
        keepalive: true,
      });
    } catch (e) {
      // Silently swallow — never break navigation due to logging failure
    }
  }

  async function _startSession() {
    const hops      = _result.hops || [];
    const lineCodes = [...new Set(hops.map(h => h.line).filter(Boolean))];
    const estSec    = (_path.length - 1) * 150;  // baseline 2.5 min/stop

    try {
      const headers = await _authHeaders();
      if (!headers) return;
      const res = await fetch(API_BASE + '/trips/session/start', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          from_station:     _path[0],
          to_station:       _path[_path.length - 1],
          line_codes:       lineCodes,
          path_station_ids: _path,
          total_stops:      _path.length - 1,
          est_duration_sec: estSec,
        }),
        keepalive: true,
      });
      const data = await res.json();
      _sessionId = data.session_id || null;
    } catch { _sessionId = null; }
  }

  async function _endSession(completed, startedAt) {
    const sessionId = _sessionId;
    if (!sessionId || !startedAt) return;
    await _eventQueue;
    const actualSec = Math.round((Date.now() - startedAt) / 1000);
    await _apiPost('/trips/session/end', {
      session_id:          sessionId,
      actual_duration_sec: actualSec,
      stops_tracked:       _currentIdx + 1,
      completed:           completed,
    });
  }

  async function _logArrival(stationIdx) {
    if (!_sessionId) return;
    const sessionId = _sessionId;
    const stationId  = _path[stationIdx];
    const hop        = _result.hops?.[stationIdx];
    const lineCode   = hop?.line || null;
    const crowdPct   = Math.round(CROWD.state?.crowdMap?.[stationId] || 0) || null;
    const now        = Date.now();
    const secFromPrev = (stationIdx > 0 && _prevArrival)
      ? Math.round((now - _prevArrival) / 1000)
      : null;
    _prevArrival = now;

    const body = {
      session_id:        sessionId,
      station_id:        stationId,
      station_index:     stationIdx,
      line_code:         lineCode,
      seconds_from_prev: secFromPrev,
      crowd_pct:         crowdPct,
    };
    _eventQueue = _eventQueue.then(() => _apiPost('/trips/event', body));
    await _eventQueue;
  }

  // ── Main entry ───────────────────────────────────────────────
  function start(result) {
    if (!result || !result.ok) return;
    if (_active) stop();

    _result     = result;
    _path       = result.path || result.hops.map(h => h.id);
    _active     = true;
    _currentIdx = 0;
    _candidateIdx = -1;
    _candidateHits = 0;
    _startedAt  = Date.now();
    _prevArrival = Date.now();

    _buildPanel();
    _buildRouteHighlights();
    _startGPS();

    // Start session + log first station (origin)
    _sessionReady = false;
    _sessionStopped = null;
    _eventQueue = Promise.resolve();
    _sessionStartPromise = _startSession().then(async () => {
      if (_sessionId) await _logArrival(0);
      _sessionReady = true;
      if (_sessionStopped && _sessionId) {
        const pending = _sessionStopped;
        _sessionStopped = null;
        await _endSession(pending.completed, pending.startedAt);
      }
    });

    _render();
    document.getElementById('rres')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    NAV.showToast('train', T ? T('nav_started') || 'Navigation started' : 'Navigation started');
  }

  function stop(arrived) {
    if (!_active) return;
    _active = false;

    if (_watchId !== null) {
      navigator.geolocation.clearWatch(_watchId);
      _watchId = null;
    }

    // Log session end after the origin/final station events have drained.
    const endedAt = _startedAt;
    if (_sessionId && _sessionReady) _endSession(!!arrived, endedAt);
    else if (_sessionStartPromise) _sessionStopped = { completed: !!arrived, startedAt: endedAt };

    _panel?.remove(); _panel = null;
    _clearHighlights();

    const btn = document.getElementById('trip-start-btn');
    if (btn) {
      btn.textContent = T ? T('start_navigation') || 'Start Live Navigation' : 'Start Live Navigation';
      btn.style.background = 'var(--y)';
      btn.style.color = '#000';
    }

    if (!arrived) {
      NAV.showToast('train', T ? T('nav_ended') || 'Navigation ended' : 'Navigation ended');
    }

    _sessionId = null;
    _startedAt = null;
    _prevArrival = null;
    _candidateIdx = -1;
    _candidateHits = 0;
  }

  // ── GPS watch ────────────────────────────────────────────────
  function _startGPS() {
    if (!navigator.geolocation) { NAV.showToast('warn', 'GPS not available'); return; }
    _watchId = navigator.geolocation.watchPosition(
      async pos => {
        const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords;
        if (acc > 150) return;

        const { idx, dist } = _nearestOnPath(lat, lng);

        const arrivalRadius = Math.max(120, Math.min(350, acc * 1.5));
        if (idx > _currentIdx && dist <= arrivalRadius) {
          if (_candidateIdx === idx) _candidateHits++;
          else { _candidateIdx = idx; _candidateHits = 1; }
          // Require repeated fixes near the same next station to avoid
          // logging a false arrival from a single noisy GPS jump.
          if (_candidateHits >= 2) {
            const prevIdx = _currentIdx;
            _currentIdx = idx;
            _candidateIdx = -1;
            _candidateHits = 0;

            // Log each newly passed station
            for (let i = prevIdx + 1; i <= idx; i++) await _logArrival(i);
            _render();
            if (navigator.vibrate) navigator.vibrate([60, 30, 60]);
            // Notify group members of position change
            if (typeof GROUP !== 'undefined' && GROUP.active) {
              GROUP.updatePosition(_path[_currentIdx], _currentIdx);
              GROUP.highlightOnRoute();
            }
          }
        } else {
          _candidateIdx = -1;
          _candidateHits = 0;
        }

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

  // ── Build bottom panel ────────────────────────────────────────
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
          <span style="font-family:'DM Serif Display',sans-serif;font-size:11px;font-weight:800;
            color:var(--y);letter-spacing:.06em">NAVIGATING</span>
          <span id="tnav-acc" style="font-size:9px;color:var(--sub)"></span>
        </div>
        <button onclick="TRIPNAV.stop(false)"
          style="background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.25);
          border-radius:8px;padding:4px 10px;font-size:10px;font-weight:700;
          color:#ef4444;cursor:pointer">End</button>
      </div>

      <div style="height:3px;background:var(--brd);border-radius:2px;margin-bottom:12px;overflow:hidden">
        <div id="tnav-progress" style="height:100%;background:var(--y);border-radius:2px;
          transition:width .5s ease;width:0%"></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center;margin-bottom:10px">
        <div>
          <div style="font-size:9px;color:var(--sub);text-transform:uppercase;
            letter-spacing:.06em;margin-bottom:3px">${T ? T('you_are_at') : 'You are at'}</div>
          <div id="tnav-current" style="font-family:'DM Serif Display',sans-serif;font-size:13px;
            font-weight:800;color:var(--y);line-height:1.2">—</div>
          <div id="tnav-current-crowd" style="font-size:10px;color:var(--sub);margin-top:2px"></div>
        </div>
        <div style="color:var(--sub);font-size:18px">→</div>
        <div style="text-align:right">
          <div style="font-size:9px;color:var(--sub);text-transform:uppercase;
            letter-spacing:.06em;margin-bottom:3px">${T ? T('next_stop') : 'Next stop'}</div>
          <div id="tnav-next" style="font-family:'DM Serif Display',sans-serif;font-size:13px;
            font-weight:700;color:var(--txt);line-height:1.2">—</div>
          <div id="tnav-next-crowd" style="font-size:10px;color:var(--sub);margin-top:2px"></div>
        </div>
      </div>

      <div style="display:flex;gap:12px;padding:8px 0;border-top:1px solid var(--brd)">
        <div style="flex:1;text-align:center">
          <div id="tnav-remaining" style="font-family:'DM Serif Display',sans-serif;font-size:16px;font-weight:800;color:var(--txt)">—</div>
          <div style="font-size:9px;color:var(--sub)">${T ? T('stops_left') : 'stops left'}</div>
        </div>
        <div style="flex:1;text-align:center">
          <div id="tnav-time" style="font-family:'DM Serif Display',sans-serif;font-size:16px;font-weight:800;color:var(--txt)">—</div>
          <div style="font-size:9px;color:var(--sub)">${T ? T('est_remaining') : 'est. remaining'}</div>
        </div>
        <div style="flex:1;text-align:center">
          <div id="tnav-dest" style="font-family:'DM Serif Display',sans-serif;font-size:10px;font-weight:700;color:var(--sub);line-height:1.3">—</div>
          <div style="font-size:9px;color:var(--sub)">${T ? T('destination') : 'destination'}</div>
        </div>
      </div>
    `;
    document.body.appendChild(_panel);
    requestAnimationFrame(() => { _panel.style.transform = 'translateY(0)'; });
  }

  // ── Render panel ──────────────────────────────────────────────
  function _render() {
    if (!_panel || !_active) return;
    const total     = _path.length - 1;
    const remaining = total - _currentIdx;
    const pct       = total > 0 ? Math.round((_currentIdx / total) * 100) : 0;
    const estMin    = Math.round(remaining * 2.5);

    const curId  = _path[_currentIdx];
    const nextId = _currentIdx < total ? _path[_currentIdx + 1] : null;
    const destId = _path[total];

    const curS  = METRO.STATIONS[curId]  || { n: curId };
    const nextS = nextId ? (METRO.STATIONS[nextId] || { n: nextId }) : null;
    const destS = METRO.STATIONS[destId] || { n: destId };

    const curV  = CROWD.state?.crowdMap?.[curId]  || 0;
    const nextV = nextId ? (CROWD.state?.crowdMap?.[nextId] || 0) : 0;
    const _cc   = v => v < 40 ? '#4ade80' : v < 70 ? 'var(--y)' : '#f87171';

    _set('tnav-progress',      null, { width: pct + '%' });
    _set('tnav-current',       curS.n);
    _set('tnav-current-crowd', curV ? `${curV}% · ${CROWD.label ? CROWD.label(curV) : ''}` : '');
    _set('tnav-next',          nextS ? nextS.n : '🏁 ' + destS.n);
    _set('tnav-next-crowd',    nextId && nextV ? `${nextV}%` : '');
    _set('tnav-remaining',     remaining);
    _set('tnav-time',          remaining > 0 ? `~${estMin}m` : '0m');
    _set('tnav-dest',          destS.n);

    const ccEl = document.getElementById('tnav-current-crowd');
    if (ccEl && curV) ccEl.style.color = _cc(curV);
    const ncEl = document.getElementById('tnav-next-crowd');
    if (ncEl && nextV) ncEl.style.color = _cc(nextV);

    _updateHighlights(_currentIdx);

    if (_currentIdx >= total) {
      _set('tnav-current', '🏁 ' + destS.n);
      _set('tnav-next', T ? T('nav_arrived') : 'You have arrived!');
      setTimeout(() => {
        stop(true);
        NAV.showToast('check', T ? T('nav_arrived') : 'You have arrived!');
      }, 3000);
    }
  }

  // ── Route list highlights ─────────────────────────────────────
  function _buildRouteHighlights() {
    if (!document.getElementById('_tripnav_css')) {
      const s = document.createElement('style');
      s.id = '_tripnav_css';
      s.textContent = `
        .rhop.tnav-passed  { opacity:.35; }
        .rhop.tnav-current { background:rgba(255,208,0,.07);
          border-radius:10px;outline:1.5px solid rgba(255,208,0,.35); }
        .rhop.tnav-current .hnm { color:var(--y);font-weight:800; }
        .rhop.tnav-current::before {
          content:'📍';font-size:10px;position:absolute;right:8px;
          top:50%;transform:translateY(-50%);
        }
        .rhop { position:relative; }
        @keyframes tnavPulse {
          0%,100%{opacity:1;transform:scale(1);}
          50%{opacity:.4;transform:scale(.7);}
        }
      `;
      document.head.appendChild(s);
    }
  }

  function _updateHighlights(curIdx) {
    document.querySelectorAll('.rhop').forEach((el, i) => {
      el.classList.remove('tnav-passed','tnav-current');
      if (i < curIdx)       el.classList.add('tnav-passed');
      else if (i === curIdx) {
        el.classList.add('tnav-current');
        el.scrollIntoView({ behavior:'smooth', block:'center' });
      }
    });
  }

  function _clearHighlights() {
    document.querySelectorAll('.rhop').forEach(el => {
      el.classList.remove('tnav-passed','tnav-current');
    });
  }

  function _set(id, text, styles) {
    const el = document.getElementById(id); if (!el) return;
    if (text !== null && text !== undefined) el.textContent = text;
    if (styles) Object.assign(el.style, styles);
  }

  return { start, stop, get active() { return _active; } };
})();
