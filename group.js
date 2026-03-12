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
  function _userId()   { try { return SB.client.auth.getUser ? SB.client.auth.getUser().then?.(r=>r?.data?.user?.id) : null; } catch { return null; } }
  function _me()       { try { return SB.client.auth.currentUser; } catch { return null; } }
  async function _getMe() {
    try {
      const { data } = await SB.client.auth.getUser();
      return data?.user || null;
    } catch { return null; }
  }

  async function _post(path, body) {
    const r = await fetch(API + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return r.json();
  }

  // ── Create a group from a computed route ─────────────────────
  async function create(routeResult) {
    if (!routeResult?.ok) { NAV.showToast('warn', 'Compute a route first'); return; }
    const user = await _getMe();
    if (!user) { NAV.showToast('warn', 'Sign in to share trips'); return; }

    _myId     = user.id;
    _myName   = user.user_metadata?.full_name || user.email?.split('@')[0] || 'You';
    _myAvatar = user.user_metadata?.avatar_url || null;
    _routePath = routeResult.path || routeResult.hops.map(h => h.id);

    NAV.showToast('info', 'Creating group…');

    const res = await _post('/groups/create', {
      user_id:      _myId,
      display_name: _myName,
      avatar_url:   _myAvatar,
      from_station: _routePath[0],
      to_station:   _routePath[_routePath.length - 1],
      route_path:   _routePath,
    });

    if (!res.ok) { NAV.showToast('warn', 'Could not create group'); return; }

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
  }

  // ── Join via code ─────────────────────────────────────────────
  async function join(code) {
    const user = await _getMe();
    if (!user) { NAV.showToast('warn', 'Sign in to join a group'); return; }

    _myId     = user.id;
    _myName   = user.user_metadata?.full_name || user.email?.split('@')[0] || 'You';
    _myAvatar = user.user_metadata?.avatar_url || null;

    NAV.showToast('info', 'Joining group…');

    const res = await _post('/groups/join', {
      code, user_id: _myId, display_name: _myName, avatar_url: _myAvatar,
    });

    if (!res.ok) { NAV.showToast('warn', res.detail || 'Group not found'); return; }

    _code    = code.toUpperCase();
    _session = res.session;
    _routePath = res.session.route_path || [];
    _active  = true;

    // Load existing members
    const g = await fetch(`${API}/groups/${_code}`).then(r => r.json());
    if (g.ok) {
      (g.members || []).forEach(m => { _members[m.user_id] = m; });
    }

    _subscribe();
    _buildPanel();
    _render();

    NAV.showToast('check', `Joined group ${_code}`);
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

    const modal = document.createElement('div');
    modal.id = 'group-share-modal';
    modal.style.cssText = `
      position:fixed;inset:0;z-index:1100;background:rgba(0,0,0,.7);
      display:flex;align-items:center;justify-content:center;padding:20px;
    `;
    modal.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--brd);border-radius:20px;
        padding:24px;max-width:320px;width:100%;text-align:center">
        <div style="font-size:11px;color:var(--sub);letter-spacing:.1em;
          text-transform:uppercase;margin-bottom:8px;font-family:'Syne',sans-serif">
          GROUP CODE
        </div>
        <div style="font-family:'Syne',sans-serif;font-size:42px;font-weight:900;
          color:var(--y);letter-spacing:.15em;margin-bottom:4px">${_code}</div>
        <div style="font-size:11px;color:var(--sub);margin-bottom:20px">
          Share this code with friends · expires in 3 hours
        </div>

        <button onclick="GROUP._copyCode()"
          style="width:100%;height:44px;background:var(--y);color:#000;border:none;
          border-radius:12px;font-family:'Syne',sans-serif;font-size:13px;
          font-weight:800;cursor:pointer;margin-bottom:8px">
          Copy Code
        </button>
        <button onclick="document.getElementById('group-share-modal').remove()"
          style="width:100%;height:40px;background:var(--card2);color:var(--sub);
          border:1px solid var(--brd);border-radius:12px;font-size:12px;cursor:pointer">
          Done
        </button>
      </div>
    `;
    document.body.appendChild(modal);
  }

  function _copyCode() {
    navigator.clipboard?.writeText(_code).then(() => {
      NAV.showToast('check', `Code ${_code} copied`);
    });
    document.getElementById('group-share-modal')?.remove();
  }

  // ── Join code entry modal ────────────────────────────────────
  function showJoinModal() {
    const existing = document.getElementById('group-join-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'group-join-modal';
    modal.style.cssText = `
      position:fixed;inset:0;z-index:1100;background:rgba(0,0,0,.7);
      display:flex;align-items:center;justify-content:center;padding:20px;
    `;
    modal.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--brd);border-radius:20px;
        padding:24px;max-width:320px;width:100%">
        <div style="font-family:'Syne',sans-serif;font-size:16px;font-weight:800;
          color:var(--txt);margin-bottom:4px">Join a Group Trip</div>
        <div style="font-size:11px;color:var(--sub);margin-bottom:16px">
          Enter the 6-character code from your friend
        </div>
        <input id="group-code-input" maxlength="6"
          placeholder="Enter code e.g. XK7M2P"
          style="width:100%;height:48px;background:var(--card2);border:1px solid var(--brd);
          border-radius:12px;padding:0 14px;font-family:'Syne',sans-serif;font-size:20px;
          font-weight:800;color:var(--y);text-align:center;letter-spacing:.15em;
          text-transform:uppercase;box-sizing:border-box;margin-bottom:12px"
          oninput="this.value=this.value.toUpperCase()"/>
        <button onclick="GROUP._submitJoin()"
          style="width:100%;height:44px;background:var(--y);color:#000;border:none;
          border-radius:12px;font-family:'Syne',sans-serif;font-size:13px;
          font-weight:800;cursor:pointer;margin-bottom:8px">
          Join Trip
        </button>
        <button onclick="document.getElementById('group-join-modal').remove()"
          style="width:100%;height:40px;background:var(--card2);color:var(--sub);
          border:1px solid var(--brd);border-radius:12px;font-size:12px;cursor:pointer">
          Cancel
        </button>
      </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => document.getElementById('group-code-input')?.focus(), 80);
  }

  function _submitJoin() {
    const code = document.getElementById('group-code-input')?.value?.trim();
    if (!code || code.length !== 6) { NAV.showToast('warn', 'Enter a 6-character code'); return; }
    document.getElementById('group-join-modal')?.remove();
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
          <span style="font-family:'Syne',sans-serif;font-size:10px;font-weight:800;
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

  return {
    create, join, leave, updatePosition,
    showJoinModal, highlightOnRoute,
    _copyCode, _submitJoin,
    get active() { return _active; },
    get code()   { return _code; },
  };
})();
