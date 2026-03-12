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
    if(!navigator.geolocation){
      NAV.showToast('warn','Location not supported on this device');
      return;
    }

    // ── Animate GPS button ──────────────────────────────────────
    const btn = document.getElementById('stn-gps-btn');
    function setBtnState(state) {
      if (!btn) return;
      if (state === 'loading') {
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--y)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin .8s linear infinite"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>';
        btn.style.borderColor = 'rgba(255,208,0,.4)';
        btn.style.background  = 'rgba(255,208,0,.08)';
      } else if (state === 'found') {
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        btn.style.borderColor = 'rgba(74,222,128,.4)';
        btn.style.background  = 'rgba(74,222,128,.08)';
        setTimeout(() => setBtnState('idle'), 2000);
      } else if (state === 'error') {
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--pk)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        btn.style.borderColor = 'rgba(239,68,68,.3)';
        btn.style.background  = 'rgba(239,68,68,.06)';
        setTimeout(() => setBtnState('idle'), 2500);
      } else {
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--sub)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8" stroke-dasharray="2 2" opacity=".4"/></svg>';
        btn.style.borderColor = 'var(--brd)';
        btn.style.background  = 'var(--card)';
      }
    }

    // ── Haversine in metres ─────────────────────────────────────
    function haversine(lat1, lng1, lat2, lng2) {
      const R = 6371000, toR = Math.PI/180;
      const dLat = (lat2-lat1)*toR, dLng = (lng2-lng1)*toR;
      const a = Math.sin(dLat/2)**2
              + Math.cos(lat1*toR)*Math.cos(lat2*toR)*Math.sin(dLng/2)**2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

    // ── Find nearest using METRO.GPS (correct data source) ──────
    function findNearest(lat, lng) {
      const gps = window.METRO && METRO.GPS;
      if (!gps) return null;
      let best = null, bestDist = Infinity;
      Object.entries(gps).forEach(([id, coord]) => {
        const d = haversine(lat, lng, coord[0], coord[1]);
        if (d < bestDist) { bestDist = d; best = id; }
      });
      return best ? { id: best, dist: bestDist } : null;
    }

    // ── Update search bar text to give live feedback ─────────────
    function setSearchHint(text) {
      const el = document.getElementById('sp-val');
      if (el) { el.textContent = text; el.className = 'sp-val ph'; }
    }

    setBtnState('loading');
    setSearchHint('📡 Finding your location…');

    // Try high-accuracy first, fallback to low-accuracy
    function tryLocate(highAccuracy, attempt) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords;

          // If accuracy is very poor and we haven't tried low-accuracy yet, retry
          if (acc > 200 && attempt === 1) {
            setSearchHint(`📡 Improving accuracy (±${Math.round(acc)}m)…`);
            tryLocate(false, 2);
            return;
          }

          const result = findNearest(lat, lng);
          if (!result) {
            setBtnState('error');
            setSearchHint('Search a station…');
            NAV.showToast('warn', 'Could not find nearby station');
            return;
          }

          const stn  = METRO.STATIONS[result.id];
          const name = stn ? stn.n : result.id;
          const dist = result.dist < 1000
            ? `${Math.round(result.dist)}m away`
            : `${(result.dist/1000).toFixed(1)}km away`;

          setBtnState('found');
          show(result.id);

          // Show accuracy badge in toast
          const accLabel = acc <= 20  ? '🎯 High accuracy'
                         : acc <= 60  ? '📍 Good accuracy'
                         : acc <= 150 ? '📡 Moderate accuracy'
                         : '⚠️ Low accuracy';
          NAV.showToast('ok', `${name} · ${dist} · ${accLabel}`);
        },
        err => {
          setBtnState('error');
          setSearchHint('Search a station…');
          const msg = err.code === 1 ? 'Location access denied — check browser settings'
                    : err.code === 2 ? 'Location unavailable. Move to open area'
                    : 'Location timed out. Try again';
          NAV.showToast('warn', msg);
        },
        {
          enableHighAccuracy: highAccuracy,
          timeout:            highAccuracy ? 10000 : 6000,
          maximumAge:         highAccuracy ? 0     : 30000,
        }
      );
    }

    tryLocate(true, 1);
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
