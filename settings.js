// ══════════════════════════════════════════════════════════════════
//  settings.js — Theme switcher + Hindi/English language toggle
//  Exposes: window.SETTINGS
//  Reads/writes: localStorage keys mc_theme, mc_lang
// ══════════════════════════════════════════════════════════════════
window.SETTINGS = (function () {
  'use strict';

  // ── THEME ─────────────────────────────────────────────────────
  const THEMES = ['dark', 'system', 'light'];
  let _theme = localStorage.getItem('mc_theme') || 'dark';

  const LIGHT_VARS = `
    --blk:#F5F5F5; --card:#FFFFFF; --card2:#EDEDED;
    --brd:rgba(0,0,0,0.08); --brd2:rgba(0,0,0,0.14);
    --txt:#111111; --sub:rgba(0,0,0,0.45); --dim:rgba(0,0,0,0.18);
    --muted:rgba(0,0,0,0.38); --border:rgba(0,0,0,0.08);
    --text:#111111; --bg2:#FFFFFF; --bg3:#EDEDED;
    --low:#1a9e4a; --pk:#e53935; --a2:#b8960a;
  `;
  const DARK_VARS = `
    --blk:#080808; --card:#141414; --card2:#1c1c1c;
    --brd:rgba(255,255,255,0.07); --brd2:rgba(255,255,255,0.13);
    --txt:#EFEFEF; --sub:rgba(255,255,255,0.40); --dim:rgba(255,255,255,0.16);
    --muted:rgba(255,255,255,0.38); --border:rgba(255,255,255,0.07);
    --text:#EFEFEF; --bg2:#141414; --bg3:#1c1c1c;
    --low:#FFD000; --pk:#FF5252; --a2:#FFD000;
  `;

  function _applyTheme(t) {
    const isDark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    let style = document.getElementById('_theme_vars');
    if (!style) {
      style = document.createElement('style');
      style.id = '_theme_vars';
      document.head.appendChild(style);
    }
    style.textContent = `:root { ${isDark ? DARK_VARS : LIGHT_VARS} }`;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    document.body.style.background = isDark ? '#0a0a0a' : '#f0f0f0';
  }

  function setTheme(t) {
    _theme = t;
    localStorage.setItem('mc_theme', t);
    _applyTheme(t);
    _updateThemeBtn();
  }

  function cycleTheme() {
    const next = THEMES[(THEMES.indexOf(_theme) + 1) % THEMES.length];
    setTheme(next);
  }

  function _themeIcon(t) {
    if (t === 'light') return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
    if (t === 'system') return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`;
  }

  function _updateThemeBtn() {
    const btn = document.getElementById('settings-theme-btn');
    if (!btn) return;
    btn.innerHTML = _themeIcon(_theme);
    btn.title = { dark: 'Dark mode', system: 'System theme', light: 'Light mode' }[_theme];
  }

  // ── LANGUAGE ──────────────────────────────────────────────────
  let _lang = localStorage.getItem('mc_lang') || 'en';

  const STRINGS = {
    en: {
      good_morning: 'Good Morning', good_afternoon: 'Good Afternoon',
      good_evening: 'Good Evening', good_night: 'Good Night',
      live: 'LIVE', morning_commute: 'MORNING COMMUTE', evening_commute: 'EVENING COMMUTE',
      crowd_now: 'Crowd now', leaving_now: 'Leaving Now', board: 'Board',
      check_station: 'Check Station', instant_crowd: 'Instant crowd lookup',
      report_crowd: 'Report Crowd', two_tap: '2-tap submit',
      all_lines: 'All Lines', route_planner: 'Route planner →',
      network_crowd: 'NETWORK CROWD — NEXT 4 HOURS',
      station_closed: 'Station Closed', empty: 'Empty', light: 'Light',
      moderate: 'Moderate', crowded: 'Crowded', packed: 'Packed',
      add_destination: 'Add destination', exit_optimised: 'Get exit-optimised coach for where you\'re going',
      all_coaches: 'All coaches ranked', ladies_only: 'Ladies only',
      front: '← FRONT', rear: 'REAR →', best: 'Best', good: 'Good',
      next_at: 'Next at', board_here: 'BOARD HERE',
      home_station: 'HOME STATION', work_dest: 'WORK / DESTINATION',
      save_commute: 'Save Commute', disable_commute: 'Disable Smart Commute',
      smart_commute: 'Smart Commute', or_backup: 'or',
      off_peak: 'Off-Peak', peak: 'Peak', near_exit: 'near exit',
      stops: 'Stops', est_time: 'Est. Time', avg_crowd: 'Avg Crowd',
      changes: 'Changes', token: 'Token', smart_card: 'Smart Card',
      station_by_station: 'Station by Station',
      sign_in: 'Sign in', sign_out: 'Sign Out', delete_account: 'Delete Account & All Data',
      reports: 'REPORTS', member_since: 'MEMBER SINCE',
      how_to_use: 'How to Use MetroCrowd',
    },
    hi: {
      good_morning: 'सुप्रभात', good_afternoon: 'नमस्ते', good_evening: 'शुभ संध्या',
      good_night: 'शुभ रात्रि', live: 'लाइव', morning_commute: 'सुबह की यात्रा',
      evening_commute: 'शाम की यात्रा', crowd_now: 'अभी भीड़',
      leaving_now: 'अभी चलें', board: 'सवार हों',
      check_station: 'स्टेशन जांचें', instant_crowd: 'तुरंत भीड़ जानकारी',
      report_crowd: 'भीड़ रिपोर्ट', two_tap: '2 टैप में सबमिट',
      all_lines: 'सभी लाइनें', route_planner: 'मार्ग योजना →',
      network_crowd: 'नेटवर्क भीड़ — अगले 4 घंटे',
      station_closed: 'स्टेशन बंद', empty: 'खाली', light: 'हल्की',
      moderate: 'मध्यम', crowded: 'भीड़', packed: 'बहुत भीड़',
      add_destination: 'गंतव्य जोड़ें', exit_optimised: 'आपके गंतव्य के लिए सही कोच',
      all_coaches: 'सभी कोच रैंकिंग', ladies_only: 'महिला कोच',
      front: '← आगे', rear: 'पीछे →', best: 'बेस्ट', good: 'अच्छा',
      next_at: 'अगली बार', board_here: 'यहाँ चढ़ें',
      home_station: 'घर का स्टेशन', work_dest: 'कार्यालय / गंतव्य',
      save_commute: 'यात्रा सहेजें', disable_commute: 'स्मार्ट यात्रा बंद करें',
      smart_commute: 'स्मार्ट यात्रा', or_backup: 'या',
      off_peak: 'ऑफ-पीक', peak: 'पीक', near_exit: 'निकास के पास',
      stops: 'स्टॉप', est_time: 'अनुमानित समय', avg_crowd: 'औसत भीड़',
      changes: 'बदलाव', token: 'टोकन', smart_card: 'स्मार्ट कार्ड',
      station_by_station: 'स्टेशन दर स्टेशन',
      sign_in: 'साइन इन', sign_out: 'साइन आउट',
      delete_account: 'अकाउंट व डेटा हटाएं',
      reports: 'रिपोर्ट', member_since: 'सदस्यता से',
      how_to_use: 'MetroCrowd कैसे उपयोग करें',
    }
  };

  function t(key) {
    return STRINGS[_lang]?.[key] || STRINGS.en[key] || key;
  }

  function setLang(lang) {
    _lang = lang;
    localStorage.setItem('mc_lang', lang);
    _applyLang();
    _updateLangBtn();
  }

  function toggleLang() {
    setLang(_lang === 'en' ? 'hi' : 'en');
  }

  function _updateLangBtn() {
    const btn = document.getElementById('settings-lang-btn');
    if (!btn) return;
    btn.textContent = _lang === 'en' ? 'हिं' : 'EN';
    btn.title = _lang === 'en' ? 'Switch to Hindi' : 'Switch to English';
  }

  // Apply language to all data-i18n elements
  function _applyLang() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const val = t(key);
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.placeholder = val;
      else el.textContent = val;
    });
    // Update greeting
    _updateGreeting();
  }

  function _updateGreeting() {
    const el = document.getElementById('home-greeting');
    if (!el) return;
    const h = new Date().getHours();
    const key = h < 12 ? 'good_morning' : h < 17 ? 'good_afternoon' : h < 21 ? 'good_evening' : 'good_night';
    el.textContent = t(key);
  }

  // ── Init ─────────────────────────────────────────────────────
  function init() {
    // Apply saved theme
    _applyTheme(_theme);

    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (_theme === 'system') _applyTheme('system');
    });

    // Apply language
    _applyLang();

    // Build the settings pill in the sbar
    _buildSettingsPill();
  }

  function _buildSettingsPill() {
    // Insert before auth-btn in the sbar-right
    const sbarRight = document.getElementById('sbar-right');
    if (!sbarRight) return;

    const pill = document.createElement('div');
    pill.style.cssText = 'display:flex;align-items:center;gap:4px;';
    pill.innerHTML = `
      <button id="settings-lang-btn" onclick="SETTINGS.toggleLang()"
        title="Switch language"
        style="height:28px;padding:0 9px;border-radius:20px;
          background:var(--card2);border:1px solid var(--brd2);
          font-family:'Syne',sans-serif;font-size:11px;font-weight:800;
          color:var(--sub);cursor:pointer;transition:all .15s;letter-spacing:.02em">
        हिं
      </button>
      <button id="settings-theme-btn" onclick="SETTINGS.cycleTheme()"
        title="Toggle theme"
        style="width:28px;height:28px;border-radius:50%;
          background:var(--card2);border:1px solid var(--brd2);
          display:flex;align-items:center;justify-content:center;
          color:var(--sub);cursor:pointer;transition:all .15s">
      </button>
    `;

    // Insert before auth-btn
    const authBtn = document.getElementById('auth-btn');
    if (authBtn) sbarRight.insertBefore(pill, authBtn);
    else sbarRight.appendChild(pill);

    _updateThemeBtn();
    _updateLangBtn();
  }

  return { init, setTheme, cycleTheme, setLang, toggleLang, t, applyLang: _applyLang };
})();
