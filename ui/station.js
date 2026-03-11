// ══════════════════════════════════════════════════════════════
//  STATION_UI.js — station detail screen
//  Owns: show, gpsLookup, quickReport, loadReports
//  Depends on: NAV, CROWD, METRO, API, SB
// ══════════════════════════════════════════════════════════════
window.STATION_UI = (function(){

  let _currentId = null;
  const REPORT_EXPIRY = 2 * 3600 * 1000;
  const _cache = {};  // stationId → { rows, ts }

  const _c = p => p===0?'var(--dim)':p<40?'#4ade80':p<70?'var(--y)':'#f87171';
  const _f = p => p===0?'rgba(255,255,255,.06)':p<40?'#4ade80':p<70?'var(--y)':'#f87171';
  const _l = p => p===0?'Station Closed':p<40?'Low Crowd':p<70?'Moderate Crowd':p<85?'High Crowd':'Packed';

  function onTabOpen(){
    const pv = document.getElementById('sp-val');
    if(pv && pv.classList.contains('ph')) setTimeout(() => SEARCH.open('station'), 200);
  }

  async function show(id){
    const s = METRO.STATIONS[id]; if(!s) return;
    _currentId = id;
    NAV.navTo('s-station');

    // Toggle empty/data divs
    const emptyEl = document.getElementById('stn-empty');
    const dataEl  = document.getElementById('stn-data');
    if(emptyEl) emptyEl.style.display = 'none';
    if(dataEl)  dataEl.style.display  = 'block';

    // Search bar label
    const pv = document.getElementById('sp-val');
    if(pv){ pv.textContent = s.n; pv.classList.remove('ph'); }

    // Try API for ML crowd value + forecast, fall back to local
    let v = 0, forecast = null;
    try {
      const res = await API.getCrowd(id, s.l[0]);
      v = res.crowd_pct;
      forecast = res.forecast;
      CROWD.state.crowdMap[id] = v;  // keep local state in sync
    } catch(_) {
      v = CROWD.state.crowdMap[id] || 0;
    }

    const c = _c(v), cf = _f(v);

    // Crowd number
    const nm = document.getElementById('cc-num');
    if(nm){ nm.textContent = v+'%'; nm.style.color = c; nm.style.opacity = '1'; }
    NAV._s('cc-name', s.n.toUpperCase());
    const lb = document.getElementById('cc-lbl');
    if(lb){ lb.textContent = _l(v); lb.style.color = c; lb.style.opacity = '1'; }
    const br = document.getElementById('cc-bar');
    if(br){ br.style.width = v+'%'; br.style.background = cf; }
    NAV._s('cc-meta', 'Updated just now · ' + s.l.map(l => METRO.LINE_NAMES[l]).join(' · '));

    // Safe-to-board card
    const sc = document.getElementById('safe-card');
    if(sc){
      sc.style.display = 'flex'; sc.style.background = v<40 ? 'rgba(74,222,128,.08)' : v<70 ? 'rgba(251,191,36,.08)' : 'rgba(239,68,68,.08)'; sc.style.border = '1px solid ' + (v<40 ? 'rgba(74,222,128,.2)' : v<70 ? 'rgba(251,191,36,.2)' : 'rgba(239,68,68,.2)');
      const icon = document.getElementById('sc-icon');
      const ans  = document.getElementById('sc-ans');
      const sub  = document.getElementById('sc-sub');
      if(v < 40){
        sc.className = 'safe-card yes';
        if(icon) icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        if(ans)  ans.textContent  = 'Good to board now';
        if(sub)  sub.textContent  = 'Low crowd — you should get a seat';
      } else if(v < 70){
        sc.className = 'safe-card';
        if(icon) icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
        if(ans)  ans.textContent  = 'Moderate crowd';
        if(sub)  sub.textContent  = 'Standing room — wait may help';
      } else {
        sc.className = 'safe-card no';
        if(icon) icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        if(ans)  ans.textContent  = 'Very crowded — try next train';
        if(sub)  sub.textContent  = 'All seats occupied, packed aisles';
      }
    }

    // Mini forecast (next 4 hours)
    const mfc = document.getElementById('mf-card'); if(mfc) mfc.style.display = 'block';
    const mfr = document.getElementById('mf-rows');
    if(mfr){
      const now = new Date().getHours();
      const fcArr = forecast
        ? (() => { const m={}; forecast.forEach(r => m[r.hour]=r.crowd_pct); return m; })()
        : null;
      mfr.innerHTML = [0,1,2,3].map(i => {
        const h = (now+i) % 24;
        const fv = fcArr ? (fcArr[h]||0) : (CROWD.stationForecast ? CROWD.stationForecast(id)[h]||0 : 0);
        const lbl = i===0 ? 'Now' : (h>12 ? `${h-12}p` : h===12 ? '12p' : `${h}a`);
        return `<div class="mf-row">
          <div class="mf-time">${lbl}</div>
          <div class="mf-track"><div class="mf-fill" style="width:${fv}%;background:${_f(fv)}"></div></div>
          <div class="mf-val" style="color:${_c(fv)}">${fv}%</div>
        </div>`;
      }).join('');
    }

    // Inline report + community
    const ir = document.getElementById('inline-rep'); if(ir) ir.style.display='flex';
    ir?.querySelectorAll('.ir-opt').forEach(o => o.classList.remove('active'));
    const cc = document.getElementById('comm-card'); if(cc) cc.style.display='block';
    const cl2 = document.getElementById('stn-coach-link'); if(cl2) cl2.style.display='flex';
    await _loadReports(id);
  }

  function gpsLookup(){
    if(!navigator.geolocation){ NAV.showToast('gps','GPS not available'); return; }
    NAV.showToast('gps','Finding nearest station…');
    navigator.geolocation.getCurrentPosition(pos => {
      const {latitude:lat, longitude:lng} = pos.coords;
      let best = null, bestD = Infinity;
      Object.keys(METRO.STATIONS).forEach(id => {
        const st = METRO.STATIONS[id];
        if(st.gps){ const d = Math.hypot(st.gps[0]-lat, st.gps[1]-lng); if(d < bestD){ bestD=d; best=id; } }
      });
      if(best) show(best);
      else NAV.showToast('gps','No station found nearby');
    }, () => NAV.showToast('gps','Location access denied'));
  }

  function goCoachFromHere(){
    if(_currentId) COACH_UI.setStation(_currentId);
    NAV.navTo('s-coach');
  }

  function quickReport(el, level){
    document.querySelectorAll('.ir-opt').forEach(o => o.classList.remove('active'));
    el.classList.add('active');
    if(!_currentId){ NAV.showToast('warn','No station selected'); return; }
    CROWD.state.userReports[_currentId] = level;
    CROWD.recomputeAll();
    show(_currentId);
    if(typeof SB !== 'undefined' && SB.isReady) SB.submitReport(_currentId, level);
    NAV.showToast('check','Report submitted — thanks!');
    setTimeout(() => el.classList.remove('active'), 2500);
  }

  // ── Community Reports ──────────────────────────────────────
  async function _loadReports(stationId){
    const listEl = document.getElementById('comm-items'); if(!listEl) return;
    listEl.innerHTML = '<div class="rp-empty" style="color:var(--sub)">Loading…</div>';

    const cached = _cache[stationId];
    if(cached && Date.now() - cached.ts < 90000){
      _renderRows(cached.rows, listEl, METRO.STATIONS[stationId]?.n);
      return;
    }

    if(!window.SB?.isReady){
      _renderRows([], listEl, METRO.STATIONS[stationId]?.n);
      return;
    }

    try {
      const twoHrsAgo = new Date(Date.now() - REPORT_EXPIRY).toISOString();
      const {data, error} = await SB.client
        .from('crowd_reports')
        .select('id,station_id,station_name,level,created_at,user_id')
        .eq('station_id', stationId)
        .gt('created_at', twoHrsAgo)
        .order('created_at', {ascending:false})
        .limit(10);
      if(error) throw error;
      _cache[stationId] = { rows: data||[], ts: Date.now() };
      _renderRows(data||[], listEl, METRO.STATIONS[stationId]?.n);
    } catch(err) {
      listEl.innerHTML = '<div class="rp-empty">Could not load reports.</div>';
    }
  }

  function prependReport(row){
    if(row.station_id !== _currentId) return;
    delete _cache[row.station_id];
    _loadReports(row.station_id);
  }

  function _renderRows(rows, el, stationName){
    if(!el) return;
    const fresh = (rows||[]).filter(r => Date.now() - new Date(r.created_at).getTime() < REPORT_EXPIRY);
    if(!fresh.length){
      el.innerHTML = '<div class="rp-empty">No community reports yet.</div>';
      return;
    }
    el.innerHTML = fresh.map(r => {
      const lv = r.level || 'moderate';
      const c  = lv==='empty'?'#4ade80':lv==='moderate'?'#fbbf24':lv==='crowded'?'#f97316':'#ef4444';
      const emoji = lv==='empty'?'😌':lv==='moderate'?'🙂':lv==='crowded'?'😰':'😱';
      const ago = _timeAgo(r.created_at);
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--brd)">
        <div style="font-size:18px">${emoji}</div>
        <div style="flex:1">
          <div style="font-size:12px;font-weight:700;color:${c}">${lv.charAt(0).toUpperCase()+lv.slice(1)}</div>
          <div style="font-size:10px;color:var(--sub);margin-top:1px">${ago}</div>
        </div>
        <div style="width:8px;height:8px;border-radius:50%;background:${c};flex-shrink:0"></div>
      </div>`;
    }).join('');
  }

  function _timeAgo(iso){
    const d = Date.now() - new Date(iso).getTime();
    if(d < 60000)   return `${Math.round(d/1000)}s ago`;
    if(d < 3600000) return `${Math.round(d/60000)} min ago`;
    return `${Math.round(d/3600000)}h ago`;
  }

  return {
    show, gpsLookup, goCoachFromHere, quickReport,
    prependReport, onTabOpen,
    get currentId(){ return _currentId; }
  };
})();
