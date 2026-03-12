// ══════════════════════════════════════════════════════════════════
//  notifprefs.js — Notification Preferences UI
//  Opened from Settings. Lets users toggle each of the 6 notification
//  types, set crowd-drop threshold, quiet hours, peak hours.
//  Syncs to Render API → Supabase notification_prefs table.
// ══════════════════════════════════════════════════════════════════
window.NOTIFPREFS = (function () {
  'use strict';

  const API = 'https://metrocrowd.onrender.com';
  let _screen = null;
  let _prefs  = {};
  let _userId = null;

  const NOTIF_TYPES = [
    {
      key:   'morning_brief',
      emoji: '🌅',
      title: 'Morning Brief',
      desc:  'Daily crowd forecast for your home station at 7:30am',
      ex:    '"Rajiv Chowk · 34% · Good time to board · Leave by 8:15"',
    },
    {
      key:   'beat_the_rush',
      emoji: '⚡',
      title: 'Beat the Rush',
      desc:  '30 minutes before your peak hour every day',
      ex:    '"Rush hits at 9:00 · Leave NOW · Currently 72% Crowded"',
    },
    {
      key:   'crowd_drop',
      emoji: '✅',
      title: 'Crowd Drop Alert',
      desc:  'When your home station drops below your threshold',
      ex:    '"Rajiv Chowk cleared up — 31% · Good window now"',
    },
    {
      key:   'weekly_digest',
      emoji: '📊',
      title: 'Weekly Digest',
      desc:  'Sunday 6pm recap of your trips, time saved & streak',
      ex:    '"8 trips · avg 34min · saved 2.1h · 🔥5d streak"',
    },
    {
      key:   'streak_reminder',
      emoji: '🔥',
      title: 'Streak Reminder',
      desc:  '9pm nudge if you haven\'t logged a trip today',
      ex:    '"Streak at risk · Report crowd to keep it alive"',
    },
    {
      key:   'network_alert',
      emoji: '🚨',
      title: 'Network Alert',
      desc:  'When any metro line gets 5+ packed reports in 10 min',
      ex:    '"Yellow Line packed · Consider alternate route"',
    },
  ];

  async function _getMe() {
    try { const { data } = await SB.client.auth.getUser(); return data?.user || null; }
    catch { return null; }
  }

  async function open() {
    const user = await _getMe();
    if (!user) { NAV.showToast('warn', 'Sign in to manage notifications'); return; }
    _userId = user.id;

    // Load prefs from backend
    try {
      const r = await fetch(`${API}/notifications/prefs?user_id=${_userId}`);
      const j = await r.json();
      _prefs = j.prefs || {};
    } catch { _prefs = {}; }

    // Defaults
    NOTIF_TYPES.forEach(t => {
      if (_prefs[t.key] === undefined) _prefs[t.key] = true;
    });
    if (!_prefs.drop_threshold)    _prefs.drop_threshold    = 45;
    if (!_prefs.quiet_start)       _prefs.quiet_start       = 22;
    if (!_prefs.quiet_end)         _prefs.quiet_end         = 7;
    if (!_prefs.morning_peak_hour) _prefs.morning_peak_hour = 8;
    if (!_prefs.evening_peak_hour) _prefs.evening_peak_hour = 18;

    _build();
  }

  function close() {
    if (!_screen) return;
    _screen.style.transform = 'translateY(100%)';
    setTimeout(() => { _screen?.remove(); _screen = null; }, 320);
  }

  function _build() {
    _screen?.remove();
    _screen = document.createElement('div');
    _screen.id = 'notifprefs-screen';
    _screen.style.cssText = `
      position:fixed;inset:0;z-index:950;background:var(--blk);
      overflow-y:auto;padding-bottom:100px;font-family:'DM Sans',sans-serif;
      transform:translateY(100%);transition:transform .32s cubic-bezier(.22,1,.36,1);
    `;
    _screen.innerHTML = _html();
    document.body.appendChild(_screen);
    requestAnimationFrame(() => { _screen.style.transform = 'translateY(0)'; });
  }

  function _html() {
    const toggleRows = NOTIF_TYPES.map(t => _toggleRow(t)).join('');

    return `
      <div style="max-width:480px;margin:0 auto;padding:20px 16px">

        <!-- Header -->
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;padding-top:8px">
          <button onclick="NOTIFPREFS.close()"
            style="width:36px;height:36px;border-radius:50%;background:var(--card2);
            border:1px solid var(--brd);color:var(--sub);cursor:pointer;
            display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <div>
            <div style="font-family:'Syne',sans-serif;font-size:18px;font-weight:900;
              color:var(--txt)">Notifications</div>
            <div style="font-size:11px;color:var(--sub)">Smart alerts · never spammy</div>
          </div>
          <!-- Test bell -->
          <button onclick="NOTIFPREFS._sendTest()"
            style="margin-left:auto;height:32px;padding:0 12px;background:rgba(255,208,0,.1);
            color:var(--y);border:1px solid rgba(255,208,0,.2);border-radius:20px;
            font-size:11px;font-weight:700;cursor:pointer">
            Test 🔔
          </button>
        </div>

        <!-- Notification toggles -->
        <div style="font-family:'Syne',sans-serif;font-size:10px;font-weight:800;
          color:var(--sub);letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px">
          Alert Types
        </div>
        <div style="background:var(--card);border:1px solid var(--brd);border-radius:18px;
          overflow:hidden;margin-bottom:16px">
          ${toggleRows}
        </div>

        <!-- Crowd drop threshold -->
        <div style="background:var(--card);border:1px solid var(--brd);border-radius:18px;
          padding:16px;margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div>
              <div style="font-size:13px;font-weight:700;color:var(--txt)">Crowd Drop Threshold</div>
              <div style="font-size:11px;color:var(--sub)">Alert me when crowd falls below</div>
            </div>
            <div style="font-family:'Syne',sans-serif;font-size:18px;font-weight:900;
              color:var(--y)" id="threshold-display">${_prefs.drop_threshold}%</div>
          </div>
          <input type="range" id="threshold-slider"
            min="20" max="75" step="5" value="${_prefs.drop_threshold}"
            oninput="NOTIFPREFS._onThreshold(this.value)"
            style="width:100%;accent-color:var(--y);cursor:pointer"/>
          <div style="display:flex;justify-content:space-between;
            font-size:9px;color:var(--sub);margin-top:4px">
            <span>20% Empty</span><span>45% Moderate</span><span>75% Crowded</span>
          </div>
        </div>

        <!-- Peak hours -->
        <div style="background:var(--card);border:1px solid var(--brd);border-radius:18px;
          padding:16px;margin-bottom:12px">
          <div style="font-size:13px;font-weight:700;color:var(--txt);margin-bottom:12px">
            Your Peak Commute Hours
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            ${_hourPicker('morning_peak_hour', '🌅 Morning peak', _prefs.morning_peak_hour, 5, 12)}
            ${_hourPicker('evening_peak_hour', '🌆 Evening peak', _prefs.evening_peak_hour, 14, 22)}
          </div>
          <div style="font-size:10px;color:var(--sub);margin-top:8px">
            "Beat the Rush" alerts fire 30 min before these hours
          </div>
        </div>

        <!-- Quiet hours -->
        <div style="background:var(--card);border:1px solid var(--brd);border-radius:18px;
          padding:16px;margin-bottom:24px">
          <div style="font-size:13px;font-weight:700;color:var(--txt);margin-bottom:12px">
            🌙 Quiet Hours
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            ${_hourPicker('quiet_start', 'Stop at', _prefs.quiet_start, 18, 24)}
            ${_hourPicker('quiet_end',   'Resume at', _prefs.quiet_end, 4, 12)}
          </div>
          <div style="font-size:10px;color:var(--sub);margin-top:8px">
            No notifications between these hours
          </div>
        </div>

        <!-- Save button -->
        <button onclick="NOTIFPREFS._save()"
          style="width:100%;height:50px;background:var(--y);color:#000;border:none;
          border-radius:14px;font-family:'Syne',sans-serif;font-size:14px;font-weight:900;
          cursor:pointer;transition:opacity .2s" id="notif-save-btn">
          Save Preferences
        </button>

      </div>
    `;
  }

  function _toggleRow(t) {
    const enabled = _prefs[t.key] !== false;
    return `
      <div style="padding:14px 16px;border-bottom:1px solid var(--brd);
        display:flex;gap:12px;align-items:flex-start">
        <div style="font-size:22px;flex-shrink:0;line-height:1.2">${t.emoji}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700;color:var(--txt)">${t.title}</div>
          <div style="font-size:11px;color:var(--sub);margin-top:2px">${t.desc}</div>
          <div style="font-size:10px;color:var(--sub);margin-top:3px;
            font-style:italic;opacity:.7">${t.ex}</div>
        </div>
        <!-- Toggle switch -->
        <div onclick="NOTIFPREFS._toggle('${t.key}')"
          id="toggle-${t.key}"
          style="flex-shrink:0;width:42px;height:24px;border-radius:12px;
          background:${enabled ? 'var(--y)' : 'var(--brd2)'};
          position:relative;cursor:pointer;transition:background .2s;margin-top:2px">
          <div style="position:absolute;top:3px;
            left:${enabled ? '21px' : '3px'};width:18px;height:18px;
            border-radius:50%;background:${enabled ? '#000' : 'var(--sub)'};
            transition:left .2s" id="knob-${t.key}"></div>
        </div>
      </div>
    `;
  }

  function _hourPicker(key, label, val, min, max) {
    const options = [];
    for (let h = min; h <= max; h++) {
      const ampm = h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h-12}pm`;
      options.push(`<option value="${h}" ${h === val ? 'selected' : ''}>${ampm}</option>`);
    }
    return `
      <div>
        <div style="font-size:10px;color:var(--sub);margin-bottom:5px">${label}</div>
        <select id="picker-${key}" onchange="NOTIFPREFS._onPicker('${key}',this.value)"
          style="width:100%;height:38px;background:var(--card2);border:1px solid var(--brd);
          border-radius:10px;padding:0 10px;color:var(--txt);font-size:12px;
          font-family:'DM Sans',sans-serif;cursor:pointer">
          ${options.join('')}
        </select>
      </div>
    `;
  }

  // ── Interactions ──────────────────────────────────────────
  function _toggle(key) {
    _prefs[key] = !(_prefs[key] !== false);
    const el    = document.getElementById(`toggle-${key}`);
    const knob  = document.getElementById(`knob-${key}`);
    if (!el || !knob) return;
    const on = _prefs[key];
    el.style.background   = on ? 'var(--y)' : 'var(--brd2)';
    knob.style.left       = on ? '21px' : '3px';
    knob.style.background = on ? '#000' : 'var(--sub)';
  }

  function _onThreshold(val) {
    _prefs.drop_threshold = parseInt(val);
    const el = document.getElementById('threshold-display');
    if (el) el.textContent = val + '%';
  }

  function _onPicker(key, val) {
    _prefs[key] = parseInt(val);
  }

  async function _save() {
    if (!_userId) return;
    const btn = document.getElementById('notif-save-btn');
    if (btn) { btn.textContent = 'Saving…'; btn.style.opacity = '.7'; }

    const homeStation = localStorage.getItem('mc_home') || null;

    try {
      await fetch(`${API}/notifications/prefs`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id:           _userId,
          morning_brief:     _prefs.morning_brief     !== false,
          beat_the_rush:     _prefs.beat_the_rush     !== false,
          crowd_drop:        _prefs.crowd_drop        !== false,
          weekly_digest:     _prefs.weekly_digest     !== false,
          streak_reminder:   _prefs.streak_reminder   !== false,
          network_alert:     _prefs.network_alert     !== false,
          home_station:      homeStation,
          drop_threshold:    _prefs.drop_threshold    || 45,
          quiet_start:       _prefs.quiet_start       || 22,
          quiet_end:         _prefs.quiet_end         || 7,
          morning_peak_hour: _prefs.morning_peak_hour || 8,
          evening_peak_hour: _prefs.evening_peak_hour || 18,
        }),
      });
      NAV.showToast('check', 'Notification preferences saved');
      setTimeout(() => close(), 600);
    } catch {
      NAV.showToast('warn', 'Save failed — try again');
      if (btn) { btn.textContent = 'Save Preferences'; btn.style.opacity = '1'; }
    }
  }

  async function _sendTest() {
    if (!_userId) return;
    NAV.showToast('bell', 'Sending test notification…');
    try {
      await fetch(`${API}/notifications/test`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: _userId, type: 'morning_brief' }),
      });
      NAV.showToast('check', 'Test sent — check your notifications');
    } catch {
      NAV.showToast('warn', 'Test failed — check push permissions');
    }
  }

  return { open, close, _toggle, _onThreshold, _onPicker, _save, _sendTest };
})();
