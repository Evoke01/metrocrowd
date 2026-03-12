// ─────────────────────────────────────────────────────────────────────────────
//  ui-proxy.js — bridges all UI.* calls in index.html to the correct v3 modules
//  Loaded last (after all modules). Extends window.UI with delegations.
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {

  // Small delay so all modules initialise first
  setTimeout(function () {

    // Extend whatever window.UI already is (old js/ui.js keeps init/triggerUpdate)
    window.UI = window.UI || {};

    // ── Navigation ──────────────────────────────────────────────
    UI.navTo       = (id)    => NAV.navTo(id);
    UI.hideToast   = ()      => NAV.hideToast();

    // ── Search overlay ──────────────────────────────────────────
    UI.openSearch  = (mode)  => SEARCH.open(mode);
    UI.filterSearch= (q)     => SEARCH.filter(q);
    UI.closeSearch = ()      => SEARCH.close();

    // ── Station tab ─────────────────────────────────────────────
    UI.gpsStation        = ()           => STATION_UI.gpsLookup();
    UI.quickReport       = (el, level)  => STATION_UI.quickReport(el, level);
    UI.goCoachFromStation= ()           => STATION_UI.goCoachFromHere();

    // ── Coach tab ───────────────────────────────────────────────
    UI.openCoachLineSelect = ()    => COACH_UI.openLinePicker();
    UI.closeLineSelect     = ()    => COACH_UI.closeLinePicker?.() || document.getElementById('ov-line')?.classList.remove('open');
    UI.coachSetDir         = (d)   => COACH_UI.setDir?.(d);

    // ── Route tab ───────────────────────────────────────────────
    UI.swapRoute = () => ROUTE_UI.swap();
    UI.doRoute   = () => ROUTE_UI.compute();

    // ── Report tab ──────────────────────────────────────────────
    UI.pickLevel   = (el) => REPORT_UI.pickLevel(el);
    UI.submitReport= ()   => REPORT_UI.submit();

    console.log('[UI-PROXY] All UI.* delegates wired');
    if(typeof AUTH !== 'undefined') AUTH.wrapSignInWithConsent();
    if(typeof LEGAL !== 'undefined') LEGAL.init();
    if(typeof SETTINGS !== 'undefined') SETTINGS.init();

  }, 0);
});
