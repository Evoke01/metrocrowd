// ══════════════════════════════════════════════════════════════════
//  group.js — Group Travel / Live Location Sharing
//  Let friends share a route and see each other's real-time position
//
//  Flow:
//    Creator:  GROUP.create(result)  → gets 6-char code, shares it
//    Joiner:   GROUP.join(code)      → enters code, sees same route
//    Both:     see each other move through stations live
//    End:      GROUP.leave()         → cleanup
//
//  Uses Supabase Realtime for sub-second position updates.
// ══════════════════════════════════════════════════════════════════
window.GROUP = (function () {
  'use strict';

  const API = 'https://metrocrowd.onrender.com';

  let _code        = null;
  let _session     = null;
  let _members     = {};     // user_id → member object
  let _myId        = null;
  let _myName      = null;
  let _myAvatar    = null;
  let _channel     = null;   // Supabase Realtime channel
  let _panel       = null;
  let _active      = false;
  let _routePath   = [];

  // ── Helpers ──────────────────────────────────────────────────
  async function _getMe() {
    try {
      const { data } = await SB.client.auth.getUser();
      return data?.user || null;
    } catch { return null; }
  }

  async function _post(path, body, timeoutMs = 20000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(API + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!r.ok) {
        let detail = '';
        try {
          const j = await r.json();
          detail = j.detail || j.error || JSON.stringify(j);
        } catch {}
        console.error(`[GROUP] ${path} → HTTP ${r.status}:`, detail);
        return { ok: false, error: detail || `HTTP ${r.status}` };
      }
      return r.json();
    } catch (e) {
      clearTimeout(timer);
      const msg = e.name === 'AbortError' ? 'timeout' : e.message;
      console.error(`[GROUP] ${path} fetch error:`, msg);
      return { ok: false, error: msg };
    }
  }

  // ── Helper: generate 6-char code ─────────────────────────────
  function _genCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({length:6}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  }

  // ── Create a group directly via Supabase (no Render needed) ──
  async function create(routeResult) {
    if (!routeResult?.ok) { NAV.showToast('warn', 'Compute a route first'); return; }
    const user = await _getMe();
    if (!user) { NAV.showToast('warn', 'Sign in to share trips'); return; }

    _myId     = user.id;
    _myName   = user.user_metadata?.full_name || user.email?.split('@')[0] || 'You';
    _myAvatar = user.user_metadata?.avatar_url || null;
    _routePath = routeResult.path || routeResult.hops.map(h => h.id);

    NAV.showToast('info', 'Creating group…');

    try {
      const sb = window.SB?.client;
      if (!sb) throw new Error('Not connected');

      // Generate unique code
      let code = _genCode();
      for (let i = 0; i < 5; i++) {
        const { data } = await sb.from('group_sessions').select('id').eq('id', code);
        if (!data?.length) break;
        code = _genCode();
      }

      const expires = new Date(Date.now() + 3*60*60*1000).toISOString();

      // Insert session
      const { error: e1 } = await sb.from('group_sessions').insert({
        id:           code,
        created_by:   _myId,
        from_station: _routePath[0],
        to_station:   _routePath[_routePath.length - 1],
        route_path:   _routePath,
        expires_at:   expires,
      });
      if (e1) throw new Error(e1.message);

      // Insert self as first member
      const { error: e2 } = await sb.from('group_members').insert({
        session_id:      code,
        user_id:         _myId,
        display_name:    _myName,
        avatar_url:      _myAvatar,
        current_station: _routePath[0],
        station_index:   0,
      });
      if (e2) throw new Error(e2.message);

      const res = { ok: true, code };

      _code    = res.code;
      _session = { from_station: _routePath[0], to_station: _routePath[_routePath.length - 1], route_path: _routePath };
      _active  = true;

      _members[_myId] = {
        user_id: _myId, display_name: _myName, avatar_url: _myAvatar,
        current_station: _routePath[0], station_index: 0,
      };

      _subscribe();
      _buildPanel();
      _render();

      NAV.showToast('check', `Group created: ${_code}`);
      _showShareModal();
    } catch (err) {
      console.error('[GROUP] create error:', err);
      NAV.showToast('warn', `Could not create group: ${err.message}`);
    }
  }

  // ── Join via code (directly via Supabase) ────────────────────
  async function join(code) {
    const user = await _getMe();
    if (!user) { NAV.showToast('warn', 'Sign in to join a group'); return; }

    _myId     = user.id;
    _myName   = user.user_metadata?.full_name || user.email?.split('@')[0] || 'You';
    _myAvatar = user.user_metadata?.avatar_url || null;

    _setJoinLoading(true, 'Joining…');

    try {
      const sb  = window.SB?.client;
      if (!sb) throw new Error('Not connected');
      const KEY = code.toUpperCase();

      // Fetch session
      const { data: sessions, error: e1 } = await sb
        .from('group_sessions').select('*').eq('id', KEY).eq('active', true);
      if (e1) throw new Error(e1.message);
      if (!sessions?.length) throw new Error('Group not found or expired');

      const sess = sessions[0];
      if (sess.expires_at && new Date(sess.expires_at) < new Date())
        throw new Error('Group session has expired');

      // Upsert self as member
      const { error: e2 } = await sb.from('group_members').upsert({
        session_id:      KEY,
        user_id:         _myId,
        display_name:    _myName,
        avatar_url:      _myAvatar,
        current_station: sess.from_station,
        station_index:   0,
        last_seen:       new Date().toISOString(),
      }, { onConflict: 'session_id,user_id' });
      if (e2) throw new Error(e2.message);

      // Load all existing members
      const { data: members } = await sb
        .from('group_members').select('*').eq('session_id', KEY);
      (members || []).forEach(m => { _members[m.user_id] = m; });

      document.getElementById('group-join-modal')?.remove();

      _code      = KEY;
      _session   = sess;
      _routePath = sess.route_path || [];
      _active    = true;

      _subscribe();
      _buildPanel();
      _render();

      NAV.showToast('check', `Joined group ${_code}`);
    } catch (err) {
      console.error('[GROUP] join error:', err);
      _setJoinLoading(false);
      const errEl = document.getElementById('gji-msg');
      if (errEl) errEl.textContent = err.message;
      else NAV.showToast('warn', err.message);
    }
  }

  // ── Push my position (called by TRIPNAV on each station change) ─
  async function updatePosition(stationId, stationIndex) {
    if (!_active || !_code || !_myId) return;

    // Update local state immediately
    if (_members[_myId]) {
      _members[_myId].current_station = stationId;
      _members[_myId].station_index   = stationIndex;
    }
    _render();

    // Push to backend (fire-and-forget)
    try {
      await fetch(`${API}/groups/update-position`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: _code, user_id: _myId,
          current_station: stationId, station_index: stationIndex }),
        keepalive: true,
      });
    } catch {}
  }

  // ── Supabase Realtime subscription ───────────────────────────
  function _subscribe() {
    if (!_code || !window.SB?.client) return;

    _channel = SB.client
      .channel(`group:${_code}`)
      .on('postgres_changes', {
        event:  'UPDATE',
        schema: 'public',
        table:  'group_members',
        filter: `session_id=eq.${_code}`,
      }, payload => {
        const m = payload.new;
        if (m.user_id === _myId) return; // ignore own updates
        _members[m.user_id] = { ..._members[m.user_id], ...m };
        _render();
        // Toast when friend moves to a new station
        const name = m.display_name || 'Friend';
        const stn  = METRO.STATIONS[m.current_station]?.n || m.current_station;
        NAV.showToast('train', `${name} → ${stn}`);
      })
      .subscribe();
  }

  // ── Leave / end ───────────────────────────────────────────────
  async function leave() {
    if (!_active) return;
    _active = false;
    _channel?.unsubscribe();
    _channel = null;
    try {
      await _post('/groups/leave', { code: _code, user_id: _myId });
    } catch {}
    _panel?.remove(); _panel = null;
    _code = null; _session = null; _members = {};
    NAV.showToast('info', 'Left group');
  }

  // ── Share code modal ──────────────────────────────────────────
  function _showShareModal() {
    const existing = document.getElementById('group-share-modal');
    if (existing) existing.remove();

    const fromName = METRO.STATIONS[_routePath[0]]?.n || _routePath[0];
    const toName   = METRO.STATIONS[_routePath[_routePath.length-1]]?.n || _routePath[_routePath.length-1];
    const joinLink = `${location.origin}${location.pathname}?join=${_code}`;
    const canNativeShare = !!navigator.share;

    const modal = document.createElement('div');
    modal.id = 'group-share-modal';
    modal.style.cssText = `
      position:fixed;inset:0;z-index:1100;background:rgba(0,0,0,.75);
      backdrop-filter:blur(4px);
      display:flex;align-items:flex-end;justify-content:center;padding:0;
    `;
    modal.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--brd);
        border-radius:20px 20px 0 0;padding:24px 20px 36px;
        max-width:480px;width:100%;text-align:center;
        animation:slideUp .25s cubic-bezier(.22,1,.36,1)">

        <div style="width:36px;height:3px;background:var(--brd);border-radius:2px;
          margin:0 auto 20px"></div>

        <!-- Route context -->
        <div style="font-size:11px;color:var(--sub);margin-bottom:6px">
          ${fromName} → ${toName}
        </div>

        <!-- Big code display -->
        <div style="font-family:var(--fd);font-size:13px;font-weight:700;
          color:var(--sub);letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px">
          GROUP CODE
        </div>
        <div id="gcode-display" style="font-family:var(--fd);font-size:52px;
          font-weight:900;color:var(--y);letter-spacing:.2em;margin-bottom:4px;
          line-height:1">${_code}</div>
        <div style="font-size:10px;color:var(--sub);margin-bottom:24px">
          Expires in 3 hours · ${Object.keys(_members).length} member${Object.keys(_members).length!==1?'s':''}
        </div>

        <!-- Primary: native share or copy link -->
        ${canNativeShare ? `
        <button onclick="GROUP._nativeShare()"
          style="width:100%;height:48px;background:var(--y);color:#000;border:none;
          border-radius:14px;font-family:var(--fd);font-size:14px;
          font-weight:800;cursor:pointer;margin-bottom:8px;
          display:flex;align-items:center;justify-content:center;gap:8px">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          Share Group Invite
        </button>` : `
        <button onclick="GROUP._copyLink()"
          style="width:100%;height:48px;background:var(--y);color:#000;border:none;
          border-radius:14px;font-family:var(--fd);font-size:14px;
          font-weight:800;cursor:pointer;margin-bottom:8px;
          display:flex;align-items:center;justify-content:center;gap:8px">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
          Copy Invite Link
        </button>`}

        <!-- Secondary: copy just the code -->
        <button onclick="GROUP._copyCode()"
          style="width:100%;height:44px;background:var(--card2);color:var(--txt);
          border:1px solid var(--brd);border-radius:14px;font-size:13px;
          font-weight:700;cursor:pointer;margin-bottom:8px">
          Copy Code Only: ${_code}
        </button>

        <button onclick="document.getElementById('group-share-modal').remove()"
          style="width:100%;height:40px;background:transparent;color:var(--sub);
          border:none;font-size:12px;cursor:pointer">
          Done
        </button>
      </div>
    `;
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
  }

  function _nativeShare() {
    const fromName = METRO.STATIONS[_routePath[0]]?.n || _routePath[0];
    const toName   = METRO.STATIONS[_routePath[_routePath.length-1]]?.n || _routePath[_routePath.length-1];
    const joinLink = `${location.origin}${location.pathname}?join=${_code}`;
    navigator.share({
      title: 'Join my MetroCrowd trip',
      text:  `Track me live: ${fromName} → ${toName}. Code: ${_code}`,
      url:   joinLink,
    }).catch(() => {});
    document.getElementById('group-share-modal')?.remove();
  }

  function _copyLink() {
    const joinLink = `${location.origin}${location.pathname}?join=${_code}`;
    navigator.clipboard?.writeText(joinLink).then(() =>
      NAV.showToast('check', 'Invite link copied'));
    document.getElementById('group-share-modal')?.remove();
  }

  function _copyCode() {
    navigator.clipboard?.writeText(_code).then(() =>
      NAV.showToast('check', `Code ${_code} copied`));
    document.getElementById('group-share-modal')?.remove();
  }

  // ── Join code entry modal ────────────────────────────────────
  function showJoinModal(prefillCode) {
    const existing = document.getElementById('group-join-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'group-join-modal';
    modal.style.cssText = `
      position:fixed;inset:0;z-index:1100;background:rgba(0,0,0,.75);
      backdrop-filter:blur(4px);
      display:flex;align-items:flex-end;justify-content:center;
    `;
    modal.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--brd);
        border-radius:20px 20px 0 0;padding:24px 20px 36px;
        max-width:480px;width:100%;
        animation:slideUp .25s cubic-bezier(.22,1,.36,1)">

        <div style="width:36px;height:3px;background:var(--brd);border-radius:2px;
          margin:0 auto 20px"></div>

        <div style="font-family:var(--fd);font-size:18px;font-weight:900;
          color:var(--txt);margin-bottom:4px">Join a Group Trip</div>
        <div style="font-size:12px;color:var(--sub);margin-bottom:20px">
          Enter or paste the 6-character code from your friend
        </div>

        <!-- Code input — 6 big boxes -->
        <div id="gji-boxes" style="display:flex;gap:8px;justify-content:center;margin-bottom:8px">
          ${[0,1,2,3,4,5].map(i=>`
            <div style="flex:1;max-width:48px;height:56px;background:var(--card2);
              border:2px solid var(--brd);border-radius:12px;
              display:flex;align-items:center;justify-content:center;
              font-family:var(--fd);font-size:22px;font-weight:900;
              color:var(--y);transition:border-color .15s" id="gji-box-${i}">
            </div>`).join('')}
        </div>
        <!-- Hidden real input captures keyboard -->
        <input id="group-code-input" maxlength="6" autocomplete="off"
          autocapitalize="characters" spellcheck="false"
          style="position:absolute;opacity:0;width:1px;height:1px;pointer-events:none"
          oninput="GROUP._onCodeInput(this.value)"
          onkeydown="if(event.key==='Enter')GROUP._submitJoin()"/>

        <!-- Paste from clipboard button -->
        <button id="gji-paste-btn" onclick="GROUP._pasteCode()"
          style="width:100%;height:36px;background:transparent;color:var(--sub);
          border:1px solid var(--brd);border-radius:10px;font-size:11px;
          cursor:pointer;margin-bottom:16px;display:flex;align-items:center;
          justify-content:center;gap:6px">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
          Paste from clipboard
        </button>

        <!-- Error / status message -->
        <div id="gji-msg" style="font-size:11px;color:#ef4444;text-align:center;
          margin-bottom:10px;min-height:16px"></div>

        <!-- Join button -->
        <button id="gji-btn" onclick="GROUP._submitJoin()"
          style="width:100%;height:50px;background:var(--brd);color:var(--sub);border:none;
          border-radius:14px;font-family:var(--fd);font-size:14px;
          font-weight:800;cursor:not-allowed;margin-bottom:8px;
          display:flex;align-items:center;justify-content:center;gap:8px;
          transition:background .2s,color .2s" disabled>
          Join Trip
        </button>
        <button onclick="document.getElementById('group-join-modal').remove()"
          style="width:100%;height:40px;background:transparent;color:var(--sub);
          border:none;font-size:12px;cursor:pointer">
          Cancel
        </button>
      </div>
    `;
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);

    // Focus hidden input to bring up keyboard
    const inp = document.getElementById('group-code-input');
    setTimeout(() => inp?.focus(), 80);

    // Tap anywhere on boxes → focus hidden input
    document.getElementById('gji-boxes')?.addEventListener('click', () => inp?.focus());

    // Prefill if code passed (e.g. from URL param)
    if (prefillCode) {
      inp.value = prefillCode.toUpperCase().slice(0,6);
      GROUP._onCodeInput(inp.value);
    } else {
      // Auto-paste if clipboard has a 6-char code
      navigator.clipboard?.readText?.().then(txt => {
        const clean = txt?.trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
        if (clean?.length === 6) {
          inp.value = clean;
          GROUP._onCodeInput(clean);
          document.getElementById('gji-paste-btn').textContent = `✓ Pasted: ${clean}`;
        }
      }).catch(() => {});
    }
  }

  function _onCodeInput(val) {
    const clean = val.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
    // Update the hidden input to stay in sync
    const inp = document.getElementById('group-code-input');
    if (inp && inp.value !== clean) inp.value = clean;
    // Update box display
    for (let i = 0; i < 6; i++) {
      const box = document.getElementById(`gji-box-${i}`);
      if (!box) continue;
      box.textContent = clean[i] || '';
      box.style.borderColor = clean[i] ? 'var(--y)' : (i === clean.length ? 'rgba(255,208,0,.5)' : 'var(--brd)');
      box.style.background   = clean[i] ? 'rgba(255,208,0,.08)' : 'var(--card2)';
    }
    // Enable/disable join button
    const btn = document.getElementById('gji-btn');
    if (btn) {
      const ready = clean.length === 6;
      btn.disabled = !ready;
      btn.style.background  = ready ? 'var(--y)' : 'var(--brd)';
      btn.style.color       = ready ? '#000' : 'var(--sub)';
      btn.style.cursor      = ready ? 'pointer' : 'not-allowed';
    }
    document.getElementById('gji-msg').textContent = '';
  }

  async function _pasteCode() {
    try {
      const txt = await navigator.clipboard.readText();
      const clean = txt?.trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
      if (!clean) { document.getElementById('gji-msg').textContent = 'Nothing to paste'; return; }
      const inp = document.getElementById('group-code-input');
      if (inp) inp.value = clean;
      GROUP._onCodeInput(clean);
    } catch {
      document.getElementById('gji-msg').textContent = 'Clipboard access denied — type the code';
    }
  }

  function _setJoinLoading(loading, msg) {
    const btn = document.getElementById('gji-btn');
    if (!btn) return;
    if (loading) {
      btn.disabled = true;
      btn.style.background = 'var(--brd)';
      btn.style.color = 'var(--sub)';
      btn.style.cursor = 'not-allowed';
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> ${msg || 'Joining…'}`;
    } else {
      btn.disabled = false;
      btn.style.background = 'var(--y)';
      btn.style.color = '#000';
      btn.style.cursor = 'pointer';
      btn.textContent = 'Join Trip';
    }
  }

  function _submitJoin() {
    const code = document.getElementById('group-code-input')?.value?.trim().toUpperCase();
    if (!code || code.length !== 6) {
      document.getElementById('gji-msg').textContent = 'Enter the full 6-character code';
      return;
    }
    _setJoinLoading(true, 'Joining…');
    join(code);
  }

  // ── Build persistent bottom-left panel ───────────────────────
  function _buildPanel() {
    _panel?.remove();
    _panel = document.createElement('div');
    _panel.id = 'group-panel';
    _panel.style.cssText = `
      position:fixed;bottom:calc(56px + env(safe-area-inset-bottom) + 8px);
      right:12px;z-index:790;
      background:var(--card);border:1px solid var(--brd2);
      border-radius:16px;padding:10px 12px;
      box-shadow:0 4px 20px rgba(0,0,0,.35);
      min-width:180px;max-width:240px;
      font-family:'DM Sans',sans-serif;
    `;
    document.body.appendChild(_panel);
  }

  // ── Render the panel with all members ────────────────────────
  function _render() {
    if (!_panel || !_active) return;

    const total   = _routePath.length - 1;
    const members = Object.values(_members);

    const rows = members.map(m => {
      const isMe    = m.user_id === _myId;
      const stn     = METRO.STATIONS[m.current_station]?.n || m.current_station || '—';
      const idx     = m.station_index || 0;
      const pct     = total > 0 ? Math.round((idx / total) * 100) : 0;
      const initial = (m.display_name || '?')[0].toUpperCase();
      const stopsLeft = total - idx;

      // Distance between me and this person
      let distLabel = '';
      if (!isMe && _members[_myId]) {
        const myIdx = _members[_myId].station_index || 0;
        const diff  = myIdx - idx;
        if (diff > 0)       distLabel = `${diff} stn behind`;
        else if (diff < 0)  distLabel = `${Math.abs(diff)} stn ahead`;
        else                distLabel = 'Same station';
      }

      return `
        <div style="display:flex;align-items:center;gap:8px;
          padding:6px 0;border-bottom:1px solid var(--brd);${isMe ? '' : ''}">
          <!-- Avatar -->
          <div style="width:28px;height:28px;border-radius:50%;flex-shrink:0;
            background:${isMe ? 'var(--y)' : '#6366f1'};
            display:flex;align-items:center;justify-content:center;
            font-size:11px;font-weight:800;color:${isMe ? '#000' : '#fff'}">
            ${m.avatar_url
              ? `<img src="${m.avatar_url}" style="width:28px;height:28px;border-radius:50%;object-fit:cover">`
              : initial}
          </div>
          <!-- Info -->
          <div style="flex:1;min-width:0">
            <div style="font-size:11px;font-weight:700;color:${isMe ? 'var(--y)' : 'var(--txt)'};
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${isMe ? 'You' : m.display_name || 'Friend'}
            </div>
            <div style="font-size:9px;color:var(--sub);white-space:nowrap;
              overflow:hidden;text-overflow:ellipsis">${stn}</div>
            ${distLabel ? `<div style="font-size:9px;color:#6366f1;margin-top:1px">${distLabel}</div>` : ''}
          </div>
          <!-- Progress dot -->
          <div style="width:32px;text-align:right">
            <div style="font-size:9px;font-weight:700;color:var(--sub)">${pct}%</div>
          </div>
        </div>`;
    }).join('');

    _panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;
        margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:6px">
          <div style="width:6px;height:6px;border-radius:50%;background:#6366f1;
            animation:tnavPulse 1.2s ease-in-out infinite"></div>
          <span style="font-family:var(--fd);font-size:10px;font-weight:800;
            color:#6366f1;letter-spacing:.06em">GROUP · ${_code}</span>
        </div>
        <button onclick="GROUP.leave()"
          style="background:rgba(239,68,68,.1);border:none;border-radius:6px;
          padding:2px 7px;font-size:9px;font-weight:700;color:#ef4444;cursor:pointer">
          Leave
        </button>
      </div>
      ${rows}
    `;
  }

  // ── Highlight members on route list ──────────────────────────
  function highlightOnRoute() {
    // Called by TRIPNAV after it renders/updates route hops
    const hops = document.querySelectorAll('.rhop');
    // Clear old group markers
    document.querySelectorAll('.group-member-pin').forEach(e => e.remove());

    Object.values(_members).forEach(m => {
      if (m.user_id === _myId) return;
      const idx = m.station_index || 0;
      const hop = hops[idx];
      if (!hop) return;
      const pin = document.createElement('div');
      pin.className = 'group-member-pin';
      pin.style.cssText = `
        position:absolute;left:-8px;top:50%;transform:translateY(-50%);
        width:18px;height:18px;border-radius:50%;background:#6366f1;
        display:flex;align-items:center;justify-content:center;
        font-size:8px;font-weight:800;color:#fff;z-index:2;
        box-shadow:0 0 0 2px var(--card);
      `;
      pin.textContent = (m.display_name || '?')[0].toUpperCase();
      pin.title = m.display_name;
      hop.style.position = 'relative';
      hop.appendChild(pin);
    });
  }

  // ── Deep link: ?join=CODE auto-opens join modal ──────────────
  function _checkDeepLink() {
    const params = new URLSearchParams(location.search);
    const code   = params.get('join');
    if (code) {
      const url = new URL(location.href);
      url.searchParams.delete('join');
      history.replaceState({}, '', url);
      setTimeout(() => showJoinModal(code.toUpperCase().slice(0,6)), 800);
    }
  }
  setTimeout(_checkDeepLink, 500);

  return {
    create, join, leave, updatePosition,
    showJoinModal, highlightOnRoute,
    _onCodeInput, _pasteCode, _setJoinLoading,
    _copyCode, _copyLink, _nativeShare, _submitJoin,
    get active() { return _active; },
    get code()   { return _code; },
  };
})();
