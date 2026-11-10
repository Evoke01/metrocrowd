window.APP=(function(){
  // Register service worker on load
  if("serviceWorker" in navigator){
    window.addEventListener("load",function(){
      navigator.serviceWorker.register("/sw.js",{scope:"/"}).then(function(r){console.log("[SW] registered");}).catch(function(e){console.warn("[SW] failed",e);});
    });
  }

  let liveTimer=null;

  async function init(){
    console.log('[APP] Boot v2');
    CROWD.state.hour=new Date().getHours();
    CROWD.recomputeAll();

    // v2: no SVG map — skip MAP.init
    // MAP is still available for route.js internal use (hidden SVG)
    if(typeof MAP!=='undefined'&&MAP.init){
      try{ MAP.init('map-hidden',()=>{}); }catch(e){}
    }

    UI.init();
    if(typeof COMMUTE !== 'undefined') COMMUTE.init();

    window.addEventListener('resize',()=>{
      if(typeof MAP!=='undefined'&&MAP.resize) MAP.resize();
    });

    // Supabase
    if(typeof SB!=='undefined'){
      const sbOk=await SB.init();
      if(sbOk) console.log('[APP] Supabase ready');
    }

    // Notifications + anomaly engine
    if(typeof NOTIFY!=='undefined') await NOTIFY.init();

    // GPS
    if(typeof GPS!=='undefined') GPS.init();

    // Anon ID badge
    const badge=document.getElementById('anon-id-badge');
    if(badge&&typeof ANON!=='undefined'&&ANON.id())
      badge.textContent=ANON.id().slice(0,8)+'…';

    startLive();
    setTimeout(()=>{ if(typeof NEWS!=='undefined') NEWS.start(); },1500);

    console.log('[APP] Ready — '+Object.keys(METRO.STATIONS).length+' stations');
  }

  function startLive(){
    clearInterval(liveTimer);
    liveTimer=setInterval(()=>{
      if(!CROWD.state.isLive) return;
      const h=new Date().getHours();
      if(h!==CROWD.state.hour){
        CROWD.state.hour=h;
      }
      UI.triggerUpdate();
      if(typeof SB!=='undefined'&&SB.isReady) SB.pushSnapshot();
    },30000);
  }

  return{init};
})();
document.addEventListener('DOMContentLoaded',APP.init);
