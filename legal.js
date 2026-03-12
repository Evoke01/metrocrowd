// ─────────────────────────────────────────────────────────────────────────────
//  LEGAL.js — Consent gate + first-launch disclaimer modal
//
//  Flow:
//   1. First launch ever → show disclaimer modal (once, stored in localStorage)
//   2. Clicking sign-in → show consent checkboxes before OAuth fires
//   3. After OAuth, store consent record to Supabase (consent_logs table)
//
//  Public:
//    LEGAL.init()                   — called from app.js on boot
//    LEGAL.interceptSignIn(fn)      — wrap a sign-in function with consent check
//    LEGAL.proceedAfterConsent()    — called by Continue button in login gate
//    LEGAL.cancelConsent()          — called by Go back link
// ─────────────────────────────────────────────────────────────────────────────
window.LEGAL = (function () {
  'use strict';

  const DISCLAIMER_KEY  = 'mc_disclaimer_v1';
  const CONSENT_KEY     = 'mc_consent_v1';
  let   _pendingProvider = null; // 'google' or 'github'

  // ── First-launch disclaimer modal ─────────────────────────────────────────
  function _showDisclaimerModal() {
    if (localStorage.getItem(DISCLAIMER_KEY)) return; // already seen

    const m = document.createElement('div');
    m.id = 'disclaimer-modal';
    m.style.cssText = `position:fixed;inset:0;z-index:19999;background:rgba(0,0,0,.92);
      backdrop-filter:blur(12px);display:flex;align-items:flex-end;justify-content:center;
      font-family:'DM Sans',sans-serif`;

    m.innerHTML = `
      <div style="background:#111;border-radius:24px 24px 0 0;
        padding:24px 20px calc(36px + env(safe-area-inset-bottom));
        width:100%;max-width:480px;border-top:1px solid #222;box-sizing:border-box">

        <div style="display:flex;justify-content:center;margin-bottom:16px">
          <div style="width:36px;height:4px;border-radius:2px;background:#333"></div>
        </div>

        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
          <div style="color:#f97316">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <div style="font-family:'Syne',sans-serif;font-size:16px;font-weight:800;color:#fff">
            About MetroCrowd Data
          </div>
        </div>

        <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:14px;
          padding:14px 16px;margin-bottom:16px;font-size:12px;color:#c0c0c0;line-height:1.7">
          Crowd levels are <strong style="color:#fff">estimates</strong> based on historical patterns
          and community reports. <strong style="color:#fff">Not real-time DMRC data.</strong>
          Conditions may differ significantly. Always use your own judgement when travelling.
          <br><br>
          MetroCrowd is <strong style="color:#fff">not affiliated with DMRC</strong> or any government
          authority. Coach recommendations do not account for real-time platform conditions or
          DMRC operational changes.
        </div>

        <div style="font-size:11px;color:#555;margin-bottom:20px;line-height:1.6;text-align:center">
          By using MetroCrowd you accept these limitations.<br>
          <a href="/legal.html#disclaimer" target="_blank"
            style="color:#888">Full disclaimer</a> ·
          <a href="/legal.html#privacy" target="_blank"
            style="color:#888">Privacy Policy</a>
        </div>

        <button onclick="LEGAL.dismissDisclaimer()"
          style="width:100%;height:48px;background:#FFD000;border:none;border-radius:14px;
          font-family:'Syne',sans-serif;font-size:14px;font-weight:800;color:#000;cursor:pointer">
          I Understand
        </button>
      </div>`;

    document.body.appendChild(m);
  }

  function dismissDisclaimer() {
    localStorage.setItem(DISCLAIMER_KEY, Date.now());
    document.getElementById('disclaimer-modal')?.remove();
  }

  // ── Consent gate ──────────────────────────────────────────────────────────
  // Called directly by the sign-in buttons in HTML
  function trySignIn(provider) {
    const existing = _loadConsent();
    if (existing?.c1) {
      // Already consented — go straight to OAuth
      if (provider === 'google') AUTH.signInGoogle();
      else AUTH.signInGitHub();
      return;
    }
    // First time — show consent step, remember which provider
    _pendingProvider = provider;
    _showConsentStep();
  }

  function _showConsentStep() {
    // Hide sign-in buttons, show consent block
    const google   = document.getElementById('lg-google');
    const github   = document.getElementById('lg-github');
    const consent  = document.getElementById('lg-consent');
    const footer   = document.getElementById('lg-footer');
    if (google)  google.style.display  = 'none';
    if (github)  github.style.display  = 'none';
    if (consent) consent.style.display = 'block';
    if (footer)  footer.style.display  = 'none';

    // Wire Consent 1 checkbox → enable/disable Continue button
    const c1  = document.getElementById('lg-c1');
    const btn = document.getElementById('lg-consent-btn');
    const lbl = document.getElementById('lg-c1-label');

    if (c1 && btn) {
      const _update = () => {
        const ok = c1.checked;
        btn.disabled = !ok;
        btn.style.background = ok ? '#FFD000' : '#333';
        btn.style.color      = ok ? '#000'    : '#666';
        btn.style.cursor     = ok ? 'pointer' : 'not-allowed';
        if (lbl) lbl.style.borderColor = ok ? '#FFD000' : '#ef444433';
      };
      c1.addEventListener('change', _update);
      _update();
    }
  }

  function cancelConsent() {
    _pendingProvider = null;
    const google  = document.getElementById('lg-google');
    const github  = document.getElementById('lg-github');
    const consent = document.getElementById('lg-consent');
    const footer  = document.getElementById('lg-footer');
    if (google)  google.style.display  = 'flex';
    if (github)  github.style.display  = 'flex';
    if (consent) consent.style.display = 'none';
    if (footer)  footer.style.display  = 'block';
  }

  function proceedAfterConsent() {
    const c1 = document.getElementById('lg-c1')?.checked;
    if (!c1) { if(typeof NAV!=='undefined') NAV.showToast('warn','Please accept the required terms first'); return; }

    const c2 = document.getElementById('lg-c2')?.checked || false;
    const c3 = document.getElementById('lg-c3')?.checked || false;

    _saveConsent({ c1: true, c2, c3, ts: Date.now(), version: '1.0' });

    const provider = _pendingProvider;
    _pendingProvider = null;
    cancelConsent();

    // Fire OAuth after a brief tick so UI updates first
    setTimeout(() => {
      if (provider === 'google') AUTH.signInGoogle();
      else if (provider === 'github') AUTH.signInGitHub();
    }, 50);
  }

  // ── Persist consent to Supabase after login ───────────────────────────────
  async function syncConsentToSupabase(userId) {
    const consent = _loadConsent();
    if (!consent?.c1) return;
    try {
      await window.SB?.client
        ?.from('consent_logs')
        .upsert({
          user_id:      userId,
          consent_type: 'privacy_terms',
          consented_at: new Date(consent.ts).toISOString(),
          app_version:  '1.0',
          c2_push:      consent.c2,
          c3_analytics: consent.c3,
        }, { onConflict: 'user_id,consent_type' });
    } catch (e) {
      console.warn('[LEGAL] consent sync failed:', e);
    }
  }

  function _saveConsent(obj) {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(obj));
  }
  function _loadConsent() {
    try { return JSON.parse(localStorage.getItem(CONSENT_KEY)); }
    catch { return null; }
  }
  function hasConsent(type) {
    const c = _loadConsent();
    if (type === 'push')      return c?.c2 || false;
    if (type === 'analytics') return c?.c3 || false;
    return c?.c1 || false;
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    // Show disclaimer modal on first ever launch (before login gate is dismissed)
    // Small delay so the app paints first
    setTimeout(_showDisclaimerModal, 600);
  }

  return {
    init, dismissDisclaimer,
    trySignIn, proceedAfterConsent, cancelConsent,
    syncConsentToSupabase, hasConsent,
  };
})();
