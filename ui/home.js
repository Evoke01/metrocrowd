// ══════════════════════════════════════════════════════════════
//  HOME_UI.js — home screen
//  Owns: greeting, hero card, forecast strip, line list
//  Depends on: NAV, CROWD, METRO, API
// ══════════════════════════════════════════════════════════════
window.HOME_UI = (function(){

  let _station = localStorage.getItem('v3_home_station') || null;

  const _c = p => p===0?'var(--dim)':p<40?'#4ade80':p<70?'var(--y)':'#f87171';
  const _f = p => p===0?'rgba(255,255,255,.06)':p<40?'#4ade80':p<70?'var(--y)':'#f87171';
  const _l = p => p===0?'Station Closed':p<40?'Low Crowd':p<70?'Moderate Crowd':p<85?'High Crowd':'Packed';

  function init(){
    _buildGreeting();
    setInterval(_buildGreeting, 60000);


    // Default to Rajiv Chowk
    if(!_station){
      _station = Object.keys(METRO.STATIONS).find(id => METRO.STATIONS[id].n === 'Rajiv Chowk')
               || Object.keys(METRO.STATIONS)[0];
      localStorage.setItem('v3_home_station', _station);
    }

    _render();
    setInterval(refresh, 120000);  // refresh every 2 min
  }

  function refresh(){
    _render();
  }

  function setStation(id){
    _station = id;
    localStorage.setItem('v3_home_station', id);
    _render();
  }

  function _buildGreeting(){
    const h = new Date().getHours();
    const grKey = h < 12 ? 'good_morning' : h < 17 ? 'good_afternoon' : 'good_evening';
    const gr = (typeof SETTINGS !== 'undefined') ? SETTINGS.t(grKey)
      : (h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening');
    NAV._s('h-greet', gr);
    NAV._s('h-date', new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'}));
  }

  async function _render(){
    // If commute is active, let commute.js own the hero card
    if(typeof COMMUTE !== 'undefined' && COMMUTE.getDirection()) return;
    if(!_station) return;
    const s = METRO.STATIONS[_station]; if(!s) return;

    // Try API first, fall back to local CROWD engine
    let v = 0, forecast = null;
    try {
      const res = await API.getCrowd(_station, s.l[0]);
      v = res.crowd_pct;
      forecast = res.forecast || null;
    } catch(_) {
      v = CROWD.state.crowdMap[_station] || 0;
    }

    const c = _c(v);
    NAV._s('h-from', s.n);
    NAV._s('fc-stn', s.n);
    NAV._s('home-stn-lbl', s.n.split(' ').slice(0,2).join(' '));

    const numEl = document.getElementById('h-num');
    if(numEl){ numEl.textContent = v+'%'; numEl.style.color = c; }
    const lblEl = document.getElementById('h-lbl');
    if(lblEl){ lblEl.textContent = _l(v); lblEl.style.color = c; }
    const barEl = document.getElementById('h-bar');
    if(barEl){ barEl.style.width = v+'%'; barEl.style.background = c; }
    const subEl = document.getElementById('h-sub');
    if(subEl) subEl.textContent = s.l.map(l => METRO.LINE_NAMES[l]).join(' · ') + (s.ix ? ' · Interchange' : '');
    const tagEl = document.getElementById('h-tag');
    if(tagEl){
      if(v < 40){ tagEl.className='hero-tag safe'; tagEl.innerHTML='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Good time to board now'; }
      else if(v < 70){ tagEl.className='hero-tag'; tagEl.innerHTML='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Moderate — wait may help'; }
      else { tagEl.className='hero-tag'; tagEl.innerHTML='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Very packed — try next train'; }
    }

    _buildForecast(forecast);
    _buildLineList();
  }

  function _buildForecast(apiData){
    const strip = document.getElementById('fc-strip'); if(!strip) return;
    const now = new Date().getHours();

    // Use API forecast if available, else local CROWD engine
    let vals;
    if(apiData && Array.isArray(apiData)){
      const map = {};
      apiData.forEach(r => { map[r.hour] = r.crowd_pct; });
      vals = Array.from({length:8}, (_,i) => ({ h:(now+i)%24, v: map[(now+i)%24] || 0, isNow: i===0 }));
    } else {
      const fc = CROWD.stationForecast ? CROWD.stationForecast(_station) : new Array(24).fill(0);
      vals = Array.from({length:8}, (_,i) => ({ h:(now+i)%24, v: fc[(now+i)%24]||0, isNow: i===0 }));
    }

    const mx = Math.max(1, ...vals.map(s => s.v));
    strip.innerHTML = vals.map(({h, v, isNow}) => {
      const ht = Math.round(v / mx * 100);
      const lbl = isNow ? 'Now' : (h > 12 ? `${h-12}p` : h === 12 ? '12p' : h === 0 ? '12a' : `${h}a`);
      return `<div class="fc-slot${isNow?' now':''}">
        <div class="fc-time">${lbl}</div>
        <div class="fc-well"><div class="fc-fill" style="height:${ht}%;background:${_f(v)}"></div></div>
        <div class="fc-val">${v}%</div>
      </div>`;
    }).join('');
  }

  function _buildLineList(){
    const ll = document.getElementById('line-list'); if(!ll) return;
    const avgs = CROWD.lineAverages ? CROWD.lineAverages() : [];
    if(!avgs.length){ ll.innerHTML='<div style="padding:14px;font-size:11px;color:var(--sub);text-align:center">Loading…</div>'; return; }
    ll.innerHTML = avgs.map(({l, avg, name, color, count, isOpen}) => {
      const c = isOpen ? _c(avg) : 'var(--dim)';
      return `<div class="line-row" onclick="SEARCH.open('station')">
        <div class="lr-dot" style="background:${color||'#888'};opacity:${isOpen?1:.4}"></div>
        <div class="lr-name" style="opacity:${isOpen?1:.55}">${name}</div>
        <div class="lr-st" style="opacity:${isOpen?1:.4}">${count} st</div>
        <div class="lr-right">
          <div class="lr-pct" style="color:${c}">${isOpen ? avg+'%' : 'Closed'}</div>
          ${isOpen ? `<div class="lr-bar-bg"><div class="lr-bar-fill" style="width:${avg}%;background:${c}"></div></div>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  return { init, refresh, setStation, get station(){ return _station; } };
})();
