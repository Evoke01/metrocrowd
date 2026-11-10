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
    const changed=(side==='from'?_from:_to)!==id;
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
    if(changed)clearResult();
  }

  function swap(){
    const tmp = _from; _from = _to; _to = tmp;
    refresh();
    clearResult();
  }

  function clearResult(){
    const result=document.getElementById('rres');
    if(result){result.innerHTML='';result.style.display='none';}
    document.getElementById('guide-panel')?.remove();
    window._lastRouteResult=null;
    if(typeof ROUTE!=='undefined')ROUTE.clearRoute();
  }

  function locateOrigin(){
    if(!window.GPS?.locateOnce){ NAV.showToast('warn', 'Location is unavailable on this device'); return; }
    const button = document.getElementById('route-locate-btn');
    if(button){ button.disabled = true; button.textContent = 'Locating…'; }
    GPS.locateOnce(result => {
      if(button){ button.disabled = false; button.textContent = 'Use my location'; }
      if(!result){ NAV.showToast('warn', 'Could not determine your nearest station'); return; }
      setStation('from', result.id);
      const msg = document.getElementById('route-location-msg');
      if(msg) msg.textContent = `Nearest station: ${result.name} · ${Math.round(result.distance)} m away`;
      NAV.showToast('ok', `Route starts at ${result.name}`);
    });
  }

  function refresh(){
    [['from',_from],['to',_to]].forEach(([side,id])=>{
      const station=id&&METRO.STATIONS[id];
      const name=document.getElementById(side==='from'?'rFrom':'rTo');
      const crowd=document.getElementById(side==='from'?'rFromC':'rToC');
      if(name){name.textContent=station?.n||(side==='from'?T('select_origin'):T('select_destination'));name.classList.toggle('ph',!station);}
      if(crowd){
        if(station){const v=CROWD.state?.crowdMap?.[id]||0;crowd.textContent=T('crowd_colon')+' '+v+'%';crowd.style.color=_c(v);crowd.style.display='block';}
        else{crowd.textContent='';crowd.style.display='none';}
      }
    });
  }

  function compute(){
    if(!_from || !_to){ NAV.showToast('warn', T('pick_both')); return; }
    if(_from===_to){ NAV.showToast('warn', 'Choose two different stations'); return; }
    if(typeof ROUTE === 'undefined'){
      const el = document.getElementById('rres');
      if(el) el.innerHTML = '<div class="route-error">Route module loading… try again.</div>';
      return;
    }
    const avoid = document.getElementById('opt-avoid')?.classList.contains('on') ?? true;
    const mode = document.getElementById('opt-fewest')?.classList.contains('on') ? 'fewest' : 'fastest';
    const result = ROUTE.compute(_from, _to, avoid, mode);
    ROUTE.render(result);
    const rres = document.getElementById('rres');
    if(rres) setTimeout(() => rres.scrollIntoView({behavior:'smooth', block:'start'}), 100);
  }

  return { setStation, swap, locateOrigin, compute, refresh };
})();
