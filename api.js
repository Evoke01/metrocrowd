// ══════════════════════════════════════════════════════════════
//  API.js — frontend client for the Python backend
//  Calls metrocrowd-api on Railway.
//  Falls back silently to local CROWD engine on any failure.
//  Depends on: CROWD (fallback)
// ══════════════════════════════════════════════════════════════
window.API = (function(){

  const BASE = 'https://metrocrowd.onrender.com';
  const CACHE_TTL = 5 * 60 * 1000;  // 5 minutes
  const _cache = {};

  // ── GET /predict/{station_id} ──────────────────────────────
  // Returns { crowd_pct, confidence, source }
  // Also returns { forecast: [{hour, crowd_pct}] } if requested
  async function getCrowd(stationId, line = 'Yellow'){
    const key = `crowd:${stationId}`;
    if(_cache[key] && Date.now() - _cache[key].ts < CACHE_TTL){
      return _cache[key].data;
    }
    const hist = CROWD.state.crowdMap[stationId] || 40;
    const url  = `${BASE}/predict/${stationId}?line=${encodeURIComponent(line)}&historical_avg=${hist}&recent_avg=${hist}`;
    const res  = await _fetch(url);
    if(!res) throw new Error('API unavailable');
    _cache[key] = { data: res, ts: Date.now() };
    return res;
  }

  // ── GET /predict/{station_id}/forecast ────────────────────
  // Returns { forecast: [{hour, crowd_pct}] }
  async function getForecast(stationId, line = 'Yellow'){
    const key = `forecast:${stationId}`;
    if(_cache[key] && Date.now() - _cache[key].ts < CACHE_TTL){
      return _cache[key].data;
    }
    const hist = CROWD.state.crowdMap[stationId] || 40;
    const url  = `${BASE}/predict/${stationId}/forecast?line=${encodeURIComponent(line)}&historical_avg=${hist}`;
    const res  = await _fetch(url);
    if(!res) throw new Error('API unavailable');
    _cache[key] = { data: res, ts: Date.now() };
    return res;
  }

  // ── POST /push/subscribe ──────────────────────────────────
  async function subscribePush(subscription, stationIds, userId){
    return _fetch(`${BASE}/push/subscribe`, {
      method:  'POST',
      headers: {'Content-Type':'application/json'},
      body:    JSON.stringify({ subscription_json: subscription, station_ids: stationIds, user_id: userId }),
    });
  }

  // ── Bulk prefetch crowd for visible stations ──────────────
  // Called on app init to warm the cache for home station + nearby
  async function prefetch(stationIds){
    return Promise.allSettled(
      stationIds.map(id => getCrowd(id, METRO.STATIONS[id]?.l?.[0] || 'Yellow').catch(() => null))
    );
  }

  async function _fetch(url, opts = {}){
    try {
      const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(5000) });
      if(!r.ok) throw new Error(r.status);
      return r.json();
    } catch(e) {
      console.warn('[API]', url, e.message);
      return null;
    }
  }

  // ── Health check ──────────────────────────────────────────
  async function isOnline(){
    try {
      const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
      return r.ok;
    } catch(_){ return false; }
  }

  return { getCrowd, getForecast, subscribePush, prefetch, isOnline };
})();
