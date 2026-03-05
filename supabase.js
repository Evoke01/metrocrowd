// ══════════════════════════════════════════════════════════════════
//  SUPABASE BACKEND MODULE
//  Paste your credentials below after following SUPABASE_SETUP.md
// ══════════════════════════════════════════════════════════════════
const SUPABASE_URL = "https://tfuxpslcmhdvwidfcdch.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_nmPz260NMnm3AIk7ZGVowQ_dlfkOKEp";

window.SB = (function(){
  let client = null;
  let sessionId = null;
  let userId    = null;
  let isReady   = false;
  let realtimeSubs = [];

  // ── Detect if credentials are configured ──────────────────────
  function isConfigured(){
    return !SUPABASE_URL.includes('YOUR_PROJECT') &&
           !SUPABASE_ANON_KEY.includes('YOUR_ANON_KEY');
  }

  // ── Stable anonymous session ID (persists across reloads) ─────
  function getSessionId(){
    let sid = sessionStorage.getItem('metro_session');
    if(!sid){
      sid = 'sess_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
      sessionStorage.setItem('metro_session', sid);
    }
    return sid;
  }

  // ── Init ──────────────────────────────────────────────────────
  async function init(){
    if(!isConfigured()){
      console.warn('[SB] Not configured — running in local-only mode. See SUPABASE_SETUP.md');
      setStatus('Local mode — Supabase not configured', 'warn');
      return false;
    }

    // Load Supabase JS SDK (already loaded via CDN in index.html)
    if(!window.supabase){
      console.error('[SB] Supabase SDK not found. Check index.html script tag.');
      return false;
    }

    try{
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true },
        realtime: { params: { eventsPerSecond: 10 } }
      });

      sessionId = getSessionId();

      // Sign in anonymously so RLS allows writes
      const { data: authData, error: authErr } = await client.auth.signInAnonymously();
      if(authErr){
        console.warn('[SB] Anonymous auth failed:', authErr.message);
      } else {
        userId = authData?.user?.id || null;
        console.log('[SB] Signed in anonymously. userId:', userId?.slice(0,8)+'…');
      }

      isReady = true;
      setStatus('Connected ✓', 'ok');
      console.log('[SB] Connected to', SUPABASE_URL);

      // Hand client to AUTH module — it owns all sign-in/sign-out logic
      if(typeof AUTH !== 'undefined') AUTH.init(client);

      // Keep SB.userId in sync
      client.auth.onAuthStateChange((_ev, session) => {
        userId = session?.user?.id || null;
      });

      // Start background tasks
      await loadNewsEventsFromDB();
      await loadReportsFromDB();
      subscribeRealtime();

      return true;
    }catch(err){
      console.error('[SB] Init error:', err);
      setStatus('Connection failed', 'error');
      return false;
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  CROWD REPORTS
  // ══════════════════════════════════════════════════════════════

  // Submit a new crowd report → Supabase crowd_reports table
  async function submitReport(stationId, level){
    const s = METRO.STATIONS[stationId];
    if(!s) return {ok:false, error:'Station not found'};

    const crowdValue = level==='empty' ? 14 : level==='moderate' ? 50 : 88;

    // Always update local state immediately
    CROWD.state.userReports[stationId] = level;
    CROWD.recomputeAll();
    MAP.updateMarkers();
    UI.updateHeader();

    if(!isReady) return {ok:true, local:true};

    try{
      const {error} = await client
        .from('crowd_reports')
        .insert({
          station_id:   stationId,
          station_name: s.n,
          level,
          crowd_value:  crowdValue,
          user_id:      userId,
          session_id:   sessionId,
          line_codes:   s.l,
        });

      if(error) throw error;

      // Also log to station_alerts if level is 'packed'
      if(level === 'packed'){
        await logAlert({
          stationIds: [stationId],
          alertType: 'report',
          severity: 'crowd',
          title: `Packed crowd reported at ${s.n}`,
          detail: `User report: ${level} (${crowdValue}%)`,
          boost: 1.35,
        });
      }

      // Push updated snapshot so other clients see it
      await pushSnapshot();

      console.log(`[SB] Report saved: ${s.n} → ${level}`);
      return {ok:true};
    }catch(err){
      console.warn('[SB] submitReport error:', err.message);
      return {ok:true, local:true}; // still worked locally
    }
  }

  // Load recent reports from DB on startup
  async function loadReportsFromDB(){
    if(!isReady) return;
    try{
      const {data, error} = await client
        .from('station_latest_reports')  // uses the VIEW we created
        .select('station_id, level, crowd_value, created_at');
      if(error) throw error;

      if(data?.length){
        data.forEach(row => {
          // Only apply if more recent than any existing local report
          if(!CROWD.state.userReports[row.station_id]){
            CROWD.state.userReports[row.station_id] = row.level;
          }
        });
        CROWD.recomputeAll();
        MAP.updateMarkers();
        UI.updateHeader();
        console.log(`[SB] Loaded ${data.length} station reports from DB`);
      }
    }catch(err){
      console.warn('[SB] loadReportsFromDB:', err.message);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  NEWS EVENTS CACHE
  // ══════════════════════════════════════════════════════════════

  // Save parsed news events to DB (called by news.js after RSS fetch)
  async function cacheNewsEvents(events){
    if(!isReady || !events?.length) return;
    try{
      // Upsert — insert or update by id
      const rows = events.map(ev => ({
        id:           ev.id,
        name:         ev.name?.slice(0,200) || '',
        icon:         ev.icon || '📰',
        boost:        ev.boost || 1.1,
        sev:          ev.sev || 'info',
        active:       ev.active || false,
        affected:     ev.affected || [],
        detail:       ev.detail?.slice(0,500) || '',
        source:       ev.source || 'Google News',
        url:          ev.url || '',
        published_at: ev.pubDate ? new Date(ev.pubDate).toISOString() : new Date().toISOString(),
        fetched_at:   new Date().toISOString(),
        expires_at:   new Date(Date.now() + 18*3600*1000).toISOString(),
      }));

      const {error} = await client
        .from('news_events')
        .upsert(rows, {onConflict:'id', ignoreDuplicates:false});

      if(error) throw error;

      // Log high-severity events to alerts
      const urgent = events.filter(ev => ev.active &&
        ['security','emergency','closure','protest','delay'].includes(ev.sev));
      for(const ev of urgent){
        await logAlert({
          stationIds: ev.affected||[],
          alertType: 'news',
          severity: ev.sev,
          title: ev.name,
          detail: ev.detail,
          sourceUrl: ev.url,
          boost: ev.boost,
        });
      }

      console.log(`[SB] Cached ${rows.length} news events`);
    }catch(err){
      console.warn('[SB] cacheNewsEvents:', err.message);
    }
  }

  // Load cached news events from DB (avoids refetching RSS on page reload)
  async function loadNewsEventsFromDB(){
    if(!isReady) return;
    try{
      const {data, error} = await client
        .from('news_events')
        .select('*')
        .gt('expires_at', new Date().toISOString())
        .order('fetched_at', {ascending:false})
        .limit(40);

      if(error) throw error;

      if(data?.length){
        // Map DB rows back to app event format
        const mapped = data.map(row => ({
          id:       row.id,
          name:     row.name,
          icon:     row.icon,
          boost:    row.boost,
          sev:      row.sev,
          active:   row.active,
          affected: row.affected||[],
          detail:   row.detail,
          source:   row.source,
          url:      row.url,
          time:     row.published_at
            ? new Date(row.published_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})
            : '',
          date:     row.published_at
            ? new Date(row.published_at).toLocaleDateString('en-IN',{month:'short',day:'numeric'})
            : '',
          ageMs:    row.published_at ? Date.now()-new Date(row.published_at).getTime() : 0,
          _news:    true,
          _fromDB:  true,
        }));

        // Merge with any already-in-memory events
        const existingIds = new Set(CROWD.state.newsEvents.map(e=>e.id));
        mapped.forEach(ev => { if(!existingIds.has(ev.id)) CROWD.state.newsEvents.push(ev) });

        CROWD.recomputeAll();
        MAP.updateMarkers();
        UI.updateHeader();
        if(typeof UI.refreshIfActive==='function') UI.refreshIfActive('events');
        console.log(`[SB] Loaded ${data.length} cached news events from DB`);
      }
    }catch(err){
      console.warn('[SB] loadNewsEventsFromDB:', err.message);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  CROWD SNAPSHOT — sync across all open tabs/devices
  // ══════════════════════════════════════════════════════════════

  async function pushSnapshot(){
    if(!isReady) return;
    try{
      const ns = CROWD.networkStats();
      const {error} = await client
        .from('crowd_snapshot')
        .update({
          crowd_map:     CROWD.state.crowdMap,
          report_count:  Object.keys(CROWD.state.userReports).length,
          active_events: CROWD.state.newsEvents.filter(e=>e.active).length,
          updated_at:    new Date().toISOString(),
        })
        .eq('id', 1);
      if(error) throw error;
    }catch(err){
      // Silent — snapshot is best-effort
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  STATION ALERTS LOG
  // ══════════════════════════════════════════════════════════════

  async function logAlert({stationIds, alertType, severity, title, detail, sourceUrl, boost}){
    if(!isReady) return;
    try{
      await client.from('station_alerts').insert({
        station_ids:  stationIds,
        alert_type:   alertType,
        severity,
        title:        title?.slice(0,200)||'',
        detail:       detail?.slice(0,500)||'',
        source_url:   sourceUrl||null,
        boost:        boost||null,
        triggered_by: userId,
      });
    }catch(_){ /* silent */ }
  }

  // Load alert history for a specific station
  async function loadStationAlerts(stationId, limit=20){
    if(!isReady) return [];
    try{
      const {data, error} = await client
        .from('station_alerts')
        .select('*')
        .contains('station_ids', [stationId])
        .order('created_at', {ascending:false})
        .limit(limit);
      if(error) throw error;
      return data||[];
    }catch(err){
      console.warn('[SB] loadStationAlerts:', err.message);
      return [];
    }
  }

  // Load global alert history (for history tab)
  async function loadAlertHistory(limit=50){
    if(!isReady) return [];
    try{
      const {data, error} = await client
        .from('recent_alerts')
        .select('*')
        .limit(limit);
      if(error) throw error;
      return data||[];
    }catch(err){
      return [];
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  REALTIME SUBSCRIPTIONS
  // ══════════════════════════════════════════════════════════════

  function subscribeRealtime(){
    if(!client) return;

    // 1. crowd_reports — new report from ANY user instantly blends in
    const reportSub = client
      .channel('crowd-reports-live')
      .on('postgres_changes',
        {event:'INSERT', schema:'public', table:'crowd_reports'},
        (payload) => {
          const row = payload.new;
          if(!row.station_id) return;
          // Don't re-apply our own reports
          if(row.session_id === sessionId) return;

          CROWD.state.userReports[row.station_id] = row.level;
          CROWD.recomputeAll();
          MAP.updateMarkers();
          UI.updateHeader();
          if(typeof UI.refreshPanel==='function') UI.refreshPanel();

          // Prepend to UI report lists instantly
          if(typeof UI !== 'undefined' && typeof UI.prependReport === 'function'){
            UI.prependReport(row);
          }

          // Show brief toast
          showToast(`📍 New report: ${row.station_name||row.station_id} → ${row.level.toUpperCase()}`);
          console.log(`[SB RT] Report from another user: ${row.station_id} → ${row.level}`);
        }
      )
      .subscribe();
    realtimeSubs.push(reportSub);

    // 2. crowd_snapshot — full crowd map pushed by any client
    const snapSub = client
      .channel('crowd-snapshot-live')
      .on('postgres_changes',
        {event:'UPDATE', schema:'public', table:'crowd_snapshot'},
        (payload) => {
          const snap = payload.new;
          if(!snap?.crowd_map) return;
          // Merge: remote values for stations we don't have local reports for
          Object.entries(snap.crowd_map).forEach(([id, v])=>{
            if(!CROWD.state.userReports[id]){
              CROWD.state.crowdMap[id] = v;
            }
          });
          MAP.updateMarkers();
          UI.updateHeader();
          console.log('[SB RT] Crowd snapshot updated');
        }
      )
      .subscribe();
    realtimeSubs.push(snapSub);

    // 3. news_events — new event cached by any client
    const newsSub = client
      .channel('news-events-live')
      .on('postgres_changes',
        {event:'INSERT', schema:'public', table:'news_events'},
        (payload) => {
          const row = payload.new;
          const existing = CROWD.state.newsEvents.find(e=>e.id===row.id);
          if(existing) return;

          const ev = {
            id:row.id, name:row.name, icon:row.icon, boost:row.boost,
            sev:row.sev, active:row.active, affected:row.affected||[],
            detail:row.detail, source:row.source, url:row.url,
            time: row.published_at
              ? new Date(row.published_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})
              : '',
            _news:true, _fromDB:true, ageMs:0,
          };
          CROWD.state.newsEvents.unshift(ev);
          CROWD.recomputeAll();
          MAP.updateMarkers();
          UI.updateHeader();
          if(typeof UI.refreshIfActive==='function') UI.refreshIfActive('events');

          if(row.active){
            showToast(`${row.icon} News alert: ${row.name?.slice(0,60)}`);
          }
          console.log('[SB RT] New news event received:', row.name?.slice(0,50));
        }
      )
      .subscribe();
    realtimeSubs.push(newsSub);

    console.log('[SB] Realtime subscriptions active (reports + snapshot + news)');
  }

  function unsubscribeAll(){
    realtimeSubs.forEach(s=>{ try{ client?.removeChannel(s) }catch(_){} });
    realtimeSubs=[];
  }

  // ══════════════════════════════════════════════════════════════
  //  TOAST NOTIFICATION
  // ══════════════════════════════════════════════════════════════

  function showToast(msg, duration=4000){
    let t = document.getElementById('sb-toast');
    if(!t){
      t = document.createElement('div');
      t.id = 'sb-toast';
      t.style.cssText = `
        position:fixed;bottom:120px;left:50%;transform:translateX(-50%);
        background:#0E1420;border:1px solid var(--border);
        color:var(--text);padding:7px 14px;border-radius:20px;
        font-family:'Space Mono',monospace;font-size:10px;
        z-index:9999;max-width:86vw;text-align:center;
        box-shadow:0 4px 24px rgba(0,0,0,.6);
        transition:opacity .3s;pointer-events:none;
      `;
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(()=>{ t.style.opacity='0' }, duration);
  }

  // ── Status indicator ─────────────────────────────────────────
  function setStatus(msg, type='info'){
    const el = document.getElementById('sb-status');
    if(!el) return;
    const colors = {ok:'var(--low)', warn:'var(--a2)', error:'var(--pk)', info:'var(--muted)'};
    el.textContent = msg;
    el.style.color = colors[type]||colors.info;
  }

  // ── Public API ───────────────────────────────────────────────
  return{
    init,
    submitReport,
    cacheNewsEvents,
    loadNewsEventsFromDB,
    loadReportsFromDB,
    loadStationAlerts,
    loadAlertHistory,
    pushSnapshot,
    logAlert,
    showToast,
    get isReady(){ return isReady },
    get userId(){ return userId },
    get client(){ return client },
  };
})();
