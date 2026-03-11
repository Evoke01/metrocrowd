// ─────────────────────────────────────────────────────────────────
//  install.js — PWA Install Banner + Instructions
//  Shows install prompt to web/browser users
//  Hides if already running as standalone PWA
// ─────────────────────────────────────────────────────────────────
(function(){
  'use strict';

  // Don't show if already installed
  if(window.matchMedia('(display-mode: standalone)').matches) return;
  if(window.navigator.standalone) return; // iOS PWA

  var ua        = navigator.userAgent.toLowerCase();
  var isIOS     = /iphone|ipad|ipod/.test(ua);
  var isAndroid = /android/.test(ua);
  var isDesktop = !isIOS && !isAndroid;
  var deferred  = null;

  // Build banner HTML
  var bannerHTML = `
    <div id="ib" style="display:none;position:fixed;bottom:0;left:0;right:0;z-index:9999;
      padding:12px 16px calc(12px + env(safe-area-inset-bottom));
      background:linear-gradient(to top,#080808 70%,rgba(8,8,8,.96));
      border-top:1px solid rgba(245,168,0,.3);
      animation:sUp .35s cubic-bezier(.22,1,.36,1)">
      <div style="max-width:480px;margin:0 auto">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
          <img src="icons/icon-96.png" style="width:44px;height:44px;border-radius:12px;flex-shrink:0">
          <div style="flex:1">
            <div style="font-family:'Syne',sans-serif;font-size:13px;font-weight:800;color:#fff">Install MetroCrowd</div>
            <div style="font-size:10px;color:#888;margin-top:1px">
              ${isDesktop ? 'Use as a desktop app — no browser bar' : 'Add to home screen for best experience'}
            </div>
          </div>
          <button id="ib-x" style="background:none;border:none;color:#666;font-size:20px;cursor:pointer;padding:4px;line-height:1"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div style="display:flex;gap:8px">
          <button id="ib-install" style="flex:1;height:44px;background:#F5A800;border:none;border-radius:12px;
            font-family:'Syne',sans-serif;font-size:13px;font-weight:800;color:#000;cursor:pointer">
            ${isDesktop ? 'Install App' : 'Add to Home Screen'}
          </button>
          <button id="ib-how" style="height:44px;padding:0 14px;background:rgba(255,255,255,.06);
            border:1px solid rgba(255,255,255,.1);border-radius:12px;
            font-size:11px;font-weight:600;color:#888;cursor:pointer;white-space:nowrap">How?</button>
        </div>
      </div>
    </div>

    <div id="im" style="display:none;position:fixed;inset:0;z-index:10000;
      background:rgba(0,0,0,.88);backdrop-filter:blur(10px)">
      <div style="position:absolute;bottom:0;left:0;right:0;
        background:#111;border-radius:24px 24px 0 0;padding:24px 20px calc(32px + env(safe-area-inset-bottom));
        max-width:480px;margin:0 auto;border-top:1px solid #222">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
          <div style="font-family:'Syne',sans-serif;font-size:16px;font-weight:800;color:#fff">How to install</div>
          <button id="im-x" style="background:#1e1e1e;border:1px solid #333;color:#666;
            width:30px;height:30px;border-radius:50%;font-size:14px;cursor:pointer"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div id="im-steps"></div>
        <button id="im-install" style="width:100%;height:48px;background:#F5A800;border:none;
          border-radius:14px;font-family:'Syne',sans-serif;font-size:14px;font-weight:800;
          color:#000;cursor:pointer;margin-top:16px;display:none">Install Now</button>
      </div>
    </div>`;

  // Inject into DOM
  var wrap = document.createElement('div');
  wrap.innerHTML = bannerHTML;
  document.body.appendChild(wrap);

  var banner = document.getElementById('ib');
  var modal  = document.getElementById('im');
  var steps  = document.getElementById('im-steps');

  function step(n, html){
    return `<div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:14px">
      <div style="width:24px;height:24px;border-radius:50%;background:#F5A800;color:#000;
        font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">${n}</div>
      <div style="font-size:12px;color:#ccc;line-height:1.6;padding-top:3px">${html}</div>
    </div>`;
  }

  var instructions = {
    android: [
      'Tap the <b style="color:#F5A800">⋮</b> menu button in Chrome (top right)',
      'Tap <b style="color:#F5A800">Add to Home screen</b>',
      'Tap <b style="color:#F5A800">Add</b> to confirm',
      'Open MetroCrowd from your home screen — no browser bar!'
    ],
    ios: [
      'Tap the <b style="color:#F5A800">Share</b> button at the bottom of Safari (box with arrow ↑)',
      'Scroll down and tap <b style="color:#F5A800">Add to Home Screen</b>',
      'Tap <b style="color:#F5A800">Add</b> in the top right corner',
      'Open MetroCrowd from your home screen — works like a native app!'
    ],
    desktop: [
      'Look for the <b style="color:#F5A800">⊕ install icon</b> in your browser address bar',
      'Click it and select <b style="color:#F5A800">Install</b>',
      'Or click <b style="color:#F5A800">Install Now</b> below',
      'MetroCrowd opens as a standalone app — no browser toolbar!'
    ]
  };

  function showBanner(){
    if(sessionStorage.getItem('ib-dismissed')) return;
    if(window.matchMedia('(display-mode: standalone)').matches) return;
    banner.style.display = 'block';
  }

  function hideBanner(){
    banner.style.display = 'none';
  }

  function showModal(){
    var list = isIOS ? instructions.ios : isAndroid ? instructions.android : instructions.desktop;
    steps.innerHTML = list.map((s,i) => step(i+1, s)).join('');
    document.getElementById('im-install').style.display = deferred ? 'block' : 'none';
    modal.style.display = 'block';
  }

  function triggerInstall(){
    if(deferred){
      deferred.prompt();
      deferred.userChoice.then(function(r){
        if(r.outcome === 'accepted'){ hideBanner(); modal.style.display='none'; }
        deferred = null;
      });
    } else {
      showModal();
    }
  }

  // Events
  document.getElementById('ib-install').addEventListener('click', triggerInstall);
  document.getElementById('ib-how').addEventListener('click', showModal);
  document.getElementById('ib-x').addEventListener('click', function(){
    hideBanner();
    sessionStorage.setItem('ib-dismissed','1');
  });
  document.getElementById('im-x').addEventListener('click', function(){ modal.style.display='none'; });
  document.getElementById('im-install').addEventListener('click', triggerInstall);

  // Catch native install prompt (Android Chrome / desktop)
  window.addEventListener('beforeinstallprompt', function(e){
    e.preventDefault();
    deferred = e;
    setTimeout(showBanner, 3500);
  });

  // iOS and desktop fallback — show after delay
  if(isIOS || isDesktop){
    setTimeout(showBanner, 5000);
  }

  // Hide when installed
  window.addEventListener('appinstalled', hideBanner);

})();
