// Reward points, referrals, and manually reviewed payout requests.
window.REWARDS = (function () {
  'use strict';

  const API = 'https://metrocrowd.onrender.com/rewards';
  const REF_KEY = 'mc_pending_referral_code';
  let screen = null;
  let loading = false;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }

  function money(paise) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })
      .format((Number(paise) || 0) / 100);
  }

  async function _token() {
    const { data } = await SB.client.auth.getSession();
    return data?.session?.access_token || null;
  }

  async function _api(path, options = {}) {
    const token = await _token();
    if (!token) throw new Error('Sign in to use rewards.');
    const response = await fetch(API + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || 'Rewards request failed.');
    return body;
  }

  function _captureReferral() {
    const code = new URLSearchParams(location.search).get('ref');
    if (code && /^[a-z0-9]{4,20}$/i.test(code)) {
      localStorage.setItem(REF_KEY, code.toUpperCase());
    }
  }

  async function onSignedIn() {
    const code = localStorage.getItem(REF_KEY);
    if (code) {
      try {
        const result = await _api('/claim-referral', {
          method: 'POST', body: JSON.stringify({ code }),
        });
        localStorage.removeItem(REF_KEY);
      } catch (error) {
        console.warn('[Rewards] referral claim will retry later:', error.message);
      }
    }
  }

  function open() {
    if (!AUTH?.isSignedIn) {
      NAV.showToast('warn', 'Sign in to view rewards');
      return;
    }
    if (!screen) {
      screen = document.createElement('div');
      screen.id = 'rewards-screen';
      screen.style.cssText = 'position:fixed;inset:0;z-index:1200;background:var(--blk);overflow:auto;padding:16px 14px 36px;font-family:DM Sans,sans-serif;';
      screen.addEventListener('click', event => {
        if (event.target === screen) close();
      });
      document.body.appendChild(screen);
    }
    screen.style.display = 'block';
    load();
  }

  function close() {
    if (screen) screen.style.display = 'none';
  }

  function _shell(content) {
    return `<div style="max-width:480px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin:4px 0 18px">
        <div><div style="font-family:'DM Serif Display',sans-serif;font-size:22px;font-weight:800;color:var(--txt)">MetroCrowd Rewards</div>
        <div style="font-size:11px;color:var(--sub);margin-top:3px">Earn points for useful commute activity</div></div>
        <button onclick="REWARDS.close()" aria-label="Close rewards" style="width:36px;height:36px;border-radius:50%;background:var(--card2);border:1px solid var(--brd);color:var(--txt);font-size:20px;cursor:pointer">×</button>
      </div>${content}</div>`;
  }

  async function load() {
    if (loading || !screen) return;
    loading = true;
    screen.innerHTML = _shell('<div style="padding:28px;text-align:center;color:var(--sub)">Loading rewards…</div>');
    try {
      const data = await _api('/me');
      let admin = null;
      try {
        const result = await _api('/admin/payouts?status=pending');
        admin = { pending: result.payouts || [] };
        const approved = await _api('/admin/payouts?status=approved');
        admin.approved = approved.payouts || [];
      } catch (_) { /* regular user */ }
      _render(data, admin);
    } catch (error) {
      screen.innerHTML = _shell(`<div style="background:var(--card);border:1px solid var(--brd);border-radius:14px;padding:16px;color:var(--sub);font-size:12px;line-height:1.6">${esc(error.message)}<br><button onclick="REWARDS.load()" style="margin-top:12px;padding:9px 12px;border-radius:9px;border:0;background:var(--y);font-weight:700;cursor:pointer">Retry</button></div>`);
    } finally { loading = false; }
  }

  function _render(data, admin) {
    const s = data.settings || {};
    const balance = Number(data.account?.balance_points || 0);
    const enabled = !!s.enabled;
    const perCommute = Number(s.commute_points || 0);
    const referralPoints = Number(s.referral_points || 0);
    const min = Number(s.min_withdrawal_points || 0);
    const rate = Number(s.rupees_per_1000_points || 0);
    const url = data.referral_url || '';
    const payouts = data.payouts || [];
    const ledger = data.ledger || [];

    const userContent = `<div style="background:linear-gradient(135deg,rgba(255,208,0,.15),rgba(255,208,0,.04));border:1px solid rgba(255,208,0,.22);border-radius:18px;padding:18px;margin-bottom:12px">
      <div style="font-size:10px;color:var(--sub);letter-spacing:.08em;text-transform:uppercase">Available points</div>
      <div style="font-family:'DM Serif Display',sans-serif;font-size:42px;font-weight:900;color:var(--y);line-height:1.1;margin:5px 0">${balance.toLocaleString('en-IN')}</div>
      <div style="font-size:11px;color:var(--sub)">${enabled ? `${perCommute} points per verified completed commute · ${referralPoints} points when your invited friend completes their first commute` : 'Rewards are not active yet'}</div>
    </div>
    ${!enabled ? `<div style="background:var(--card);border:1px solid var(--brd);border-radius:12px;padding:12px;margin-bottom:12px;color:var(--sub);font-size:11px;line-height:1.5">The rewards program is being configured. Your balance and payout options will appear here when it opens.</div>` : ''}
    <div style="background:var(--card);border:1px solid var(--brd);border-radius:14px;padding:14px;margin-bottom:12px">
      <div style="font-size:12px;font-weight:800;color:var(--txt);margin-bottom:6px">Invite a commute buddy</div>
      <div style="font-size:10px;color:var(--sub);line-height:1.5;margin-bottom:10px">Your friend needs to sign in and complete their first verified commute before referral points are credited.</div>
      <div style="display:flex;gap:7px"><input id="reward-ref-url" readonly value="${esc(url)}" style="min-width:0;flex:1;background:var(--card2);color:var(--sub);border:1px solid var(--brd);border-radius:9px;padding:9px;font-size:10px"><button onclick="REWARDS.copyInvite()" style="background:var(--y);color:#111;border:0;border-radius:9px;padding:0 12px;font-size:10px;font-weight:800;cursor:pointer">Copy</button></div>
      ${navigator.share ? `<button onclick="REWARDS.shareInvite()" style="width:100%;margin-top:8px;background:var(--card2);color:var(--txt);border:1px solid var(--brd);border-radius:9px;padding:10px;font-size:11px;font-weight:700;cursor:pointer">Share invite</button>` : ''}
    </div>
    ${enabled ? `<div style="background:var(--card);border:1px solid var(--brd);border-radius:14px;padding:14px;margin-bottom:12px">
      <div style="font-size:12px;font-weight:800;color:var(--txt);margin-bottom:5px">Request a payout</div>
      <div style="font-size:10px;color:var(--sub);margin-bottom:10px">Minimum ${min.toLocaleString('en-IN')} points · ${money(rate * 100)} per 1,000 points. Requests are reviewed manually.</div>
      <label style="display:block;font-size:10px;color:var(--sub);margin:8px 0 4px">Points to redeem</label>
      <input id="reward-payout-points" type="number" min="${min}" max="${balance}" step="1" value="${balance >= min ? min : ''}" style="width:100%;box-sizing:border-box;background:var(--card2);color:var(--txt);border:1px solid var(--brd);border-radius:9px;padding:10px;font-size:12px">
      <label style="display:block;font-size:10px;color:var(--sub);margin:8px 0 4px">UPI ID for payout</label>
      <input id="reward-payout-upi" type="text" maxlength="100" placeholder="name@bank" autocomplete="off" style="width:100%;box-sizing:border-box;background:var(--card2);color:var(--txt);border:1px solid var(--brd);border-radius:9px;padding:10px;font-size:12px">
      <div style="font-size:9px;color:var(--sub);line-height:1.4;margin-top:6px">Your UPI ID will be visible to the MetroCrowd rewards admin for processing this request.</div>
      <button onclick="REWARDS.requestPayout()" ${balance < min ? 'disabled' : ''} style="width:100%;margin-top:10px;background:${balance < min ? 'var(--card2)' : 'var(--y)'};color:${balance < min ? 'var(--sub)' : '#111'};border:0;border-radius:9px;padding:11px;font-size:11px;font-weight:800;cursor:${balance < min ? 'not-allowed' : 'pointer'}">${balance < min ? `${(min - balance).toLocaleString('en-IN')} more points needed` : 'Request payout'}</button>
    </div>` : ''}
    <div style="background:var(--card);border:1px solid var(--brd);border-radius:14px;padding:14px;margin-bottom:12px">
      <div style="font-size:12px;font-weight:800;color:var(--txt);margin-bottom:8px">Payout history</div>
      ${payouts.length ? payouts.map(p => `<div style="display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-top:1px solid var(--brd);font-size:10px"><span style="color:var(--sub)">${Number(p.points).toLocaleString('en-IN')} pts · ${money(p.amount_paise)}</span><strong style="color:${p.status === 'paid' ? '#4ade80' : 'var(--y)'}">${esc(p.status.toUpperCase())}</strong></div>`).join('') : '<div style="font-size:10px;color:var(--sub)">No payout requests yet.</div>'}
    </div>
    <div style="background:var(--card);border:1px solid var(--brd);border-radius:14px;padding:14px">
      <div style="font-size:12px;font-weight:800;color:var(--txt);margin-bottom:8px">Points activity</div>
      ${ledger.length ? ledger.map(x => `<div style="display:flex;justify-content:space-between;padding:7px 0;border-top:1px solid var(--brd);font-size:10px"><span style="color:var(--sub)">${esc(x.reason.replaceAll('_', ' '))}</span><strong style="color:${Number(x.points_delta) < 0 ? '#f87171' : '#4ade80'}">${Number(x.points_delta) > 0 ? '+' : ''}${Number(x.points_delta).toLocaleString('en-IN')}</strong></div>`).join('') : '<div style="font-size:10px;color:var(--sub)">No points earned yet.</div>'}
    </div>`;

    let adminContent = '';
    if (admin) {
      const settingsForm = `<div style="background:var(--card);border:1px solid rgba(99,102,241,.35);border-radius:14px;padding:14px;margin-bottom:12px">
        <div style="font-size:13px;font-weight:800;color:var(--txt);margin-bottom:10px">Admin · Reward settings</div>
        <div style="font-size:10px;color:var(--sub);line-height:1.5;margin-bottom:10px">Sample values are prefilled. Review the monthly reward budget and payout terms before enabling.</div>
        <label style="display:flex;gap:8px;align-items:center;font-size:11px;color:var(--txt);margin-bottom:9px"><input id="rw-enabled" type="checkbox" ${enabled ? 'checked' : ''}> Enable live earning and payout requests</label>
        ${_adminField('rw-commute', 'Points per verified commute', s.commute_points)}
        ${_adminField('rw-referral', 'Points per qualifying referral', s.referral_points)}
        ${_adminField('rw-min', 'Minimum points per payout', s.min_withdrawal_points)}
        ${_adminField('rw-rate', 'Rupees per 1,000 points', s.rupees_per_1000_points, '0.01')}
        <button onclick="REWARDS.saveSettings()" style="width:100%;margin-top:10px;background:#6366f1;color:#fff;border:0;border-radius:9px;padding:11px;font-weight:800;cursor:pointer">Save settings</button>
      </div>`;
      const pending = [...(admin.pending || []), ...(admin.approved || [])];
      const payoutRows = pending.length ? pending.map(p => `<div style="background:var(--card);border:1px solid var(--brd);border-radius:12px;padding:12px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;gap:10px"><strong style="font-size:11px;color:var(--txt)">${money(p.amount_paise)} · ${Number(p.points).toLocaleString('en-IN')} pts</strong><span style="font-size:9px;color:var(--y);font-weight:800">${esc(p.status.toUpperCase())}</span></div>
        <div style="font-size:10px;color:var(--sub);margin-top:5px;word-break:break-word">User ${esc(p.user_id)} · UPI ${esc(p.upi_id)}</div>
        <div style="display:flex;gap:6px;margin-top:9px">
          ${p.status === 'pending' ? `<button onclick="REWARDS.resolve('${esc(p.id)}','approve')" style="flex:1;background:#4ade80;color:#111;border:0;border-radius:8px;padding:8px;font-size:10px;font-weight:800;cursor:pointer">Approve</button><button onclick="REWARDS.resolve('${esc(p.id)}','reject')" style="flex:1;background:#ef4444;color:#fff;border:0;border-radius:8px;padding:8px;font-size:10px;font-weight:800;cursor:pointer">Reject &amp; refund</button>` : `<button onclick="REWARDS.resolve('${esc(p.id)}','paid')" style="width:100%;background:var(--y);color:#111;border:0;border-radius:8px;padding:8px;font-size:10px;font-weight:800;cursor:pointer">I sent it · Mark paid</button>`}
        </div>
      </div>`).join('') : '<div style="font-size:10px;color:var(--sub);padding:8px 0">No pending payout requests.</div>';
      adminContent = `<div style="margin-top:18px;border-top:1px solid var(--brd);padding-top:16px">${settingsForm}<div style="font-size:13px;font-weight:800;color:var(--txt);margin-bottom:8px">Admin · Payout queue</div>${payoutRows}</div>`;
    }

    screen.innerHTML = _shell(userContent + adminContent);
  }

  function _adminField(id, label, value, step = '1') {
    return `<label style="display:block;font-size:10px;color:var(--sub);margin:8px 0 4px">${label}</label><input id="${id}" type="number" step="${step}" value="${esc(value)}" style="width:100%;box-sizing:border-box;background:var(--card2);color:var(--txt);border:1px solid var(--brd);border-radius:9px;padding:9px;font-size:11px">`;
  }

  async function copyInvite() {
    const input = document.getElementById('reward-ref-url');
    if (!input) return;
    try { await navigator.clipboard.writeText(input.value); NAV.showToast('check', 'Invite link copied'); }
    catch { input.select(); document.execCommand('copy'); NAV.showToast('check', 'Invite link copied'); }
  }

  async function shareInvite() {
    const url = document.getElementById('reward-ref-url')?.value;
    if (url && navigator.share) {
      try { await navigator.share({ title: 'Join me on MetroCrowd', text: 'Plan your Delhi Metro commute with crowd-aware routes.', url }); }
      catch (error) { if (error.name !== 'AbortError') NAV.showToast('warn', 'Could not open sharing'); }
    }
  }

  async function requestPayout() {
    const points = Number(document.getElementById('reward-payout-points')?.value);
    const upi_id = document.getElementById('reward-payout-upi')?.value?.trim();
    if (!points || !upi_id) { NAV.showToast('warn', 'Enter points and your UPI ID'); return; }
    if (!confirm(`Request payout for ${points.toLocaleString('en-IN')} points?`)) return;
    try {
      await _api('/payouts', { method: 'POST', body: JSON.stringify({ points, upi_id }) });
      NAV.showToast('check', 'Payout request sent for review');
      load();
    } catch (error) { NAV.showToast('warn', error.message); }
  }

  async function saveSettings() {
    const body = {
      enabled: !!document.getElementById('rw-enabled')?.checked,
      commute_points: Number(document.getElementById('rw-commute')?.value),
      referral_points: Number(document.getElementById('rw-referral')?.value),
      min_withdrawal_points: Number(document.getElementById('rw-min')?.value),
      rupees_per_1000_points: Number(document.getElementById('rw-rate')?.value),
    };
    try {
      await _api('/admin/settings', { method: 'PUT', body: JSON.stringify(body) });
      NAV.showToast('check', 'Reward settings saved');
      load();
    } catch (error) { NAV.showToast('warn', error.message); }
  }

  async function resolve(id, action) {
    let payout_reference = null;
    let note = null;
    if (action === 'reject') {
      note = prompt('Reason for rejection (optional):') || null;
      if (!confirm('Reject this request and return the points to the user?')) return;
    } else if (action === 'paid') {
      payout_reference = prompt('Enter the UPI transaction reference after sending payment:');
      if (!payout_reference) return;
      note = 'Paid manually via UPI';
    }
    try {
      await _api(`/admin/payouts/${encodeURIComponent(id)}`, {
        method: 'POST', body: JSON.stringify({ action, note, payout_reference }),
      });
      NAV.showToast('check', action === 'paid' ? 'Payout marked paid' : `Payout ${action}d`);
      load();
    } catch (error) { NAV.showToast('warn', error.message); }
  }

  _captureReferral();
  return { open, close, load, onSignedIn, copyInvite, shareInvite, requestPayout, saveSettings, resolve };
})();
