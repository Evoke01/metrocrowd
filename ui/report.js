// ══════════════════════════════════════════════════════════════
//  REPORT_UI.js — crowd report submission screen
//  Owns: setStation, pickLevel, submit, karma, network feed
//  Depends on: NAV, CROWD, METRO, SB
// ══════════════════════════════════════════════════════════════
window.REPORT_UI = (function(){

  let _station  = null;
  let _level    = '';
  let _karma    = parseInt(localStorage.getItem('v3_karma') || '0', 10);
  const EXPIRY  = 2 * 3600 * 1000;

  function onTabOpen(){
    NAV._s('karma-num', _karma);
    _loadNetworkFeed();
  }

  function setStation(id){
    _station = id;
    const s = METRO.STATIONS[id]; if(!s) return;
    const btn = document.getElementById('rep-stn');
    if(btn){ btn.textContent = s.n; btn.style.color = 'var(--txt)'; btn.classList.remove('ph'); }
    _updateBtn();
  }

  function pickLevel(el){
    document.querySelectorAll('.cp').forEach(c => {
      c.classList.remove('sel');
      c.style.borderColor = 'var(--brd)';
      c.style.background  = 'var(--card)';
      const chk = c.querySelector('.cp-check');
      if(chk) chk.style.display = 'none';
    });
    el.classList.add('sel');
    const lv = el.dataset.v || '';
    const col = lv==='empty'?'#4ade80':lv==='moderate'?'#fbbf24':lv==='crowded'?'#f97316':'#ef4444';
    el.style.borderColor = col;
    el.style.background  = col.replace(')',', .08)').replace('rgb','rgba').replace('#4ade80','rgba(74,222,128,.1)').replace('#fbbf24','rgba(251,191,36,.1)').replace('#f97316','rgba(249,115,22,.1)').replace('#ef4444','rgba(239,68,68,.1)');
    const chk = el.querySelector('.cp-check');
    if(chk) chk.style.display = 'flex';
    _level = lv;
    _updateBtn();
  }

  function submit(){
    if(!_station || !_level){ NAV.showToast('warn','Pick a station and crowd level first'); return; }

    // Optimistic local update
    CROWD.state.userReports[_station] = _level;
    CROWD.recomputeAll();

    // Persist to Supabase
    if(typeof SB !== 'undefined' && SB.isReady){
      SB.submitReport(_station, _level);
    }

    // Prepend to feed
    _prependToFeed({
      station_id:   _station,
      station_name: METRO.STATIONS[_station]?.n || _station,
      level:        _level,
      created_at:   new Date().toISOString(),
    });

    // Show success + bump karma
    const ok = document.getElementById('rep-ok');
    if(ok){ ok.style.display='flex'; setTimeout(() => ok.style.display='none', 3500); }
    _bumpKarma();

    // Reset form
    _station = null; _level = '';
    const btn = document.getElementById('rep-stn');
    if(btn){ btn.textContent = 'Select your station'; btn.classList.add('ph'); }
    document.querySelectorAll('.cp').forEach(c => c.classList.remove('sel'));
    const submitBtn = document.getElementById('rep-btn'); if(submitBtn) submitBtn.disabled = true;
    const note = document.getElementById('rep-note'); if(note) note.value = '';
  }

  // ── Network feed (report tab community list) ───────────────
  async function _loadNetworkFeed(){
    const listEl = document.getElementById('rep-feed'); if(!listEl) return;
    if(!window.SB?.isReady){
      listEl.innerHTML = '<div class="rp-empty">Connect to see community reports.</div>';
      return;
    }
    try {
      const since = new Date(Date.now() - EXPIRY).toISOString();
      const {data, error} = await SB.client
        .from('crowd_reports')
        .select('id,station_id,station_name,level,created_at')
        .gt('created_at', since)
        .order('created_at', {ascending:false})
        .limit(30);
      if(error) throw error;
      _renderFeed(data||[], listEl);
    } catch(_){
      listEl.innerHTML = '<div class="rp-empty">Could not load reports.</div>';
    }
  }

  function _prependToFeed(row){
    const listEl = document.getElementById('rep-feed'); if(!listEl) return;
    const empty = listEl.querySelector('.rp-empty');
    if(empty) listEl.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'fi';
    const lv = row.level;
    const c  = lv==='empty'?'var(--low)':lv==='moderate'?'var(--y)':'#f87171';
    const icon = '';
    const emoji2 = lv==='empty'?'😌':lv==='moderate'?'🙂':lv==='crowded'?'😰':'😱';
    el.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--card);border:1px solid var(--brd);border-radius:12px;margin-bottom:7px';
    el.innerHTML = `<div style="font-size:18px">${emoji2}</div>
      <div style="flex:1">
        <div style="font-size:12px;font-weight:700;color:var(--txt)">${row.station_name}</div>
        <div style="font-size:10px;color:${c};margin-top:1px;font-weight:600">${lv.charAt(0).toUpperCase()+lv.slice(1)} · just now</div>
      </div>
      <div style="width:8px;height:8px;border-radius:50%;background:${c};flex-shrink:0"></div>`;
    listEl.prepend(el);
    while(listEl.children.length > 30) listEl.removeChild(listEl.lastChild);
  }

  function _renderFeed(rows, el){
    if(!rows.length){ el.innerHTML='<div class="rp-empty">No reports in last 2 hours.</div>'; return; }
    el.innerHTML = rows.map(r => {
      const lv = r.level; const c = lv==='empty'?'#4ade80':lv==='moderate'?'#fbbf24':lv==='crowded'?'#f97316':'#ef4444';
      const icon = lv==='empty'?'😌':lv==='moderate'?'🙂':lv==='crowded'?'😰':'😱';
      const ago = _timeAgo(r.created_at);
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;
        background:var(--card);border:1px solid var(--brd);border-radius:12px;margin-bottom:7px">
        <div style="font-size:18px">${icon}</div>
        <div style="flex:1">
          <div style="font-size:12px;font-weight:700;color:var(--txt)">${r.station_name}</div>
          <div style="font-size:10px;color:${c};margin-top:1px;font-weight:600">${lv.charAt(0).toUpperCase()+lv.slice(1)} · ${ago}</div>
        </div>
        <div style="width:8px;height:8px;border-radius:50%;background:${c};flex-shrink:0"></div>
      </div>`;
    }).join('');
  }

  function _updateBtn(){
    const btn = document.getElementById('rep-btn');
    if(btn) btn.disabled = !(_station && _level);
  }

  function _bumpKarma(){
    _karma++;
    localStorage.setItem('v3_karma', _karma);
    NAV._s('karma-num', _karma);
    NAV._s('rs-karma', _karma);
  }

  function _timeAgo(iso){
    const d = Date.now() - new Date(iso).getTime();
    if(d < 60000)   return `${Math.round(d/1000)}s ago`;
    if(d < 3600000) return `${Math.round(d/60000)} min ago`;
    return `${Math.round(d/3600000)}h ago`;
  }

  return {
    onTabOpen, setStation, pickLevel, submit,
    prependReport: _prependToFeed,
    get karma(){ return _karma; }
  };
})();
