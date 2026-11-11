// ─────────────────────────────────────────────────────────────────
//  FEEDBACK.js — rate the app + report bugs
//  FEEDBACK.open('rating' | 'bug'), FEEDBACK.maybePrompt()
//  Submissions go to the API (/feedback); admins review them at /admin.
// ─────────────────────────────────────────────────────────────────
window.FEEDBACK = (function () {
  'use strict';

  const API = 'https://metrocrowd.onrender.com/feedback';
  const VERSION = '2026.11.11';
  const K_VISITS = 'mc_visits', K_RATED = 'mc_rated', K_SNOOZE = 'mc_rate_snooze';
  const LABELS = ['', 'Poor', 'Not great', 'Okay', 'Good', 'Love it!'];
  const STAR = '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z"/></svg>';

  let sheet = null, kind = 'rating', stars = 0, busy = false;

  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function _page() {
    const s = document.querySelector('.screen.active, .screen.on');
    return (s && s.id) || 'home';
  }
  function _device() {
    const n = navigator;
    return `${n.userAgent.slice(0, 220)} | ${innerWidth}x${innerHeight} | ${n.language || ''}`;
  }
  async function _token() {
    try {
      const { data } = await SB.client.auth.getSession();
      const u = data?.session?.user;
      return u && !u.is_anonymous ? data.session.access_token : null;
    } catch (e) { return null; }
  }

  // ── Sheet ──────────────────────────────────────────────────────
  function open(k = 'rating', preset = 0) {
    kind = k === 'bug' ? 'bug' : 'rating';
    stars = preset || 0;
    closePrompt();
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.className = 'fb-overlay';
      sheet.setAttribute('role', 'dialog');
      sheet.setAttribute('aria-modal', 'true');
      sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
      document.body.appendChild(sheet);
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheet?.classList.contains('open')) close(); });
    }
    _render();
    requestAnimationFrame(() => sheet.classList.add('open'));
  }

  function close() { if (sheet) sheet.classList.remove('open'); }

  function _render() {
    const rating = kind === 'rating';
    sheet.innerHTML = `
      <div class="fb-sheet">
        <div class="fb-grab"></div>
        <div class="fb-head">
          <div class="fb-title">${rating ? 'Rate MetroCrowd' : 'Report a bug'}</div>
          <button class="icon-btn fb-x" onclick="FEEDBACK.close()" aria-label="Close">✕</button>
        </div>
        <div class="fb-tabs" role="tablist">
          <button class="fb-tab ${rating ? 'on' : ''}" onclick="FEEDBACK.switchTo('rating')">★ Rate the app</button>
          <button class="fb-tab ${rating ? '' : 'on'}" onclick="FEEDBACK.switchTo('bug')">🐞 Report a bug</button>
        </div>
        ${rating ? `
          <div class="fb-sub">How is your experience so far?</div>
          <div class="fb-stars" role="radiogroup" aria-label="Rating">
            ${[1, 2, 3, 4, 5].map(i => `<button class="fb-star ${i <= stars ? 'on' : ''}" role="radio" aria-checked="${i === stars}" aria-label="${i} star${i > 1 ? 's' : ''}" onclick="FEEDBACK.setStars(${i})">${STAR}</button>`).join('')}
          </div>
          <div class="fb-lbl" id="fb-lbl">${stars ? LABELS[stars] : 'Tap a star'}</div>
          <textarea id="fb-msg" class="fb-input" rows="3" maxlength="2000" placeholder="${stars && stars <= 3 ? 'What should we improve?' : 'Anything you’d like to tell us? (optional)'}"></textarea>
        ` : `
          <div class="fb-sub">Tell us what went wrong and we’ll fix it.</div>
          <textarea id="fb-msg" class="fb-input" rows="5" maxlength="2000" placeholder="What happened? What did you expect? Which station or screen?"></textarea>
          <div class="fb-note">We’ll attach the screen you were on, your device type and app version. No location or personal data.</div>
        `}
        <div class="fb-err" id="fb-err"></div>
        <button class="btn-y fb-send" id="fb-send" onclick="FEEDBACK.submit()" ${rating && !stars ? 'disabled' : ''}>${rating ? 'Submit rating' : 'Send bug report'}</button>
      </div>`;
    setTimeout(() => { const m = document.getElementById('fb-msg'); if (m && !rating) m.focus(); }, 250);
  }

  function switchTo(k) {
    const msg = document.getElementById('fb-msg')?.value || '';
    kind = k; _render();
    const m = document.getElementById('fb-msg'); if (m) m.value = msg;
  }

  function setStars(n) {
    stars = n;
    sheet.querySelectorAll('.fb-star').forEach((b, i) => { b.classList.toggle('on', i < n); b.setAttribute('aria-checked', i + 1 === n); });
    document.getElementById('fb-lbl').textContent = LABELS[n];
    document.getElementById('fb-send').disabled = false;
    const m = document.getElementById('fb-msg');
    if (m) m.placeholder = n <= 3 ? 'What should we improve?' : 'Anything you’d like to tell us? (optional)';
  }

  async function submit() {
    if (busy) return;
    const msg = (document.getElementById('fb-msg')?.value || '').trim();
    const err = document.getElementById('fb-err');
    if (kind === 'rating' && !stars) { err.textContent = 'Pick a star rating first.'; return; }
    if (kind === 'bug' && msg.length < 3) { err.textContent = 'Please describe the problem.'; return; }
    busy = true;
    const btn = document.getElementById('fb-send');
    btn.disabled = true; btn.textContent = 'Sending…'; err.textContent = '';
    try {
      const token = await _token();
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ kind, rating: kind === 'rating' ? stars : null, message: msg || null, page: _page(), device: _device(), app_version: VERSION }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || 'Could not send. Please try again.');
      if (kind === 'rating') ls.set(K_RATED, String(stars));
      _thanks();
    } catch (e) {
      err.textContent = e.message === 'Failed to fetch' ? 'You seem to be offline. Please try again.' : e.message;
      btn.disabled = false; btn.textContent = kind === 'rating' ? 'Submit rating' : 'Send bug report';
    }
    busy = false;
  }

  function _thanks() {
    const rating = kind === 'rating';
    sheet.querySelector('.fb-sheet').innerHTML = `
      <div class="fb-grab"></div>
      <div class="fb-done">
        <div class="fb-done-ic">${rating ? (stars >= 4 ? '💛' : '🙏') : '🛠️'}</div>
        <div class="fb-title">${rating ? 'Thanks for rating!' : 'Bug report sent'}</div>
        <div class="fb-sub">${rating
          ? (stars >= 4 ? 'Glad you like it. Share MetroCrowd with a friend who rides the metro.' : 'Your feedback goes straight to the team. We read every one.')
          : 'Thanks for helping us improve. We’ll look into it soon.'}</div>
        <button class="btn-y fb-send" onclick="FEEDBACK.close()">Done</button>
      </div>`;
  }

  // ── Start-up rating prompt ─────────────────────────────────────
  // Shown from the 2nd visit on, until the user rates. "Not now" snoozes 14 days.
  let promptEl = null;
  function maybePrompt() {
    try {
      if (!sessionStorage.getItem('mc_visit_counted')) {
        sessionStorage.setItem('mc_visit_counted', '1');
        ls.set(K_VISITS, String((parseInt(ls.get(K_VISITS) || '0', 10) || 0) + 1));
      }
    } catch (e) {}
    if (ls.get(K_RATED)) return;
    if ((parseInt(ls.get(K_VISITS) || '0', 10) || 0) < 2) return;
    const snooze = parseInt(ls.get(K_SNOOZE) || '0', 10) || 0;
    if (snooze && Date.now() - snooze < 14 * 864e5) return;

    let tries = 0, calm = 0;
    const timer = setInterval(() => {
      // Wait until nothing else is on screen for 4 seconds in a row.
      calm = _blocked() ? 0 : calm + 1;
      if (calm >= 4) { clearInterval(timer); _showPrompt(); }
      else if (++tries > 180) clearInterval(timer);
    }, 1000);
  }

  function _shown(id) {
    const el = document.getElementById(id); if (!el) return false;
    const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden';
  }
  function _blocked() {
    return _shown('login-gate') || !!document.getElementById('disclaimer-modal') || _shown('ib') || _shown('im') ||
      _shown('auth-modal') || !!document.querySelector('.rw-screen.open, .fb-overlay.open, .overlay.open');
  }

  function _showPrompt() {
    if (promptEl || ls.get(K_RATED)) return;
    promptEl = document.createElement('div');
    promptEl.className = 'fb-prompt';
    promptEl.innerHTML = `
      <div class="fb-prompt-t">Enjoying MetroCrowd?</div>
      <div class="fb-prompt-s">Tap to rate. It takes 5 seconds.</div>
      <div class="fb-stars sm">${[1, 2, 3, 4, 5].map(i => `<button class="fb-star" aria-label="${i} star${i > 1 ? 's' : ''}" onclick="FEEDBACK.open('rating', ${i})">${STAR}</button>`).join('')}</div>
      <div class="fb-prompt-a">
        <button onclick="FEEDBACK.open('bug')">Report a bug</button>
        <button onclick="FEEDBACK.snooze()">Not now</button>
      </div>`;
    document.body.appendChild(promptEl);
    requestAnimationFrame(() => promptEl && promptEl.classList.add('open'));
  }

  function closePrompt() {
    if (!promptEl) return;
    const el = promptEl; promptEl = null;
    el.classList.remove('open');
    setTimeout(() => el.remove(), 300);
  }
  function snooze() { ls.set(K_SNOOZE, String(Date.now())); closePrompt(); }

  document.addEventListener('DOMContentLoaded', () => setTimeout(maybePrompt, 1500));

  return { open, close, switchTo, setStars, submit, maybePrompt, snooze };
})();
