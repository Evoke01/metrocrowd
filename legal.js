// ─────────────────────────────────────────────────────────────────
//  LEGAL.js — Consent gate + first-launch disclaimer
//  Buttons in HTML call: LEGAL.trySignIn('google') / LEGAL.trySignIn('github')
// ─────────────────────────────────────────────────────────────────
window.LEGAL = (function () {
  'use strict';

  const DISCLAIMER_KEY = 'mc_disclaimer_v1';
  const CONSENT_KEY    = 'mc_consent_v1';
  let   _provider      = null; // 'google' | 'github', set when gate opens

  // ── LocalStorage helpers ──────────────────────────────────────
  function _save(obj) {
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify(obj)); } catch(e) {}
  }
  function _load() {
    try { return JSON.parse(localStorage.getItem(CONSENT_KEY)); } catch { return null; }
  }
  function hasConsent(type) {
    const c = _load();
    if (type === 'push')      return !!(c && c.c2);
    if (type === 'analytics') return !!(c && c.c3);
    return !!(c && c.c1);
  }

  // ── Entry point called by HTML sign-in buttons ─────────────────
  function trySignIn(provider) {
    const existing = _load();
    if (existing && existing.c1) {
      // Already consented before — go straight to OAuth
      _fire(provider);
      return;
    }
    // First time — show consent gate
    _provider = provider;
    _showConsentGate();
  }

  // ── Show / hide consent gate UI ───────────────────────────────
  function _showConsentGate() {
    var google  = document.getElementById('lg-google');
    var github  = document.getElementById('lg-github');
    var consent = document.getElementById('lg-consent');
    var footer  = document.getElementById('lg-footer');
    if (google)  google.style.display  = 'none';
    if (github)  github.style.display  = 'none';
    if (consent) consent.style.display = 'block';
    if (footer)  footer.style.display  = 'none';

    // Wire c1 checkbox → enable/disable Continue button
    var c1  = document.getElementById('lg-c1');
    var btn = document.getElementById('lg-consent-btn');
    var lbl = document.getElementById('lg-c1-label');
    if (c1 && btn) {
      function update() {
        var ok = c1.checked;
        btn.disabled          = !ok;
        btn.style.background  = ok ? '#FFD000' : '#333';
        btn.style.color       = ok ? '#000'    : '#666';
        btn.style.cursor      = ok ? 'pointer' : 'not-allowed';
        if (lbl) lbl.style.borderColor = ok ? '#FFD000' : 'rgba(239,68,68,.2)';
      }
      // Remove old listener if any, then add fresh
      c1.onchange = update;
      update();
    }
  }

  function cancelConsent() {
    _provider = null;
    var google  = document.getElementById('lg-google');
    var github  = document.getElementById('lg-github');
    var consent = document.getElementById('lg-consent');
    var footer  = document.getElementById('lg-footer');
    if (google)  google.style.display  = 'flex';
    if (github)  github.style.display  = 'flex';
    if (consent) consent.style.display = 'none';
    if (footer)  footer.style.display  = 'block';
    // Reset checkbox state
    var c1 = document.getElementById('lg-c1');
    var c2 = document.getElementById('lg-c2');
    var c3 = document.getElementById('lg-c3');
    if (c1) c1.checked = false;
    if (c2) c2.checked = false;
    if (c3) c3.checked = false;
    var btn = document.getElementById('lg-consent-btn');
    if (btn) {
      btn.disabled = true;
      btn.style.background = '#333';
      btn.style.color = '#666';
      btn.style.cursor = 'not-allowed';
    }
  }

  // Called by the Continue button
  function proceedAfterConsent() {
    var c1el = document.getElementById('lg-c1');
    if (!c1el || !c1el.checked) {
      alert('Please accept the Privacy Policy and Terms to continue.');
      return;
    }
    var c2 = !!(document.getElementById('lg-c2') && document.getElementById('lg-c2').checked);
    var c3 = !!(document.getElementById('lg-c3') && document.getElementById('lg-c3').checked);
    _save({ c1: true, c2: c2, c3: c3, ts: Date.now(), version: '1.0' });

    var provider = _provider;
    cancelConsent(); // reset UI
    // Fire OAuth after short delay so UI settles
    setTimeout(function() { _fire(provider); }, 80);
  }

  // ── Actually fire OAuth ───────────────────────────────────────
  function _fire(provider) {
    if (typeof AUTH === 'undefined') {
      alert('App not ready yet, please try again.');
      return;
    }
    if (provider === 'google') AUTH.signInGoogle();
    else                       AUTH.signInGitHub();
  }

  // ── Sync consent to Supabase after sign-in ────────────────────
  async function syncConsentToSupabase(userId) {
    var consent = _load();
    if (!consent || !consent.c1) return;
    try {
      if (window.SB && window.SB.client) {
        await window.SB.client.from('consent_logs').upsert({
          user_id:      userId,
          consent_type: 'privacy_terms',
          consented_at: new Date(consent.ts).toISOString(),
          app_version:  '1.0',
          c2_push:      consent.c2,
          c3_analytics: consent.c3,
        }, { onConflict: 'user_id,consent_type' });
      }
    } catch(e) {
      console.warn('[LEGAL] consent sync failed:', e);
    }
  }

  // ── First-launch disclaimer (shown once, non-blocking) ────────
  function _showDisclaimerModal() {
    if (localStorage.getItem(DISCLAIMER_KEY)) return;
    var m = document.createElement('div');
    m.id = 'disclaimer-modal';
    m.style.cssText = 'position:fixed;inset:0;z-index:19999;background:rgba(0,0,0,.88);' +
      'backdrop-filter:blur(10px);display:flex;align-items:flex-end;justify-content:center;' +
      'font-family:\'DM Sans\',sans-serif';
    m.innerHTML =
      '<div style="background:#111;border-radius:24px 24px 0 0;' +
      'padding:24px 20px calc(36px + env(safe-area-inset-bottom));' +
      'width:100%;max-width:480px;border-top:1px solid #222;box-sizing:border-box">' +
      '<div style="display:flex;justify-content:center;margin-bottom:16px">' +
      '<div style="width:36px;height:4px;border-radius:2px;background:#333"></div></div>' +
      '<div style="font-family:\'DM Serif Display\',sans-serif;font-size:16px;font-weight:800;color:#fff;margin-bottom:12px">' +
      '⚠️ About MetroCrowd Data</div>' +
      '<div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:14px;' +
      'padding:14px;margin-bottom:16px;font-size:12px;color:#c0c0c0;line-height:1.7">' +
      'Crowd levels are <strong style="color:#fff">estimates</strong> based on historical patterns ' +
      'and community reports — <strong style="color:#fff">not real-time DMRC data.</strong> ' +
      'Always use your own judgement.<br><br>' +
      'MetroCrowd is <strong style="color:#fff">not affiliated with DMRC</strong> or any government authority.' +
      '</div>' +
      '<div style="font-size:11px;color:#555;margin-bottom:20px;text-align:center;line-height:1.6">' +
      'By using MetroCrowd you accept these limitations.<br>' +
      '<a href="/legal.html#disclaimer" target="_blank" style="color:#888">Full disclaimer</a> · ' +
      '<a href="/legal.html#privacy" target="_blank" style="color:#888">Privacy Policy</a></div>' +
      '<button onclick="LEGAL.dismissDisclaimer()" ' +
      'style="width:100%;height:48px;background:#FFD000;border:none;border-radius:14px;' +
      'font-family:\'DM Serif Display\',sans-serif;font-size:14px;font-weight:800;color:#000;cursor:pointer">' +
      'I Understand</button></div>';
    document.body.appendChild(m);
  }

  function dismissDisclaimer() {
    localStorage.setItem(DISCLAIMER_KEY, Date.now());
    var m = document.getElementById('disclaimer-modal');
    if (m) m.remove();
  }

  function init() {
    setTimeout(_showDisclaimerModal, 800);
  }

  return {
    init, dismissDisclaimer,
    trySignIn, cancelConsent, proceedAfterConsent,
    syncConsentToSupabase, hasConsent,
  };
})();
