// ══════════════════════════════════════════════════════════════
//  NAV.js — bottom tab navigation + toast
//  Owns: navTo, switchTab, showToast, clock
// ══════════════════════════════════════════════════════════════
window.NAV = (function(){

  let _activeTab = 's-home';

  function activeTab(){ return _activeTab; }

  function navTo(screenId){
    _activeTab = screenId;
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(screenId);
    if(el) el.classList.add('active');
    document.querySelectorAll('.bni').forEach(b =>
      b.classList.toggle('on', b.dataset.tab === screenId)
    );
    // Notify other modules of tab change
    if(screenId === 's-route')   typeof ROUTE_UI !== 'undefined' && ROUTE_UI.refresh();
    if(screenId === 's-report')  typeof REPORT_UI !== 'undefined' && REPORT_UI.onTabOpen();
    if(screenId === 's-home')    typeof HOME_UI !== 'undefined' && HOME_UI.refresh();
    if(screenId === 's-station') typeof STATION_UI !== 'undefined' && STATION_UI.onTabOpen();
    if(screenId === 's-coach')   typeof COACH_UI !== 'undefined' && COACH_UI.refresh();
  }

  // Legacy alias used by supabase.js
  function switchTab(tab){
    const MAP = {
      map:'s-home', stats:'s-home', route:'s-route',
      report:'s-report', home:'s-home', coach:'s-coach', station:'s-station'
    };
    navTo(MAP[tab] || 's-' + tab);
  }

  function refreshIfActive(tab){
    if(_activeTab === tab) switchTab(tab);
  }

  // ── Clock ──────────────────────────────────────────────────
  function startClock(){
    function tick(){
      const d = new Date(), h = d.getHours(), m = d.getMinutes();
      const el = document.getElementById('sbar-clock');
      if(el) el.textContent = `${h}:${m < 10 ? '0'+m : m}`;
    }
    setInterval(tick, 30000);
    tick();
  }

  // ── Toast ─────────────────────────────────────────────────
  let _toastTimer = null;

  const _TOAST_SVGS = {
    check: '<polyline points="20 6 9 17 4 12"/>',
    warn:  '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    gps:   '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    pin:   '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>',
    bell:  '<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>',
    info:  '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    train: '<rect x="2" y="7" width="20" height="11" rx="2"/><line x1="7" y1="12" x2="17" y2="12"/>',
    flag:  '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  };

  function showToast(ico, txt){
    const el = document.getElementById('tIco'), tl = document.getElementById('tTxt');
    if(el){
      const body = _TOAST_SVGS[ico];
      if(body){
        el.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
      } else {
        el.textContent = ico; // fallback for any remaining emoji
      }
    }
    if(tl) tl.textContent = txt;
    const t = document.getElementById('toast');
    if(!t) return;
    t.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  function hideToast(){
    document.getElementById('toast')?.classList.remove('show');
  }

  // ── Shared DOM helpers ────────────────────────────────────
  function _s(id, v){ const e = document.getElementById(id); if(e) e.textContent = v; }
  function _sc(id, v, c){ const e = document.getElementById(id); if(e){ e.textContent = v; e.style.color = c; } }
  function _st(id, p, v){ const e = document.getElementById(id); if(e) e.style[p] = v; }

  return {
    navTo, switchTab, refreshIfActive, startClock,
    showToast, hideToast, activeTab,
    _s, _sc, _st   // shared by all ui modules
  };
})();
