// Reward points, referrals, and manually reviewed payout requests.
// Points are earned for verified completed commutes, crowd reports and
// qualifying referrals; cash payouts are UPI requests reviewed by an admin.
window.REWARDS = (function () {
  'use strict';

  const API = 'https://metrocrowd.onrender.com/rewards';
  const REF_KEY = 'mc_pending_referral_code';
  const BAL_KEY = 'mc_reward_balance';
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

  function num(n) { return Number(n || 0).toLocaleString('en-IN'); }

  function _signedIn() { return typeof AUTH !== 'undefined' && AUTH.isSignedIn; }

  async function _token() {
    if (typeof SB === 'undefined' || !SB.client) return null;
    const { data } = await SB.client.auth.getSession();
    const s = data?.session;
    if (!s || s.user?.is_anonymous) return null;
    return s.access_token;
  }

  async function _api(path, options = {}, retried = false) {
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
    // A stale access token (e.g. tab left open) — refresh the session once and retry.
    if (response.status === 401 && !retried) {
      try {
        const { data, error } = await SB.client.auth.refreshSession();
        if (!error && data?.session) return _api(path, options, true);
      } catch (e) {}
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || 'Rewards request failed.');
    return body;
  }

  function _toast(icon, msg) {
    if (typeof NAV !== 'undefined' && NAV.showToast) NAV.showToast(icon, msg);
  }

  function _captureReferral() {
    const code = new URLSearchParams(location.search).get('ref');
    if (code && /^[a-z0-9]{4,20}$/i.test(code)) {
      localStorage.setItem(REF_KEY, code.toUpperCase());
    }
  }

  function _setBadge(balance) {
    try { localStorage.setItem(BAL_KEY, String(balance)); } catch (_) {}
    document.querySelectorAll('[data-reward-balance]').forEach(el => {
      el.textContent = num(balance);
    });
  }

  async function onSignedIn() {
    const code = localStorage.getItem(REF_KEY);
    if (code) {
      try {
        await _api('/claim-referral', { method: 'POST', body: JSON.stringify({ code }) });
        localStorage.removeItem(REF_KEY);
      } catch (error) {
        console.warn('[Rewards] referral claim will retry later:', error.message);
      }
    }
    try {
      const data = await _api('/me');
      _setBadge(data.account?.balance_points || 0);
    } catch (_) { /* rewards backend not ready */ }
  }

  // Called after a crowd report is saved. Server enforces caps and cooldowns.
  async function awardReport() {
    if (!_signedIn()) return;
    try {
      const res = await _api('/report', { method: 'POST' });
      if (res.awarded > 0) {
        _toast('star', `+${res.awarded} reward points for your report`);
        const prev = Number(localStorage.getItem(BAL_KEY) || 0);
        _setBadge(prev + res.awarded);
      }
    } catch (_) { /* silent — reporting still worked */ }
  }

  function open() {
    if (!screen) {
      screen = document.createElement('div');
      screen.id = 'rewards-screen';
      screen.className = 'rw-screen';
      screen.setAttribute('role', 'dialog');
      screen.setAttribute('aria-modal', 'true');
      screen.setAttribute('aria-label', 'MetroCrowd Rewards');
      document.body.appendChild(screen);
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && screen.style.display !== 'none') close();
      });
    }
    screen.style.display = 'block';
    requestAnimationFrame(() => screen.classList.add('open'));
    if (_signedIn()) load();
    else screen.innerHTML = _shell(_preview());
  }

  function close() {
    if (!screen) return;
    screen.classList.remove('open');
    setTimeout(() => { screen.style.display = 'none'; }, 200);
  }

  function _shell(content) {
    return `<div class="rw-wrap">
      <div class="rw-head">
        <div>
          <div class="rw-title">Rewards</div>
          <div class="rw-sub">Ride, report, invite — earn points you can cash out via UPI.</div>
        </div>
        <button class="icon-btn" onclick="REWARDS.close()" aria-label="Close rewards">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>${content}</div>`;
  }

  function _ways(s) {
    const rate = Number(s.rupees_per_1000_points || 10);
    const items = [
      ['M3 12h18M7 5l-4 7 4 7M17 5l4 7-4 7', 'Complete a trip', 'Use Trip Navigation and reach your destination', `+${s.commute_points ?? 10}`],
      ['M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7', 'Report crowd levels', `Up to ${s.daily_report_cap ?? 5} rewarded reports a day`, `+${s.report_points ?? 2}`],
      ['M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 7a4 4 0 100 8 4 4 0 000-8zM19 8v6M22 11h-6', 'Invite a friend', 'Credited after their first completed trip', `+${s.referral_points ?? 50}`],
    ];
    return `<div class="rw-card">
      <div class="rw-card-t">How to earn</div>
      ${items.map(([d, t, sub, pts]) => `<div class="rw-way">
        <div class="rw-way-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg></div>
        <div class="rw-way-txt"><div class="rw-way-t">${t}</div><div class="rw-way-s">${sub}</div></div>
        <div class="rw-way-pts">${pts}</div>
      </div>`).join('')}
      <div class="rw-note">1,000 points = ${money(rate * 100)} · minimum payout ${num(s.min_withdrawal_points ?? 1000)} points</div>
    </div>`;
  }

  function _preview() {
    return `<div class="rw-hero">
        <div class="rw-hero-l">Your balance</div>
        <div class="rw-hero-n">0</div>
        <div class="rw-hero-s">Sign in to start earning points on every trip.</div>
      </div>
      ${_ways({})}
      <button class="btn-y" onclick="REWARDS.close();AUTH.openModal()">Sign in to start earning</button>`;
  }

  async function load() {
    if (loading || !screen) return;
    loading = true;
    screen.innerHTML = _shell('<div class="rw-hero rw-skel"><div class="rw-hero-l">Loading rewards…</div><div class="rw-hero-n">—</div></div>');
    try {
      const data = await _api('/me');
      let admin = null;
      try {
        const result = await _api('/admin/payouts?status=pending');
        admin = { pending: result.payouts || [] };
        const approved = await _api('/admin/payouts?status=approved');
        admin.approved = approved.payouts || [];
      } catch (_) { /* regular user */ }
      _setBadge(data.account?.balance_points || 0);
      _render(data, admin);
    } catch (error) {
      screen.innerHTML = _shell(`<div class="rw-card"><div class="rw-note" style="margin:0 0 12px">${esc(error.message)}</div><button class="btn-y" onclick="REWARDS.load()">Retry</button></div>${_ways({})}`);
    } finally { loading = false; }
  }

  function _render(data, admin) {
    const s = data.settings || {};
    const balance = Number(data.account?.balance_points || 0);
    const enabled = !!s.enabled;
    const min = Number(s.min_withdrawal_points || 0);
    const rate = Number(s.rupees_per_1000_points || 0);
    const url = data.referral_url || '';
    const payouts = data.payouts || [];
    const ledger = data.ledger || [];
    const pct = min ? Math.min(100, Math.round(balance / min * 100)) : 0;
    const worth = money(Math.round(balance / 1000 * rate * 100));
    const reasonLabel = { commute: 'Completed trip', referral: 'Friend referral', report: 'Crowd report', payout: 'Payout request', payout_refund: 'Payout refunded', admin_adjustment: 'Adjustment' };

    const userContent = `<div class="rw-hero">
      <div class="rw-hero-l">Available points</div>
      <div class="rw-hero-n">${num(balance)}</div>
      <div class="rw-hero-s">Worth about ${worth}${enabled ? '' : ' · program opening soon'}</div>
      ${min ? `<div class="rw-prog"><div class="rw-prog-f" style="width:${pct}%"></div></div>
      <div class="rw-hero-s">${balance >= min ? 'You can request a payout' : `${num(min - balance)} points to your first payout`}</div>` : ''}
    </div>
    ${!enabled ? `<div class="rw-card rw-note" style="margin-bottom:12px">The rewards program is being set up. Points you earn will appear here once it opens.</div>` : ''}
    ${_ways(s)}
    <div class="rw-card">
      <div class="rw-card-t">Invite a commute buddy</div>
      <div class="rw-note" style="margin:0 0 10px">Your friend signs in and completes their first verified trip — you both ride smarter.</div>
      <div class="rw-row"><input id="reward-ref-url" class="rw-input" readonly value="${esc(url)}" aria-label="Your invite link"><button class="rw-btn-y" onclick="REWARDS.copyInvite()">Copy</button></div>
      ${navigator.share ? `<button class="rw-btn-ghost" onclick="REWARDS.shareInvite()">Share invite</button>` : ''}
    </div>
    ${enabled ? `<div class="rw-card">
      <div class="rw-card-t">Cash out via UPI</div>
      <div class="rw-note" style="margin:0 0 10px">Minimum ${num(min)} points · ${money(rate * 100)} per 1,000 points. Requests are reviewed manually, usually within a few days.</div>
      <label class="rw-lbl" for="reward-payout-points">Points to redeem</label>
      <input id="reward-payout-points" class="rw-input" type="number" inputmode="numeric" min="${min}" max="${balance}" step="1" value="${balance >= min ? balance : ''}">
      <label class="rw-lbl" for="reward-payout-upi">UPI ID</label>
      <input id="reward-payout-upi" class="rw-input" type="text" maxlength="100" placeholder="name@bank" autocomplete="off">
      <div class="rw-note">Your UPI ID is shared only with the MetroCrowd rewards admin to process this payout.</div>
      <button class="${balance < min ? 'rw-btn-ghost' : 'btn-y'}" style="margin-top:10px" onclick="REWARDS.requestPayout()" ${balance < min ? 'disabled' : ''}>${balance < min ? `${num(min - balance)} more points needed` : 'Request payout'}</button>
    </div>` : ''}
    <div class="rw-card">
      <div class="rw-card-t">Payout history</div>
      ${payouts.length ? payouts.map(p => `<div class="rw-li"><span>${num(p.points)} pts · ${money(p.amount_paise)}</span><strong class="rw-st rw-st-${esc(p.status)}">${esc(p.status)}</strong></div>`).join('') : '<div class="rw-note">No payout requests yet.</div>'}
    </div>
    <div class="rw-card">
      <div class="rw-card-t">Points activity</div>
      ${ledger.length ? ledger.map(x => `<div class="rw-li"><span>${esc(reasonLabel[x.reason] || x.reason)}<small>${new Date(x.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</small></span><strong class="${Number(x.points_delta) < 0 ? 'neg' : 'pos'}">${Number(x.points_delta) > 0 ? '+' : ''}${num(x.points_delta)}</strong></div>`).join('') : '<div class="rw-note">No points yet — complete a trip or report a crowd level to start.</div>'}
    </div>`;

    let adminContent = '';
    if (admin) {
      const settingsForm = `<div class="rw-card rw-admin">
        <div class="rw-card-t">Admin · Reward settings</div>
        <div class="rw-note" style="margin:0 0 10px">Review the monthly reward budget and payout terms before enabling.</div>
        <label class="rw-check"><input id="rw-enabled" type="checkbox" ${enabled ? 'checked' : ''}> Enable live earning and payout requests</label>
        ${_adminField('rw-commute', 'Points per verified trip', s.commute_points)}
        ${_adminField('rw-report', 'Points per crowd report', s.report_points ?? 2)}
        ${_adminField('rw-report-cap', 'Rewarded reports per day', s.daily_report_cap ?? 5)}
        ${_adminField('rw-referral', 'Points per qualifying referral', s.referral_points)}
        ${_adminField('rw-min', 'Minimum points per payout', s.min_withdrawal_points)}
        ${_adminField('rw-rate', 'Rupees per 1,000 points', s.rupees_per_1000_points, '0.01')}
        <button class="btn-y" style="margin-top:12px" onclick="REWARDS.saveSettings()">Save settings</button>
      </div>`;
      const pending = [...(admin.pending || []), ...(admin.approved || [])];
      const payoutRows = pending.length ? pending.map(p => `<div class="rw-card">
        <div class="rw-li" style="border:0;padding-top:0"><strong>${money(p.amount_paise)} · ${num(p.points)} pts</strong><span class="rw-st rw-st-${esc(p.status)}">${esc(p.status)}</span></div>
        <div class="rw-note" style="word-break:break-word">User ${esc(p.user_id)} · UPI ${esc(p.upi_id)}</div>
        <div class="rw-row" style="margin-top:10px">
          ${p.status === 'pending' ? `<button class="rw-btn-y" style="flex:1" onclick="REWARDS.resolve('${esc(p.id)}','approve')">Approve</button><button class="rw-btn-danger" style="flex:1" onclick="REWARDS.resolve('${esc(p.id)}','reject')">Reject &amp; refund</button>` : `<button class="rw-btn-y" style="flex:1" onclick="REWARDS.resolve('${esc(p.id)}','paid')">I sent it · Mark paid</button>`}
        </div>
      </div>`).join('') : '<div class="rw-note">No pending payout requests.</div>';
      adminContent = `<div class="rw-admin-wrap">${settingsForm}<div class="rw-card-t" style="margin:4px 0 8px">Admin · Payout queue</div>${payoutRows}</div>`;
    }

    screen.innerHTML = _shell(userContent + adminContent);
  }

  function _adminField(id, label, value, step = '1') {
    return `<label class="rw-lbl" for="${id}">${label}</label><input id="${id}" class="rw-input" type="number" step="${step}" value="${esc(value)}">`;
  }

  async function copyInvite() {
    const input = document.getElementById('reward-ref-url');
    if (!input) return;
    try { await navigator.clipboard.writeText(input.value); }
    catch { input.select(); document.execCommand('copy'); }
    _toast('check', 'Invite link copied');
  }

  async function shareInvite() {
    const url = document.getElementById('reward-ref-url')?.value;
    if (url && navigator.share) {
      try { await navigator.share({ title: 'Join me on MetroCrowd', text: 'Plan your Delhi Metro commute with crowd-aware routes and earn rewards.', url }); }
      catch (error) { if (error.name !== 'AbortError') _toast('warn', 'Could not open sharing'); }
    }
  }

  async function requestPayout() {
    const points = Number(document.getElementById('reward-payout-points')?.value);
    const upi_id = document.getElementById('reward-payout-upi')?.value?.trim();
    if (!points || !upi_id) { _toast('warn', 'Enter points and your UPI ID'); return; }
    if (!/^[a-z0-9._-]{2,256}@[a-z0-9.-]{2,64}$/i.test(upi_id)) { _toast('warn', 'Enter a valid UPI ID, e.g. name@bank'); return; }
    if (!confirm(`Request payout for ${num(points)} points to ${upi_id}?`)) return;
    try {
      await _api('/payouts', { method: 'POST', body: JSON.stringify({ points, upi_id }) });
      _toast('check', 'Payout request sent for review');
      load();
    } catch (error) { _toast('warn', error.message); }
  }

  async function saveSettings() {
    const val = id => Number(document.getElementById(id)?.value);
    const body = {
      enabled: !!document.getElementById('rw-enabled')?.checked,
      commute_points: val('rw-commute'),
      referral_points: val('rw-referral'),
      report_points: val('rw-report'),
      daily_report_cap: val('rw-report-cap'),
      min_withdrawal_points: val('rw-min'),
      rupees_per_1000_points: val('rw-rate'),
    };
    try {
      await _api('/admin/settings', { method: 'PUT', body: JSON.stringify(body) });
      _toast('check', 'Reward settings saved');
      load();
    } catch (error) { _toast('warn', error.message); }
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
      _toast('check', action === 'paid' ? 'Payout marked paid' : `Payout ${action}d`);
      load();
    } catch (error) { _toast('warn', error.message); }
  }

  _captureReferral();
  document.addEventListener('DOMContentLoaded', () => {
    _setBadge(Number(localStorage.getItem(BAL_KEY) || 0));
  });
  return { open, close, load, onSignedIn, awardReport, copyInvite, shareInvite, requestPayout, saveSettings, resolve };
})();
