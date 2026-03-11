// ─────────────────────────────────────────────────────────────────────────────
//  REALTIME.js — Live train ETAs + service alerts via OTD GTFS-RT
//  All OTD API calls go through the Render backend (API key is server-side)
//
//  Public API:
//    REALTIME.getStation(stopId)  → { arrivals, alerts }
//    REALTIME.getAlerts()         → alerts array
//    REALTIME.renderETAs(el, stopId)  → injects ETA cards into el
//    REALTIME.renderAlerts(el)    → injects alert cards into el
// ─────────────────────────────────────────────────────────────────────────────
window.REALTIME = (function () {
  'use strict';

  const BASE = 'https://metrocrowd.onrender.com/realtime';
  const TTL  = 30_000; // 30 s client-side cache
  const _cache = {};

  async function _get(path) {
    const now = Date.now();
    if (_cache[path] && now - _cache[path].ts < TTL) return _cache[path].data;
    try {
      const r = await fetch(BASE + path, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(r.status);
      const data = await r.json();
      _cache[path] = { data, ts: now };
      return data;
    } catch (e) {
      // Return stale cache on error
      return _cache[path]?.data || null;
    }
  }

  // ── PUBLIC ───────────────────────────────────────────────────────────────

  async function getStation(stopId) {
    return _get(`/station/${encodeURIComponent(stopId)}`);
  }

  async function getAlerts() {
    const d = await _get('/alerts');
    return d?.alerts || [];
  }

  async function getTrips(stopId, limit = 5) {
    const d = await _get(`/trips/${encodeURIComponent(stopId)}?limit=${limit}`);
    return d?.arrivals || [];
  }

  // ── RENDER: ETA strip ────────────────────────────────────────────────────
  async function renderETAs(container, stopId) {
    if (!container || !stopId) return;
    container.innerHTML = _loadingHTML('Loading live ETAs…');

    const data = await getStation(stopId);

    if (!data || !data.arrivals?.length) {
      container.innerHTML = _emptyHTML('No live ETA data for this stop yet.');
      return;
    }

    const { arrivals, alerts, feed_ts } = data;
    const feedAge = feed_ts ? Math.round((Date.now() / 1000 - feed_ts) / 60) : null;

    container.innerHTML = `
      <div style="margin-bottom:8px">
        <div style="font-size:9px;color:var(--sub);letter-spacing:.08em;text-transform:uppercase;
          font-family:'Syne',sans-serif;display:flex;align-items:center;gap:6px;margin-bottom:10px">
          <div class="ldot"></div>LIVE ETAs
          ${feedAge !== null ? `<span style="color:var(--dim)">(feed ${feedAge}m old)</span>` : ''}
        </div>
        ${arrivals.slice(0, 4).map(_etaRow).join('')}
      </div>
      ${alerts?.length ? _alertBanner(alerts[0]) : ''}`;
  }

  function _etaRow(a) {
    const mins = Math.round(a.arr_in_sec / 60);
    const sec  = a.arr_in_sec % 60;
    const timeStr = mins === 0 ? 'Arriving' : mins === 1 ? '1 min' : `${mins} min`;
    const delayStr = a.delay_sec > 60
      ? `<span style="color:#f97316;font-size:9px">+${Math.round(a.delay_sec/60)}m late</span>`
      : a.delay_sec < -30
      ? `<span style="color:#4ade80;font-size:9px">Early</span>`
      : `<span style="color:var(--sub);font-size:9px">On time</span>`;

    const urgency = mins === 0 ? '#ef4444' : mins <= 2 ? '#f97316' : mins <= 5 ? '#fbbf24' : '#4ade80';
    const dirLabel = a.direction === 0 ? 'Up' : a.direction === 1 ? 'Down' : '';

    return `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;
        border-bottom:1px solid var(--brd)">
        <div style="width:52px;height:52px;border-radius:14px;flex-shrink:0;
          background:${urgency}18;border:1.5px solid ${urgency}44;
          display:flex;flex-direction:column;align-items:center;justify-content:center">
          <div style="font-family:'Syne',sans-serif;font-size:${mins>=10?'14':'16'}px;
            font-weight:900;color:${urgency};line-height:1">${mins===0?'NOW':mins}</div>
          ${mins>0?`<div style="font-size:8px;color:${urgency};opacity:.7">min</div>`:''}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:700;color:var(--txt);margin-bottom:2px">
            ${a.route_id ? `Route ${a.route_id}` : 'Service'}
            ${dirLabel ? `<span style="font-size:9px;color:var(--sub);margin-left:4px">${dirLabel}</span>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            ${delayStr}
            ${a.trip_id ? `<span style="font-size:9px;color:var(--dim)">· ${a.trip_id.slice(-6)}</span>` : ''}
          </div>
        </div>
        <div style="font-size:10px;font-weight:700;color:${urgency};flex-shrink:0">${timeStr}</div>
      </div>`;
  }

  // ── RENDER: Alert banner ─────────────────────────────────────────────────
  function _alertBanner(alert) {
    const effectColors = {
      NO_SERVICE:         '#ef4444',
      REDUCED_SERVICE:    '#f97316',
      SIGNIFICANT_DELAYS: '#f97316',
      DETOUR:             '#fbbf24',
      MODIFIED_SERVICE:   '#fbbf24',
      ADDITIONAL_SERVICE: '#4ade80',
    };
    const col = effectColors[alert.effect] || '#fbbf24';

    return `
      <div style="background:${col}10;border:1px solid ${col}33;border-radius:12px;
        padding:10px 12px;margin-top:8px;display:flex;align-items:flex-start;gap:10px">
        <div style="color:${col};flex-shrink:0;margin-top:1px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:700;color:${col};margin-bottom:2px">${alert.header}</div>
          ${alert.desc ? `<div style="font-size:10px;color:var(--sub);line-height:1.4">${alert.desc.slice(0,120)}${alert.desc.length>120?'…':''}</div>` : ''}
        </div>
      </div>`;
  }

  // ── RENDER: Full alerts list ─────────────────────────────────────────────
  async function renderAlerts(container) {
    if (!container) return;
    container.innerHTML = _loadingHTML('Checking for service alerts…');
    const alerts = await getAlerts();

    if (!alerts.length) {
      container.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;padding:14px">
          <div style="color:#4ade80">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          </div>
          <div style="font-size:12px;color:var(--sub)">No service disruptions right now</div>
        </div>`;
      return;
    }

    container.innerHTML = alerts.slice(0, 5).map(a => _alertBanner(a)).join('');
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function _loadingHTML(msg) {
    return `<div style="padding:14px;display:flex;align-items:center;gap:10px;color:var(--sub)">
      <div class="ldot"></div>
      <div style="font-size:11px">${msg}</div>
    </div>`;
  }

  function _emptyHTML(msg) {
    return `<div style="padding:14px;font-size:11px;color:var(--sub)">${msg}</div>`;
  }

  return { getStation, getAlerts, getTrips, renderETAs, renderAlerts };
})();
