// ══════════════════════════════════════════════════════════════
//  ROUTE_UI.js — route planner screen
//  Owns: setStation, swap, compute, refresh
//  Depends on: NAV, ROUTE (algorithm), CROWD, METRO
// ══════════════════════════════════════════════════════════════
window.ROUTE_UI = (function(){

  let _from = null, _to = null;

  const _c = p => p===0?'var(--dim)':p<40?'#4ade80':p<70?'var(--y)':'#f87171';

  function setStation(side, id){
    const s = METRO.STATIONS[id]; if(!s) return;
    const v = CROWD.state?.crowdMap?.[id] || 0;

    if(side === 'from'){
      _from = id;
      const el = document.getElementById('rFrom');
      if(el){ el.textContent = s.n; el.classList.remove('ph'); }
      const ce = document.getElementById('rFromC');
      if(ce){ ce.textContent = T('crowd_colon')+' '+v+'%'; ce.style.color = _c(v); ce.style.display='block'; }
    } else {
      _to = id;
      const el = document.getElementById('rTo');
      if(el){ el.textContent = s.n; el.classList.remove('ph'); }
      const ce = document.getElementById('rToC');
      if(ce){ ce.textContent = T('crowd_colon')+' '+v+'%'; ce.style.color = _c(v); ce.style.display='block'; }
    }
  }

  function swap(){
    const tmp = _from; _from = _to; _to = tmp;
    const fromEl = document.getElementById('rFrom');
    const toEl   = document.getElementById('rTo');
    const fromC  = document.getElementById('rFromC');
    const toC    = document.getElementById('rToC');
    if(fromEl && toEl){
      const t = fromEl.textContent; fromEl.textContent = toEl.textContent; toEl.textContent = t;
      fromEl.classList.toggle('ph', !_from); toEl.classList.toggle('ph', !_to);
    }
    if(fromC && toC){
      const t = fromC.textContent; fromC.textContent = toC.textContent; toC.textContent = t;
    }
  }

  function refresh(){
    if(_from){ const s=METRO.STATIONS[_from]; const e=document.getElementById('rFrom'); if(e&&s){ e.textContent=s.n; e.classList.remove('ph'); } }
    if(_to){   const s=METRO.STATIONS[_to];   const e=document.getElementById('rTo');   if(e&&s){ e.textContent=s.n; e.classList.remove('ph'); } }
  }

  function compute(){
    if(!_from || !_to){ NAV.showToast('warn', T('pick_both')); return; }
    if(typeof ROUTE === 'undefined'){
      const el = document.getElementById('rres');
      if(el) el.innerHTML = '<div class="route-error">Route module loading… try again.</div>';
      return;
    }
    const avoid = document.getElementById('opt-avoid')?.classList.contains('on') ?? true;
    const result = ROUTE.compute(_from, _to, avoid);
    ROUTE.render(result);
    const rres = document.getElementById('rres');
    if(rres) setTimeout(() => rres.scrollIntoView({behavior:'smooth', block:'start'}), 100);
  }

  return { setStation, swap, compute, refresh };
})();
