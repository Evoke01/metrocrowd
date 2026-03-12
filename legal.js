// ─────────────────────────────────────────────────────────────────
//  LEGAL.js — Disclaimer modal + consent logging (non-blocking)
//  Sign-in buttons call LEGAL.trySignIn('google'|'github')
//  which fires AUTH directly — consent is auto-recorded silently.
// ─────────────────────────────────────────────────────────────────
window.LEGAL = (function () {
  'use strict';

  const DISCLAIMER_KEY = 'mc_disclaimer_v1';
  const CONSENT_KEY    = 'mc_consent_v1';

  // ── Consent helpers ───────────────────────────────────────────
  function _saveConsent(obj) {
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify(obj)); } catch(e){}
  }
  function _loadConsent() {
    try { return JSON.parse(localStorage.getItem(CONSENT_KEY)); } catch { return null; }
  }
  function hasConsent(type) {
    const c = _loadConsent();
    if (type === 'push')      return !!(c?.c2);
    if (type === 'analytics') return !!(c?.c3);
    return !!(c?.c1);
  }

  // ── Sign-in entry point (called by HTML buttons) ──────────────
  // Silently records consent then fires OAuth immediately.
  // No blocking gate — user already saw the disclaimer on first launch.
  function trySignIn(provider) {
    // Auto-record implied consent (user clicked sign-in = acceptance)
    if (!_loadConsent()?.c1) {
      _saveConsent({ c1: true, c2: false, c3: false,
                     ts: Date.now(), version: '1.0' });
    }
    _doSignIn(provider);
  }

  function _doSignIn(provider) {
    try {
      if (provider === 'google') {
        if (typeof AUTH !== 'undefined') AUTH.signInGoogle();
        else console.error('[LEGAL] AUTH not loaded');
      } else {
        if (typeof AUTH !== 'undefined') AUTH.signInGitHub();
        else console.error('[LEGAL] AUTH not loaded');
      }
    } catch(e) {
      console.error('[LEGAL] sign-in error:', e);
    }
  }

  // ── First-launch disclaimer (shown once, non-blocking) ────────
  function _showDisclaimerModal() {
    if (localStorage.getItem(DISCLAIMER_KEY)) return;

    const m = document.createElement('div');
    m.id = 'disclaimer-modal';
    m.style.cssText = `position:fixed;inset:0;z-index:19999;
      background:rgba(0,0,0,.85);backdrop-filter:blur(10px);
      display:flex;align-items:flex-end;justify-content:center;
      font-family:'DM Sans',sans-serif`;

    m.innerHTML = `
      <div style="background:#111;border-radius:24px 24px 0 0;
        padding:24px 20px calc(36px + env(safe-area-inset-bottom));
        width:100%;max-width:480px;border-top:1px solid #222;box-sizing:border-box">
        <div style="display:flex;justify-content:center;margin-bottom:16px">
          <div style="width:36px;height:4px;border-radius:2px;background:#333"></div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
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
          Crowd levels are <strong style="color:#fff">estimates</strong> based on historical
          patterns and community reports — <strong style="color:#fff">not real-time DMRC data.</strong>
          Always use your own judgement.<br><br>
          MetroCrowd is <strong style="color:#fff">not affiliated with DMRC</strong>.
        </div>
        <div style="font-size:11px;color:#555;margin-bottom:20px;line-height:1.6;text-align:center">
          By using MetroCrowd you accept these limitations.<br>
          <a href="/legal.html#disclaimer" target="_blank" style="color:#888">Full disclaimer</a> ·
          <a href="/legal.html#privacy"    target="_blank" style="color:#888">Privacy Policy</a>
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

  // ── Sync consent to Supabase after sign-in ────────────────────
  async function syncConsentToSupabase(userId) {
    const consent = _loadConsent();
    if (!consent?.c1) return;
    try {
      await window.SB?.client?.from('consent_logs').upsert({
        user_id:      userId,
        consent_type: 'privacy_terms',
        consented_at: new Date(consent.ts).toISOString(),
        app_version:  '1.0',
        c2_push:      consent.c2,
        c3_analytics: consent.c3,
      }, { onConflict: 'user_id,consent_type' });
    } catch(e) {
      console.warn('[LEGAL] consent sync failed:', e);
    }
  }

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    setTimeout(_showDisclaimerModal, 800);
  }

  return {
    init, dismissDisclaimer,
    trySignIn, syncConsentToSupabase, hasConsent,
  };
})();
