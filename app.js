window.APP=(function(){
  let liveTimer=null;
  function init(){
    console.log('[APP] Boot');
    CROWD.state.hour=new Date().getHours();
    CROWD.recomputeAll();
    MAP.init('msvg',(id)=>{if(id)UI.openPanel(id);else UI.closePanel()});
    UI.init();
    UI.updateHeader();
    window.addEventListener('resize',()=>MAP.resize());
    startLive();
    setTimeout(()=>NEWS.start(),1000);
    const rb=document.getElementById('go-route');
    if(rb)rb.addEventListener('click',doRoute);
    const gb=document.getElementById('geo-btn');
    if(gb)gb.addEventListener('click',()=>ROUTE.requestLocation('rfrom'));
    console.log('[APP] Ready — '+Object.keys(METRO.STATIONS).length+' stations');
  }
  function startLive(){
    clearInterval(liveTimer);
    liveTimer=setInterval(()=>{
      if(!CROWD.state.isLive)return;
      const h=new Date().getHours();
      if(h===CROWD.state.hour)return;
      CROWD.state.hour=h;
      const sl=document.getElementById('ts');if(sl)sl.value=h;
      const tl=document.getElementById('tl');if(tl)tl.textContent=CROWD.hourLabel(h);
      const tm=document.getElementById('tm');if(tm)tm.textContent='● LIVE';
      UI.triggerUpdate();
    },15000);
  }
  function doRoute(){
    const from=document.getElementById('rfrom')?.value;
    const to=document.getElementById('rto')?.value;
    const avoid=document.getElementById('avck')?.checked??true;
    if(!from||!to){alert('Select both From and To stations.');return;}
    const result=ROUTE.compute(from,to,avoid);
    ROUTE.render(result);
    if(result.ok){
      UI.switchTab('map');
      setTimeout(()=>{
        if(result.path?.length>1){const mid=result.path[Math.floor(result.path.length/2)];MAP.flyTo(mid,1.6)}
        setTimeout(()=>UI.switchTab('route'),2800);
      },400);
    }
  }
  return{init,doRoute};
})();
document.addEventListener('DOMContentLoaded',APP.init);
