// ══════════════════════════════════════════════════════════════
//  SEARCH.js — station search overlay
//  Owns: openSearch, filterSearch, closeSearch, _overlayPick
//  Depends on: NAV, CROWD, METRO
// ══════════════════════════════════════════════════════════════
window.SEARCH = (function(){

  let _mode = '';  // 'station'|'coach-station'|'coach-dest'|'r-from'|'r-to'|'report'|'home'

  const LABELS = {
    'station':       ()=>T('search_label_station'),
    'coach-station': ()=>T('search_label_coach_stn'),
    'coach-dest':    ()=>T('search_label_coach_dest'),
    'r-from':        ()=>T('search_label_from'),
    'r-to':          ()=>T('search_label_to'),
    'report':        ()=>T('search_label_report'),
    'home':          ()=>T('search_label_home'),
  };

  const LINE_COL = {
    Y:'#FFD600', B:'#2979FF', R:'#F44336', P:'#E040FB',
    M:'#AB47BC', V:'#7E57C2', G:'#4CAF50', A:'#FF9800',
    Gr:'#9E9E9E', Aq:'#00BCD4'
  };

  function open(mode){
    _mode = mode;
    const lbl = document.getElementById('ov-lbl');
    if(lbl) lbl.textContent = (LABELS[mode] ? LABELS[mode]() : T('search_label_station'));
    const inp = document.getElementById('ov-input');
    if(inp) inp.value = '';
    _render('');
    document.getElementById('ov-search')?.classList.add('open');
    setTimeout(() => document.getElementById('ov-input')?.focus(), 80);
  }

  function close(){
    document.getElementById('ov-search')?.classList.remove('open');
    document.getElementById('ov-line')?.classList.remove('open');
  }

  function filter(q){ _render(q); }

  function _render(q){
    const all = Object.keys(METRO.STATIONS)
      .sort((a,b) => METRO.STATIONS[a].n.localeCompare(METRO.STATIONS[b].n));
    const filtered = q
      ? all.filter(id => METRO.STATIONS[id].n.toLowerCase().includes(q.toLowerCase()))
      : all;

    const list = document.getElementById('ov-list');
    if(!list) return;

    list.innerHTML = filtered.map(id => {
      const s = METRO.STATIONS[id]; if(!s) return '';
      const v = CROWD.state?.crowdMap?.[id] || 0;
      const vc = _color(v);
      const dots = s.l.map(l =>
        `<div class="ov-dot" style="background:${LINE_COL[l]||'#888'}"></div>`
      ).join('');
      return `<div class="ov-item" onclick="SEARCH.pick('${id}')">
        <div class="ov-ico">${s.ix ? '⇄' : '·'}</div>
        <div style="flex:1">
          <div class="ov-name">${s.n}</div>
          <div class="ov-line">${s.l.map(l => METRO.LINE_NAMES[l]).join(' · ')}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <div style="display:flex;gap:3px">${dots}</div>
          <div class="ov-pct" style="color:${vc}">${v ? v+'%' : ''}</div>
        </div>
      </div>`;
    }).join('');
  }

  function pick(id){
    close();
    if(_mode === 'home')                          HOME_UI.setStation(id);
    else if(_mode === 'station')                  STATION_UI.show(id);
    else if(_mode === 'coach-station')            COACH_UI.setStation(id);
    else if(_mode === 'coach-dest')               COACH_UI.setDest(id);
    else if(_mode === 'commute-pick')             COMMUTE._onSearchPick(id);
    else if(_mode === 'r-from')                   ROUTE_UI.setStation('from', id);
    else if(_mode === 'r-to')                     ROUTE_UI.setStation('to', id);
    else if(_mode === 'report')                   REPORT_UI.setStation(id);
  }

  function _color(p){
    return p === 0 ? 'var(--dim)' : p < 40 ? '#4ade80' : p < 70 ? 'var(--y)' : '#f87171';
  }

  return { open, close, filter, pick };
})();
