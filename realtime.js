// ─────────────────────────────────────────────────────────────────────────────
//  REALTIME.js — OTD live bus positions
//  OTD only publishes VehiclePositions.pb (Delhi cluster buses + DTC)
//  No TripUpdates, no Alerts feed exists on OTD.
//
//  Public API:
//    REALTIME.getNearby(lat, lng, radius)  → vehicles near a point
//    REALTIME.renderNearby(el, lat, lng)   → renders nearby buses into el
//    REALTIME.getStatus()                  → feed health check
// ─────────────────────────────────────────────────────────────────────────────
window.REALTIME = (function () {
  'use strict';

  const BASE  = 'https://metrocrowd.onrender.com/realtime';
  const TTL   = 30_000;
  const _cache = {};

  async function _get(path) {
    const now = Date.now();
    if (_cache[path] && now - _cache[path].ts < TTL) return _cache[path].data;
    try {
      const r = await fetch(BASE + path, { signal: AbortSignal.timeout(9000) });
      if (!r.ok) throw new Error(r.status);
      const data = await r.json();
      _cache[path] = { data, ts: now };
      return data;
    } catch {
      return _cache[path]?.data || null;
    }
  }

  async function getStatus()            { return _get('/status'); }
  async function getVehicles(routeId)   { return _get('/vehicles' + (routeId ? `?route_id=${routeId}` : '')); }
  async function getNearby(lat, lng, radius = 1.0) {
    return _get(`/vehicles/near?lat=${lat}&lng=${lng}&radius=${radius}`);
  }

  // ── renderNearby: show buses within ~1km of a station ────────────────────
  async function renderNearby(container, lat, lng, stationName) {
    if (!container) return;
    container.innerHTML = _loading();

    const data = await getNearby(lat, lng, 1.2);

    if (!data) {
      container.innerHTML = _empty('Could not reach live feed.');
      return;
    }
    if (data.source === 'unavailable') {
      container.innerHTML = _empty('Live bus data temporarily unavailable.');
      return;
    }
    if (!data.vehicles?.length) {
      container.innerHTML = _empty('No buses near this station right now.');
      return;
    }

    const feedAge = data.feed_ts
      ? Math.round((Date.now() / 1000 - data.feed_ts) / 60)
      : null;

    const rows = data.vehicles.slice(0, 6).map(v => {
      const distStr = v.dist_km < 0.1
        ? `${Math.round(v.dist_km * 1000)}m away`
        : `${v.dist_km.toFixed(2)}km away`;

      const statusLabel = v.status === 1 ? 'Stopped' : v.status === 2 ? 'In Transit' : 'Moving';
      const statusCol   = v.status === 1 ? '#fbbf24' : '#4ade80';
      const speedStr    = v.speed_kmh ? `${v.speed_kmh} km/h` : '';

      return `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--brd)">
          <div style="width:44px;height:44px;border-radius:12px;flex-shrink:0;
            background:rgba(245,168,0,.08);border:1px solid rgba(245,168,0,.2);
            display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F5A800" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/>
              <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
            </svg>
            <div style="font-size:7px;color:#F5A800;font-weight:700">${v.route_id ? v.route_id.slice(0,5) : 'BUS'}</div>
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:700;color:var(--txt);margin-bottom:2px">
              ${v.route_id ? `Route ${v.route_id}` : 'Bus'}
              ${v.trip_id ? `<span style="font-size:9px;color:var(--dim)">·${v.trip_id.slice(-5)}</span>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <span style="font-size:9px;padding:1px 6px;border-radius:8px;
                background:${statusCol}18;color:${statusCol};border:1px solid ${statusCol}33">${statusLabel}</span>
              ${speedStr ? `<span style="font-size:9px;color:var(--sub)">${speedStr}</span>` : ''}
            </div>
          </div>
          <div style="font-size:10px;color:var(--sub);text-align:right;flex-shrink:0">${distStr}</div>
        </div>`;
    }).join('');

    container.innerHTML = `
      <div style="padding:0 14px">
        <div style="font-size:9px;color:var(--sub);display:flex;align-items:center;
          gap:5px;padding:10px 0;border-bottom:1px solid var(--brd);margin-bottom:2px">
          <div class="ldot"></div>
          ${data.vehicles.length} bus${data.vehicles.length !== 1 ? 'es' : ''} within 1.2km
          ${feedAge !== null ? `<span style="color:var(--dim)">· feed ${feedAge}m old</span>` : ''}
        </div>
        ${rows}
      </div>`;
  }

  function _loading() {
    return `<div style="padding:14px;display:flex;align-items:center;gap:8px;color:var(--sub)">
      <div class="ldot"></div><span style="font-size:11px">Loading nearby buses…</span></div>`;
  }
  function _empty(msg) {
    return `<div style="padding:12px 14px;font-size:11px;color:var(--sub)">${msg}</div>`;
  }

  return { getStatus, getVehicles, getNearby, renderNearby };
})();
