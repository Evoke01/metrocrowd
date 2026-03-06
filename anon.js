// ══════════════════════════════════════════════════════════════════
//  ANON IDENTITY MODULE
//
//  Gives every anonymous user a stable UUID that:
//  ① Persists in localStorage across tabs, sessions, and browser restarts
//  ② Syncs to Supabase anonymous_users table so reports are queryable
//     from any device that knows the ID
//  ③ Can be exported as a QR code or short link (?aid=<uuid>)
//  ④ Can be imported on a second device to restore all reports
//
//  Reports in crowd_reports.anon_id reference this UUID.
//  This replaces the old sessionStorage-based session_id.
//
//  Privacy model:
//  The UUID is the only "secret". We never collect name, email,
//  device fingerprint, or IP. The ID itself is meaningless without
//  knowing which reports it filed. Sharing the QR = sharing access.
// ══════════════════════════════════════════════════════════════════
window.ANON = (function(){

  const LS_KEY     = 'metro_anon_id';   // localStorage key
  const IMPORT_KEY = 'metro_aid_import_pending'; // temp import flag

  let _aid    = null;  // current anonymous ID
  let _client = null;  // Supabase client (set by init)
  let _onAidChange = null; // callback when ID is set/changed

  // ── UUID v4 generator ─────────────────────────────────────────
  function uuid4(){
    if(crypto?.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random()*16|0;
      return (c==='x' ? r : (r&0x3|0x8)).toString(16);
    });
  }

  // ── Load or create the AID ────────────────────────────────────
  function loadOrCreate(){
    // 1. Check URL param first (import from QR/link)
    const urlParam = new URLSearchParams(window.location.search).get('aid');
    if(urlParam && isValidAid(urlParam)){
      const stored = localStorage.getItem(LS_KEY);
      if(stored && stored !== urlParam){
        // Different ID in URL vs stored — ask user
        localStorage.setItem(IMPORT_KEY, urlParam);
        // Strip ?aid from URL without reload
        const clean = window.location.pathname + window.location.hash;
        window.history.replaceState({}, '', clean);
        console.log('[ANON] Import pending from URL param');
      } else {
        // No conflict — accept silently
        localStorage.setItem(LS_KEY, urlParam);
        const clean = window.location.pathname + window.location.hash;
        window.history.replaceState({}, '', clean);
        console.log('[ANON] ID imported from URL param');
      }
    }

    // 2. Load from localStorage
    let aid = localStorage.getItem(LS_KEY);
    if(!aid || !isValidAid(aid)){
      aid = uuid4();
      localStorage.setItem(LS_KEY, aid);
      console.log('[ANON] New anonymous ID generated');
    } else {
      console.log('[ANON] Existing ID loaded:', aid.slice(0,8)+'…');
    }
    return aid;
  }

  function isValidAid(str){
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
  }

  // ── Upsert this AID in Supabase anonymous_users ───────────────
  async function syncToCloud(aid){
    if(!_client) return;
    try{
      await _client.from('anonymous_users').upsert({
        anon_id:   aid,
        last_seen: new Date().toISOString(),
      }, { onConflict: 'anon_id', ignoreDuplicates: false });
      console.log('[ANON] Cloud sync ok');
    } catch(e){
      console.warn('[ANON] Cloud sync failed:', e.message);
    }
  }

  // ── Import: replace stored AID with a new one ─────────────────
  async function importAid(newAid){
    if(!isValidAid(newAid)){
      showImportError('Invalid sync ID format.');
      return false;
    }
    const old = _aid;
    _aid = newAid;
    localStorage.setItem(LS_KEY, newAid);
    localStorage.removeItem(IMPORT_KEY);
    await syncToCloud(newAid);
    if(_onAidChange) _onAidChange(newAid, old);
    console.log('[ANON] ID imported:', newAid.slice(0,8)+'…');
    return true;
  }

  // ── Share URL ─────────────────────────────────────────────────
  function shareUrl(){
    const base = window.location.origin + window.location.pathname;
    return `${base}?aid=${_aid}`;
  }

  // ── QR code render ────────────────────────────────────────────
  // Uses qrcode.js if available (loaded via CDN in index.html),
  // falls back to a text-based display.
  function renderQR(containerId){
    const el = document.getElementById(containerId);
    if(!el) return;
    el.innerHTML = '';
    const url = shareUrl();
    if(window.QRCode){
      try{
        new QRCode(el, {
          text:         url,
          width:        160,
          height:       160,
          colorDark:    '#FFFFFF',
          colorLight:   '#0D1520',
          correctLevel: QRCode.CorrectLevel.M,
        });
        return;
      }catch(e){ console.warn('[ANON] QR render failed:', e); }
    }
    // Fallback: just show the URL in a monospace box
    el.innerHTML = `<div style="
      font-family:'Space Mono',monospace;font-size:7px;
      word-break:break-all;color:var(--a2);
      background:var(--bg3);padding:10px;border-radius:8px;
      border:1px solid var(--border);line-height:1.5;
    ">${url}</div>`;
  }

  // ── Copy share URL to clipboard ───────────────────────────────
  async function copyLink(){
    const url = shareUrl();
    try{
      await navigator.clipboard.writeText(url);
      return true;
    }catch(e){
      // Fallback: select a textarea
      const ta = document.createElement('textarea');
      ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    }
  }

  // ── Render the full sync UI into a container ──────────────────
  function renderSyncPanel(containerId){
    const el = document.getElementById(containerId);
    if(!el) return;
    const shortId = _aid ? _aid.slice(0,8)+'…' : '—';

    el.innerHTML = `
    <div class="anon-panel">
      <div class="anon-header">
        <div class="anon-icon">🔑</div>
        <div>
          <div class="anon-title">Anonymous Identity</div>
          <div class="anon-id-display">${shortId}</div>
        </div>
      </div>

      <div class="anon-tabs">
        <button class="anon-tab on" onclick="ANON._showTab('share')">Share</button>
        <button class="anon-tab"    onclick="ANON._showTab('restore')">Restore</button>
        <button class="anon-tab"    onclick="ANON._showTab('history')">History</button>
      </div>

      <!-- Share panel -->
      <div id="anon-share-pane" class="anon-pane">
        <div class="anon-hint">Scan this on your other device to sync reports</div>
        <div id="anon-qr" class="anon-qr-box"></div>
        <button class="anon-copy-btn" onclick="ANON._copyAndFlash(this)">
          📋 Copy sync link
        </button>
        <div class="anon-small-id">
          ID: <span class="anon-full-id">${_aid||''}</span>
        </div>
      </div>

      <!-- Restore panel -->
      <div id="anon-restore-pane" class="anon-pane" style="display:none">
        <div class="anon-hint">Paste a sync link or enter your 36-character ID</div>
        <input id="anon-restore-input"
          class="anon-restore-input"
          placeholder="Paste link or ID (xxxxxxxx-xxxx-…)"
          oninput="ANON._validateRestoreInput(this)"
        >
        <div id="anon-restore-err" class="anon-restore-err"></div>
        <button id="anon-restore-btn" class="anon-restore-btn" disabled
          onclick="ANON._confirmRestore()">
          Restore identity
        </button>
        <div class="anon-restore-warn">
          ⚠ This replaces your current ID on this device.
          Your existing reports will no longer appear here.
        </div>
      </div>

      <!-- History panel -->
      <div id="anon-history-pane" class="anon-pane" style="display:none">
        <div class="anon-hint">Reports filed from any device with this ID</div>
        <div id="anon-history-list" class="anon-history-list">
          <div class="anon-history-loading">Loading…</div>
        </div>
      </div>
    </div>`;

    renderQR('anon-qr');
  }

  // ── Tab switch inside panel ───────────────────────────────────
  function _showTab(tab){
    document.querySelectorAll('.anon-tab').forEach(b => {
      b.classList.toggle('on', b.textContent.toLowerCase()===tab);
    });
    document.getElementById('anon-share-pane').style.display   = tab==='share'   ? '' : 'none';
    document.getElementById('anon-restore-pane').style.display = tab==='restore' ? '' : 'none';
    document.getElementById('anon-history-pane').style.display = tab==='history' ? '' : 'none';
    if(tab==='history') _loadHistory();
  }

  async function _loadHistory(){
    const list = document.getElementById('anon-history-list');
    if(!list) return;
    list.innerHTML = '<div class="anon-history-loading">Loading…</div>';
    const reports = await myReports();
    if(!reports.length){
      list.innerHTML = '<div class="anon-history-empty">No reports yet. Submit one from the Report tab.</div>';
      return;
    }
    const LEVEL_ICON = { empty:'🟢', moderate:'🟡', packed:'🔴' };
    list.innerHTML = reports.map(r => {
      const ago = _timeAgo(r.created_at);
      const icon = LEVEL_ICON[r.level] || '⚪';
      return `<div class="anon-history-row">
        <span class="anon-hist-icon">${icon}</span>
        <div class="anon-hist-info">
          <div class="anon-hist-station">${r.station_name}</div>
          <div class="anon-hist-meta">${r.level} · ${ago}</div>
        </div>
        <span class="anon-hist-val">${r.crowd_value}%</span>
      </div>`;
    }).join('');
  }

  function _timeAgo(iso){
    const s = Math.round((Date.now() - new Date(iso))/1000);
    if(s < 60)   return s+'s ago';
    if(s < 3600) return Math.floor(s/60)+'m ago';
    if(s < 86400)return Math.floor(s/3600)+'h ago';
    return new Date(iso).toLocaleDateString('en-IN',{day:'numeric',month:'short'});
  }

  async function _copyAndFlash(btn){
    await copyLink();
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    btn.style.color = 'var(--low)';
    setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 2000);
  }

  function _validateRestoreInput(input){
    const val = input.value.trim();
    const btn = document.getElementById('anon-restore-btn');
    const err = document.getElementById('anon-restore-err');
    // Accept full URL or bare UUID
    const aid = extractAidFromInput(val);
    if(aid){
      btn.disabled = false;
      err.textContent = '';
      input.dataset.aid = aid;
    } else {
      btn.disabled = true;
      err.textContent = val.length > 5 ? 'Not a valid ID or link.' : '';
      delete input.dataset.aid;
    }
  }

  function extractAidFromInput(val){
    if(!val) return null;
    // Try as URL first
    try{
      const url = new URL(val);
      const param = url.searchParams.get('aid');
      if(param && isValidAid(param)) return param;
    }catch(_){}
    // Try as bare UUID
    if(isValidAid(val.trim())) return val.trim();
    return null;
  }

  async function _confirmRestore(){
    const input = document.getElementById('anon-restore-input');
    const aid   = input?.dataset.aid;
    if(!aid) return;

    const btn = document.getElementById('anon-restore-btn');
    btn.disabled = true;
    btn.textContent = 'Restoring…';

    const ok = await importAid(aid);
    if(ok){
      // Reload page to re-fetch reports under new ID
      SB?.showToast('✓ Identity restored. Reloading…');
      setTimeout(() => window.location.reload(), 1200);
    } else {
      btn.disabled = false;
      btn.textContent = 'Restore identity';
    }
  }

  function showImportError(msg){
    const el = document.getElementById('anon-restore-err');
    if(el){ el.textContent = msg; el.style.color = 'var(--pk)'; }
  }

  // ── Check for pending import (set during loadOrCreate) ────────
  async function checkPendingImport(){
    const pending = localStorage.getItem(IMPORT_KEY);
    if(!pending || !isValidAid(pending)) return;

    // Show a non-blocking banner
    const banner = document.createElement('div');
    banner.id = 'anon-import-banner';
    banner.className = 'anon-import-banner';
    banner.innerHTML = `
      <div style="flex:1">
        <strong>Sync ID found</strong><br>
        <span style="font-size:8px;font-family:'Space Mono',monospace;color:var(--muted)">${pending.slice(0,8)}… · from link</span>
      </div>
      <button class="anon-import-yes" onclick="ANON._acceptImport('${pending}')">Restore</button>
      <button class="anon-import-no"  onclick="ANON._dismissImport()">Dismiss</button>
    `;
    document.body.appendChild(banner);
  }

  async function _acceptImport(aid){
    document.getElementById('anon-import-banner')?.remove();
    const ok = await importAid(aid);
    if(ok){
      SB?.showToast('✓ Identity restored — reports synced.');
      setTimeout(() => window.location.reload(), 1200);
    }
  }

  function _dismissImport(){
    localStorage.removeItem(IMPORT_KEY);
    document.getElementById('anon-import-banner')?.remove();
  }

  // ── Expose anon_id as supabase session_id replacement ─────────
  // supabase.js calls ANON.id() instead of sessionStorage.getItem('metro_session')
  function id(){ return _aid; }

  // ── Init ──────────────────────────────────────────────────────
  async function init(supabaseClient){
    _client = supabaseClient || null;
    _aid    = loadOrCreate();

    // Sync to cloud in background
    if(_client) syncToCloud(_aid).then(()=> checkPendingImport());
    else checkPendingImport();

    // Keep sessionStorage in sync (backward compat for any remaining references)
    sessionStorage.setItem('metro_session', _aid);

    console.log('[ANON] Initialized. AID:', _aid.slice(0,8)+'…');
    return _aid;
  }

  function setOnChange(cb){ _onAidChange = cb; }

  // ── Fetch all reports filed under this anon_id (cross-device) ─
  async function myReports(){
    if(!_client || !_aid) return [];
    try{
      const { data, error } = await _client
        .from('crowd_reports')
        .select('id,station_id,station_name,level,crowd_value,created_at,line_codes')
        .eq('anon_id', _aid)
        .order('created_at', { ascending: false })
        .limit(50);
      if(error) throw error;
      return data || [];
    } catch(e){
      console.warn('[ANON] myReports error:', e.message);
      return [];
    }
  }

  // ── Count reports in cloud ────────────────────────────────────
  async function myReportCount(){
    if(!_client || !_aid) return 0;
    try{
      const { count } = await _client
        .from('crowd_reports')
        .select('*', { count: 'exact', head: true })
        .eq('anon_id', _aid);
      return count || 0;
    } catch(e){ return 0; }
  }

  return {
    init, id, shareUrl, copyLink,
    renderSyncPanel, renderQR,
    importAid, isValidAid,
    myReports, myReportCount,
    // panel internals (called from inline HTML)
    _showTab, _copyAndFlash, _validateRestoreInput, _confirmRestore,
    _acceptImport, _dismissImport,
    get aid(){ return _aid; },
  };
})();
