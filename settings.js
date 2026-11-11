// ══════════════════════════════════════════════════════════════════
//  settings.js — Theme + Language (Hindi/English)
//  window.SETTINGS exposed globally
//  window.T(key) — short alias for SETTINGS.t(key)
// ══════════════════════════════════════════════════════════════════
window.SETTINGS = (function () {
  'use strict';

  // ── THEME ─────────────────────────────────────────────────────
  const THEMES = ['dark','system','light'];
  let _theme = localStorage.getItem('mc_theme') || 'dark';

  const DARK_VARS  = '--bg:#07080B;--blk:#07080B;--s0:#0D0F13;--s1:#121419;--s2:#1A1D24;--card:#121419;--card2:#1A1D24;--brd:rgba(255,255,255,0.07);--brd2:rgba(255,255,255,0.12);--brd3:rgba(255,255,255,0.18);--txt:#F3F4F6;--txt2:rgba(243,244,246,0.78);--sub:rgba(243,244,246,0.58);--dim:rgba(243,244,246,0.26);--muted:rgba(243,244,246,0.5);--border:rgba(255,255,255,0.07);--text:#F3F4F6;--bg2:#121419;--bg3:#1A1D24;--y:#FFC629;--y-ink:#FFC629;--y-dim:rgba(255,198,41,0.10);--y-glow:rgba(255,198,41,0.18);--y-brd:rgba(255,198,41,0.28);--low:#FFC629;--pk:#FF5C5C;--a2:#FFC629;--glass:rgba(13,15,19,0.78);--shadow-card:0 1px 0 rgba(255,255,255,0.04) inset,0 8px 24px rgba(0,0,0,0.35);';
  const LIGHT_VARS = '--bg:#F3F4F6;--blk:#F3F4F6;--s0:#FFFFFF;--s1:#FFFFFF;--s2:#EEF0F3;--card:#FFFFFF;--card2:#EEF0F3;--brd:rgba(15,17,21,0.08);--brd2:rgba(15,17,21,0.14);--brd3:rgba(15,17,21,0.22);--txt:#0F1115;--txt2:rgba(15,17,21,0.78);--sub:rgba(15,17,21,0.6);--dim:rgba(15,17,21,0.28);--muted:rgba(15,17,21,0.5);--border:rgba(15,17,21,0.08);--text:#0F1115;--bg2:#FFFFFF;--bg3:#EEF0F3;--y:#FFB800;--y-ink:#9A6B00;--y-dim:rgba(255,184,0,0.14);--y-glow:rgba(255,184,0,0.22);--y-brd:rgba(200,140,0,0.35);--low:#1a9e4a;--pk:#e53935;--a2:#9A6B00;--glass:rgba(255,255,255,0.82);--shadow-card:0 1px 2px rgba(15,17,21,0.05),0 8px 24px rgba(15,17,21,0.06);';

  function _applyTheme(t) {
    const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme:dark)').matches);
    let s = document.getElementById('_theme_vars');
    if (!s) { s = document.createElement('style'); s.id = '_theme_vars'; document.head.appendChild(s); }
    s.textContent = ':root{' + (dark ? DARK_VARS : LIGHT_VARS) + '}';
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    document.body.style.background = dark ? '#07080B' : '#F3F4F6';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#07080B' : '#F3F4F6');
    INK.setActive(!dark);
  }

  // ── LIGHT-THEME CONTRAST GUARD ────────────────────────────────
  // Crowd/line accents (#FFD600, #00E676, #4ade80…) are tuned for dark
  // surfaces and set inline across many modules. On light surfaces they
  // wash out, so in light theme any text whose colour fails contrast
  // against the light surface behind it is darkened (same hue) until it
  // reads clearly. Originals are restored when switching back to dark.
  const INK = (function () {
    let active = false, obs = null, queued = false;
    const ORIG = 'inkOrig', SET = 'inkSet';
    function parse(c) {
      const m = c && c.match(/rgba?\(([^)]+)\)/); if (!m) return null;
      const p = m[1].split(',').map(parseFloat);
      return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
    }
    function lum(c) {
      const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    }
    function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
    function mix(t, b) { const a = t.a; return { r: t.r*a + b.r*(1-a), g: t.g*a + b.g*(1-a), b: t.b*a + b.b*(1-a), a: 1 }; }
    function surface(el) {
      const stack = [];
      for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
        const cs = getComputedStyle(e);
        let c = parse(cs.backgroundColor);
        if ((!c || c.a === 0) && cs.backgroundImage.indexOf('gradient') > -1) c = parse((cs.backgroundImage.match(/rgba?\([^)]+\)/) || [])[0]);
        if (c && c.a > 0) { stack.push(c); if (c.a >= 0.99) break; }
      }
      let r = { r: 243, g: 244, b: 246, a: 1 };
      for (let i = stack.length - 1; i >= 0; i--) r = mix(stack[i], r);
      return r;
    }
    function darken(c, bg) {
      // Scale toward black (keeps hue) until 4.5:1 against the surface.
      for (let k = 1; k > 0.05; k -= 0.04) {
        const d = { r: c.r * k, g: c.g * k, b: c.b * k, a: 1 };
        if (ratio(d, bg) >= 4.5) return d;
      }
      return { r: 15, g: 17, b: 21, a: 1 };
    }
    function fix(el) {
      if (!el.firstChild || el.closest('svg')) return;
      let hasText = false;
      for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && n.nodeValue.trim()) { hasText = true; break; }
      if (!hasText) return;
      // Someone changed the colour since we last fixed it: treat as new original.
      if (el.dataset[SET] && el.style.color !== el.dataset[SET]) { el.dataset[ORIG] = el.style.color; delete el.dataset[SET]; }
      const fg = parse(getComputedStyle(el).color); if (!fg || fg.a < 0.5) return;
      const bg = surface(el);
      if (lum(bg) < 0.45) return;                 // dark surface: leave as is
      if (ratio(mix(fg, bg), bg) >= 3.2) return;  // already readable
      if (!(ORIG in el.dataset)) el.dataset[ORIG] = el.style.color;
      const d = darken(fg, bg);
      el.style.color = 'rgb(' + Math.round(d.r) + ', ' + Math.round(d.g) + ', ' + Math.round(d.b) + ')';
      el.dataset[SET] = el.style.color;
    }
    function scan() {
      queued = false;
      if (!active) return;
      const all = document.body.getElementsByTagName('*');
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
        fix(el);
      }
    }
    function queue() { if (!queued) { queued = true; setTimeout(scan, 120); } }
    function restore() {
      document.querySelectorAll('[data-ink-orig]').forEach(el => {
        el.style.color = el.dataset[ORIG] || '';
        delete el.dataset[ORIG]; delete el.dataset[SET];
      });
    }
    function setActive(on) {
      active = on;
      if (!document.body) { document.addEventListener('DOMContentLoaded', () => setActive(active)); return; }
      if (on) {
        if (!obs) {
          obs = new MutationObserver(queue);
          obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class'] });
        }
        queue();
      } else {
        if (obs) { obs.disconnect(); obs = null; }
        restore();
      }
    }
    return { setActive, scan };
  })();
  function setTheme(t) { _theme=t; localStorage.setItem('mc_theme',t); _applyTheme(t); _updateThemeBtn(); }
  function cycleTheme() { setTheme(THEMES[(THEMES.indexOf(_theme)+1)%THEMES.length]); }
  function _themeIcon(t) {
    if (t==='light') return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
    if (t==='system') return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
    return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>';
  }
  function _updateThemeBtn() {
    var b = document.getElementById('settings-theme-btn'); if (!b) return;
    b.innerHTML = _themeIcon(_theme);
    b.title = {dark:'Dark mode',system:'System theme',light:'Light mode'}[_theme];
  }

  // ── LANGUAGE ─────────────────────────────────────────────────
  let _lang = localStorage.getItem('mc_lang') || 'en';

  const S = {
    en: {
      // Greeting
      good_morning:'Good Morning', good_afternoon:'Good Afternoon',
      good_evening:'Good Evening', good_night:'Good Night',
      // Bottom nav
      nav_home:'Home', nav_station:'Station', nav_coach:'Coach',
      nav_route:'Route', nav_report:'Report',
      // Home screen
      live:'LIVE',
      your_route_live:'YOUR ROUTE · LIVE CROWD',
      set_commute:'Set commute',
      origin:'Origin', destination:'Destination',
      tap_to_plan:'Tap to plan route',
      board_now:'Good time to board now',
      moderate_wait:'Moderate — wait may help',
      very_packed:'Very packed — try next train',
      network_crowd:'Network Crowd — Next 4 Hours',
      all_lines:'All Lines', route_planner_link:'Route planner →', two_tap:'2-tap submit', pinned_stations:'Pinned Stations',
      closed:'Closed',
      // Crowd levels
      crowd_closed:'Station Closed', crowd_empty:'Empty',
      crowd_low:'Low Crowd', crowd_moderate:'Moderate Crowd',
      crowd_high:'High Crowd', crowd_packed:'Packed',
      stations_suffix:'st',
      // Quick actions
      check_station:'Check Station', instant_crowd:'Instant crowd lookup',
      report_crowd:'Report Crowd', two_tap_submit:'2-tap submit',
      // Station screen
      instant_lookup:'Instant Crowd Lookup',
      search_station_desc:'Search any Delhi Metro station above\nor tap the GPS button to auto-detect',
      next_4_hours:'Next 4 Hours',
      nearby_buses:'Nearby Buses',
      coach_finder_btn:'Coach Finder',
      plan_route_btn:'Plan Route',
      community_reports:'Community Reports',
      last_2hrs:'Last 2 hrs',
      // Search overlay
      search_placeholder:'Search station…',
      all_stations:'All Stations',
      search_label_station:'Check Station',
      search_label_coach_stn:'Select Station',
      search_label_coach_dest:'Select Destination',
      search_label_from:'Select Origin',
      search_label_to:'Select Destination',
      search_label_report:'Select Station',
      search_label_home:'Set Home Station',
      // Coach screen
      coach_finder:'Coach Finder',
      coach_sub:'Least crowded coach · fastest exit',
      coach_select_station:'Select station',
      coach_select_line:'Select line',
      coach_time:'Time',
      coach_empty_title:'Pick a station & line',
      coach_empty_sub:'We\'ll show which coach to board based on real gate positions and crowd patterns',
      coach_ladies:'Ladies only',
      coach_front:'← FRONT', coach_rear:'REAR →',
      coach_best:'Best', coach_good:'Good',
      coach_board_here:'BOARD HERE',
      coach_next_at:'Next at',
      coach_metro_closed:'Metro Closed',
      coach_closed_sub:'Metro is not running at this time',
      coach_all_coaches:'All coaches ranked',
      coach_add_dest:'Add destination',
      coach_dest_sub:'Get exit-optimised coach for where you\'re going',
      // Route screen
      route_planner_title:'Route Planner',
      route_planner_sub:'Crowd-aware · least-packed path',
      from_label:'From', to_label:'To',
      select_origin:'Select origin', select_destination:'Select destination',
      avoid_packed:'Avoid packed', fastest:'Fastest', fewest_stops:'Fewest stops',
      find_route:'Find Smartest Route',
      crowd_colon:'Crowd:',
      pick_both:'Pick both stations first',
      station_by_station:'Station by Station',
      route_summary:'Journey Summary',
      stops:'Stops', est_time:'Est. Time', avg_crowd:'Avg Crowd',
      changes:'Changes', token:'Token', smart_card:'Smart Card',
      fare:'Fare',
      // Report screen
      report_title:'Report Crowd',
      report_sub:'Your reports power the AI for 3M+ commuters',
      your_impact:'Your impact this week',
      reports_submitted:'Reports submitted',
      select_your_station:'Select your station',
      crowd_level_lbl:'Crowd level',
      empty_label:'Empty', moderate_label:'Moderate',
      crowded_label:'Crowded', packed_label:'Packed',
      seats_available:'Seats available',
      some_people:'Some people, comfortable',
      standing_room:'Standing room only',
      skip_next:'Skip — next train',
      add_note:'Add a note (optional)',
      note_placeholder:'Signal delay? Event crowd? Anything unusual…',
      submit_report:'Submit Report',
      report_success:'Report submitted!',
      report_success_sub:'Your data helps other commuters',
      karma_earned:'+1 ★ Karma · Total:',
      recent_reports:'Recent Network Reports',
      no_reports:'No reports in last 2 hours.',
      connect_to_see:'Connect to see community reports.',
      could_not_load:'Could not load reports.',
      just_now:'just now',
      sec_ago:'s ago', min_ago:' min ago', hr_ago:'h ago',
      // Auth
      sign_in:'Sign In', sign_out:'Sign Out',
      delete_account:'Delete Account & All Data',
      reports_stat:'REPORTS', member_since:'MEMBER SINCE',
      how_to_use:'How to Use MetroCrowd',
      // Login gate
      login_headline:'Real-time crowd data\nfor every Delhi Metro station',
      login_sub:'Sign in to report crowds, sync across devices, and get personalised alerts',
      continue_google:'Continue with Google',
      continue_github:'Continue with GitHub',
      login_footer:'Your reports help 3M+ daily commuters\nNo spam · No ads ·',
      // Morning/evening commute
      start_navigation:'Start Live Navigation',
      stop_navigation:'Stop Navigation',
      nav_started:'Navigation started — GPS tracking active',
      nav_ended:'Navigation ended',
      nav_arrived:'You have arrived!',
      you_are_at:'You are at',
      next_stop:'Next stop',
      stops_left:'stops left',
      est_remaining:'est. remaining',
      // Commute
      morning_commute:'MORNING COMMUTE',
      evening_commute:'EVENING COMMUTE',
      from:'From', to:'To',
      crowd_now:'Crowd now',
      leaving_now:'Leaving Now',
      board:'Board',
    },
    hi: {
      // Greeting
      good_morning:'सुप्रभात', good_afternoon:'नमस्ते',
      good_evening:'शुभ संध्या', good_night:'शुभ रात्रि',
      // Bottom nav
      nav_home:'होम', nav_station:'स्टेशन', nav_coach:'कोच',
      nav_route:'मार्ग', nav_report:'रिपोर्ट',
      // Home screen
      live:'लाइव',
      your_route_live:'आपका मार्ग · लाइव भीड़',
      set_commute:'यात्रा सेट करें',
      origin:'प्रस्थान', destination:'गंतव्य',
      tap_to_plan:'मार्ग योजना बनाएं',
      board_now:'अभी चढ़ने का सही समय',
      moderate_wait:'मध्यम भीड़ — थोड़ा इंतज़ार करें',
      very_packed:'बहुत भीड़ — अगली ट्रेन लें',
      network_crowd:'नेटवर्क भीड़ — अगले 4 घंटे',
      all_lines:'सभी लाइनें', route_planner_link:'मार्ग योजना →', two_tap:'2-टैप सबमिट', pinned_stations:'पिन किए स्टेशन',
      closed:'बंद',
      // Crowd levels
      crowd_closed:'स्टेशन बंद', crowd_empty:'खाली',
      crowd_low:'कम भीड़', crowd_moderate:'मध्यम भीड़',
      crowd_high:'अधिक भीड़', crowd_packed:'बहुत भीड़',
      stations_suffix:'स्टे.',
      // Quick actions
      check_station:'स्टेशन जांचें', instant_crowd:'तुरंत भीड़ जानकारी',
      report_crowd:'भीड़ रिपोर्ट', two_tap_submit:'2 टैप में सबमिट',
      // Station screen
      instant_lookup:'तुरंत भीड़ जानकारी',
      search_station_desc:'ऊपर कोई दिल्ली मेट्रो स्टेशन खोजें\nया GPS से अपना स्टेशन पता करें',
      next_4_hours:'अगले 4 घंटे',
      nearby_buses:'पास की बसें',
      coach_finder_btn:'कोच फाइंडर',
      plan_route_btn:'मार्ग योजना',
      community_reports:'सामुदायिक रिपोर्ट',
      last_2hrs:'पिछले 2 घंटे',
      // Search overlay
      search_placeholder:'स्टेशन खोजें…',
      all_stations:'सभी स्टेशन',
      search_label_station:'स्टेशन जांचें',
      search_label_coach_stn:'स्टेशन चुनें',
      search_label_coach_dest:'गंतव्य चुनें',
      search_label_from:'प्रस्थान चुनें',
      search_label_to:'गंतव्य चुनें',
      search_label_report:'स्टेशन चुनें',
      search_label_home:'होम स्टेशन सेट करें',
      // Coach screen
      coach_finder:'कोच फाइंडर',
      coach_sub:'सबसे कम भीड़ वाला कोच · तेज़ बाहर निकलें',
      coach_select_station:'स्टेशन चुनें',
      coach_select_line:'लाइन चुनें',
      coach_time:'समय',
      coach_empty_title:'स्टेशन और लाइन चुनें',
      coach_empty_sub:'हम असली गेट पोजिशन और भीड़ के पैटर्न के आधार पर बताएंगे कि किस कोच में चढ़ें',
      coach_ladies:'महिला कोच',
      coach_front:'← आगे', coach_rear:'पीछे →',
      coach_best:'बेस्ट', coach_good:'अच्छा',
      coach_board_here:'यहाँ चढ़ें',
      coach_next_at:'अगली बार',
      coach_metro_closed:'मेट्रो बंद',
      coach_closed_sub:'इस समय मेट्रो नहीं चल रही',
      coach_all_coaches:'सभी कोच रैंकिंग',
      coach_add_dest:'गंतव्य जोड़ें',
      coach_dest_sub:'आप कहाँ जा रहे हैं उसके लिए सही कोच पाएं',
      // Route screen
      route_planner_title:'मार्ग योजनाकार',
      route_planner_sub:'भीड़-जागरूक · कम भीड़ वाला मार्ग',
      from_label:'से', to_label:'तक',
      select_origin:'प्रस्थान चुनें', select_destination:'गंतव्य चुनें',
      avoid_packed:'भीड़ से बचें', fastest:'सबसे तेज़', fewest_stops:'कम स्टॉप',
      find_route:'स्मार्ट मार्ग खोजें',
      crowd_colon:'भीड़:',
      pick_both:'पहले दोनों स्टेशन चुनें',
      station_by_station:'स्टेशन दर स्टेशन',
      route_summary:'यात्रा सारांश',
      stops:'स्टॉप', est_time:'अनुमानित समय', avg_crowd:'औसत भीड़',
      changes:'बदलाव', token:'टोकन', smart_card:'स्मार्ट कार्ड',
      fare:'किराया',
      // Report screen
      report_title:'भीड़ रिपोर्ट',
      report_sub:'आपकी रिपोर्ट 30 लाख यात्रियों की मदद करती है',
      your_impact:'इस सप्ताह आपका योगदान',
      reports_submitted:'सबमिट की गई रिपोर्ट',
      select_your_station:'अपना स्टेशन चुनें',
      crowd_level_lbl:'भीड़ का स्तर',
      empty_label:'खाली', moderate_label:'मध्यम',
      crowded_label:'भीड़', packed_label:'बहुत भीड़',
      seats_available:'सीटें उपलब्ध',
      some_people:'कुछ लोग, आरामदायक',
      standing_room:'केवल खड़े होने की जगह',
      skip_next:'छोड़ें — अगली ट्रेन',
      add_note:'नोट जोड़ें (वैकल्पिक)',
      note_placeholder:'सिग्नल देरी? भीड़ का कारण? कुछ असामान्य…',
      submit_report:'रिपोर्ट सबमिट करें',
      report_success:'रिपोर्ट सबमिट हुई!',
      report_success_sub:'आपका डेटा यात्रियों की मदद करता है',
      karma_earned:'+1 ★ कर्म · कुल:',
      recent_reports:'हाल की नेटवर्क रिपोर्ट',
      no_reports:'पिछले 2 घंटों में कोई रिपोर्ट नहीं।',
      connect_to_see:'सामुदायिक रिपोर्ट देखने के लिए जुड़ें।',
      could_not_load:'रिपोर्ट लोड नहीं हो सकी।',
      just_now:'अभी',
      sec_ago:'सेकंड पहले', min_ago:' मिनट पहले', hr_ago:'घंटे पहले',
      // Auth
      sign_in:'साइन इन', sign_out:'साइन आउट',
      delete_account:'अकाउंट व डेटा हटाएं',
      reports_stat:'रिपोर्ट', member_since:'सदस्यता से',
      how_to_use:'MetroCrowd कैसे उपयोग करें',
      // Login gate
      login_headline:'दिल्ली मेट्रो के हर स्टेशन का\nलाइव भीड़ डेटा',
      login_sub:'भीड़ रिपोर्ट करें, डिवाइस में सिंक करें और व्यक्तिगत अलर्ट पाएं',
      continue_google:'Google से जारी रखें',
      continue_github:'GitHub से जारी रखें',
      login_footer:'आपकी रिपोर्ट 30 लाख यात्रियों की मदद करती है\nकोई स्पैम नहीं · कोई विज्ञापन नहीं ·',
      // Morning/evening commute
      start_navigation:'लाइव नेविगेशन शुरू करें',
      stop_navigation:'नेविगेशन बंद करें',
      nav_started:'नेविगेशन शुरू — GPS ट्रैकिंग चालू',
      nav_ended:'नेविगेशन बंद हो गया',
      nav_arrived:'आप पहुंच गए!',
      you_are_at:'आप यहाँ हैं',
      next_stop:'अगला स्टेशन',
      stops_left:'स्टॉप बचे',
      est_remaining:'अनुमानित समय बचा',
      // Commute
      morning_commute:'सुबह की यात्रा',
      evening_commute:'शाम की यात्रा',
      from:'से', to:'तक',
      crowd_now:'अभी भीड़',
      leaving_now:'अभी चलें',
      board:'चढ़ें',
    }
  };

  function t(key) { return (S[_lang] && S[_lang][key]) || S.en[key] || key; }

  function setLang(lang) {
    _lang = lang;
    localStorage.setItem('mc_lang', lang);
    _applyLang();
    _updateLangBtn();
  }
  function toggleLang() { setLang(_lang === 'en' ? 'hi' : 'en'); }

  function _updateLangBtn() {
    var b = document.getElementById('settings-lang-btn'); if (!b) return;
    b.textContent = _lang === 'en' ? 'हिं' : 'EN';
    b.title = _lang === 'en' ? 'Switch to Hindi' : 'Switch to English';
  }

  // ── Apply language to entire app ─────────────────────────────
  function _applyLang() {
    // 1. Static data-i18n elements
    document.querySelectorAll('[data-i18n]').forEach(function(el) {
      var key = el.getAttribute('data-i18n');
      var val = t(key);
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.placeholder = val;
      else el.textContent = val;
    });

    // 2. Input placeholders with data-i18n-ph
    document.querySelectorAll('[data-i18n-ph]').forEach(function(el) {
      el.placeholder = t(el.getAttribute('data-i18n-ph'));
    });

    // 3. Trigger JS module re-renders
    try { if (typeof HOME_UI !== 'undefined')   HOME_UI.refresh(); }   catch(e) {}
    try { if (typeof REPORT_UI !== 'undefined') REPORT_UI.onTabOpen(); } catch(e) {}
    try { if (typeof COACH_UI !== 'undefined')  COACH_UI.refresh(); }  catch(e) {}
    try { if (typeof ROUTE_UI !== 'undefined')  ROUTE_UI.refresh(); }  catch(e) {}
  }

  // ── Settings pill in status bar ───────────────────────────────
  function _buildPill() {
    var sbarRight = document.getElementById('sbar-right'); if (!sbarRight) return;
    var pill = document.createElement('div');
    pill.style.cssText = 'display:flex;align-items:center;gap:6px';
    pill.innerHTML =
      '<button id="settings-lang-btn" class="top-btn top-btn-txt" onclick="SETTINGS.toggleLang()" aria-label="Switch language">हिं</button>' +
      '<button id="settings-theme-btn" class="top-btn" onclick="SETTINGS.cycleTheme()" aria-label="Change theme"></button>';
    var authBtn = document.getElementById('auth-btn');
    if (authBtn) sbarRight.insertBefore(pill, authBtn);
    else sbarRight.appendChild(pill);
    _updateThemeBtn();
    _updateLangBtn();
  }

  function init() {
    _applyTheme(_theme);
    matchMedia('(prefers-color-scheme:dark)').addEventListener('change', function() {
      if (_theme === 'system') _applyTheme('system');
    });
    _applyLang();
    _buildPill();
  }

  // Global shorthand
  window.T = function(key) { return t(key); };

  return { init, setTheme, cycleTheme, setLang, toggleLang, t, applyLang: _applyLang };
})();
