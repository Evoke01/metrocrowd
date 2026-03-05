// ══════════════════════════════════════════════════════════════════
//  NOTIFY MODULE
//  1. Station push notification subscriptions
//  2. Confidence score engine  (low / medium / high)
//  3. Anomaly detection        (model vs reality divergence)
// ══════════════════════════════════════════════════════════════════
window.NOTIFY = (function(){

  // ── State ──────────────────────────────────────────────────────
  const state = {
    subscriptions: new Set(),         // station IDs user subscribed to
    pushEnabled:   false,             // browser push permission granted
    swReady:       false,             // service worker registered
    confidenceMap: {},                // stationId → {score, tier, sources}
    anomalyMap:    {},                // stationId → {delta, severity, detected}
    prevCrowdMap:  {},                // snapshot for anomaly comparison
    checkTimer:    null,
  };

  // Persist subscriptions to localStorage
  function loadSubs(){
    try{
      const raw = localStorage.getItem('metro_subs');
      if(raw) JSON.parse(raw).forEach(id => state.subscriptions.add(id));
    }catch{}
  }
  function saveSubs(){
    try{ localStorage.setItem('metro_subs', JSON.stringify([...state.subscriptions])); }catch{}
  }

  // ══════════════════════════════════════════════════════════════
  //  CONFIDENCE SCORE ENGINE
  //  Each station gets a data-quality score every cycle
  // ══════════════════════════════════════════════════════════════

  // Returns { score:0-100, tier:'low'|'medium'|'high', label, color, sources:[] }
  function computeConfidence(stationId){
    const sources = [];
    let score = 30; // base: model always running

    sources.push('Model');

    // News signal: active event affecting this station
    const newsHit = CROWD.state.newsEvents.some(ev =>
      ev.active && (ev.affected||[]).includes(stationId));
    if(newsHit){ score += 28; sources.push('News'); }

    // Weak news signal: any event mentioning this station (not active)
    const newsWeak = CROWD.state.newsEvents.some(ev =>
      !ev.active && (ev.affected||[]).includes(stationId));
    if(newsWeak && !newsHit){ score += 10; sources.push('News (weak)'); }

    // User report exists
    if(CROWD.state.userReports[stationId]){ score += 42; sources.push('User report'); }

    // Bonus: station is a major interchange (more reliable base data)
    if(METRO.STATIONS[stationId]?.ix){ score = Math.min(100, score + 8); }

    const tier  = score >= 70 ? 'high'
                : score >= 45 ? 'medium'
                : 'low';
    const label = score >= 70 ? 'High confidence'
                : score >= 45 ? 'Medium confidence'
                : 'Model prediction only';
    const color = score >= 70 ? '#00E676'
                : score >= 45 ? '#FFD600'
                : '#3E5272';

    return { score, tier, label, color, sources };
  }

  function recomputeAllConfidence(){
    Object.keys(METRO.STATIONS).forEach(id => {
      state.confidenceMap[id] = computeConfidence(id);
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  ANOMALY DETECTION ENGINE
  //  Compares model baseline vs blended crowd value
  // ══════════════════════════════════════════════════════════════

  // Anomaly thresholds
  const ANOMALY_THRESHOLD  = 25;  // absolute % difference triggers anomaly
  const ANOMALY_HIGH_DELTA = 40;  // severe anomaly
  const MIN_CONFIDENCE     = 45;  // only flag if we have real data signals

  function computeAnomaly(stationId){
    const s = METRO.STATIONS[stationId];
    if(!s) return null;

    // Pure model prediction (no news/reports)
    const modelVal = Math.min(100, Math.max(5, Math.round(s.b * METRO.RUSH[CROWD.state.hour])));
    const blended  = CROWD.state.crowdMap[stationId] || modelVal;
    const conf     = state.confidenceMap[stationId];

    // Only flag anomalies when we have real data to compare against
    if(!conf || conf.score < MIN_CONFIDENCE) return null;

    const delta = blended - modelVal;
    const absDelta = Math.abs(delta);

    if(absDelta < ANOMALY_THRESHOLD) return null;

    const direction = delta > 0 ? 'higher' : 'lower';
    const severity  = absDelta >= ANOMALY_HIGH_DELTA ? 'high' : 'medium';

    return {
      stationId,
      modelVal,
      blendedVal: blended,
      delta,
      absDelta,
      direction,
      severity,
      label: `${absDelta}% ${direction} than predicted`,
      icon:  severity === 'high' ? '⚡' : '⚠️',
      color: severity === 'high' ? '#FF1744' : '#FF6D00',
      detected: Date.now(),
    };
  }

  function recomputeAllAnomalies(){
    const prev = {...state.anomalyMap};
    state.anomalyMap = {};
    const newAnomalies = [];

    Object.keys(METRO.STATIONS).forEach(id => {
      const a = computeAnomaly(id);
      if(a){
        state.anomalyMap[id] = a;
        // Only treat as NEW if wasn't detected in last cycle or severity escalated
        if(!prev[id] || prev[id].severity !== a.severity) newAnomalies.push(a);
      }
    });

    // Trigger push notifications for anomalies at subscribed stations
    newAnomalies.forEach(a => {
      if(state.subscriptions.has(a.stationId)){
        const s = METRO.STATIONS[a.stationId];
        sendPush({
          stationId: a.stationId,
          title: `${a.icon} Anomaly at ${s.n}`,
          body:  `Crowd ${a.blendedVal}% — ${a.label}`,
          urgency: a.severity === 'high' ? 'high' : 'medium',
          tag: `anomaly-${a.stationId}`,
        });
      }
    });

    return newAnomalies;
  }

  // ══════════════════════════════════════════════════════════════
  //  CROWD THRESHOLD ALERTS
  // ══════════════════════════════════════════════════════════════

  const THRESHOLDS = [
    { value: 82, label: 'Packed',  urgency: 'high',   icon: '🔴' },
    { value: 65, label: 'High',    urgency: 'medium',  icon: '🟠' },
  ];

  const alertCooldown = {}; // stationId → last alert timestamp

  function checkThresholdAlerts(){
    state.subscriptions.forEach(stationId => {
      const v  = CROWD.state.crowdMap[stationId] || 0;
      const s  = METRO.STATIONS[stationId];
      if(!s) return;

      const now  = Date.now();
      const cool = alertCooldown[stationId] || 0;
      if(now - cool < 20 * 60 * 1000) return; // 20-min cooldown

      for(const t of THRESHOLDS){
        if(v >= t.value){
          sendPush({
            stationId,
            title: `${t.icon} ${s.n} — ${t.label}`,
            body:  `Crowd at ${v}% — expect ${CROWD.waitLabel(v)} wait time`,
            urgency: t.urgency,
            tag:   `crowd-${stationId}`,
          });
          alertCooldown[stationId] = now;
          break;
        }
      }
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  PUSH NOTIFICATION DELIVERY
  // ══════════════════════════════════════════════════════════════

  async function initPush(){
    if(!('serviceWorker' in navigator) || !('Notification' in window)) return false;

    // Register service worker
    try{
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      state.swReady = true;

      // Listen for messages from SW (e.g. OPEN_STATION click)
      navigator.serviceWorker.addEventListener('message', e => {
        if(e.data?.type === 'OPEN_STATION' && e.data.stationId){
          UI.openPanel(e.data.stationId);
          UI.switchTab('map');
        }
      });

      console.log('[NOTIFY] Service worker registered');
      return reg;
    }catch(err){
      console.warn('[NOTIFY] SW registration failed:', err.message);
      return false;
    }
  }

  async function requestPermission(){
    if(!('Notification' in window)) return 'unsupported';
    if(Notification.permission === 'granted'){ state.pushEnabled = true; return 'granted'; }
    if(Notification.permission === 'denied')  return 'denied';

    const result = await Notification.requestPermission();
    state.pushEnabled = result === 'granted';
    return result;
  }

  // Send a notification — uses Web Notification API (works without server)
  function sendPush({ title, body, icon, urgency, tag, stationId, url }){
    if(!state.pushEnabled || Notification.permission !== 'granted') return;

    try{
      const n = new Notification(title, {
        body,
        icon:    icon || '🚇',
        tag:     tag  || 'metro-alert',
        requireInteraction: urgency === 'high',
        data: { stationId, url: url || window.location.href },
      });
      n.onclick = () => {
        window.focus();
        if(stationId){ UI.openPanel(stationId); UI.switchTab('map'); }
        n.close();
      };
    }catch(err){
      console.warn('[NOTIFY] Push failed:', err.message);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  SUBSCRIPTION MANAGEMENT
  // ══════════════════════════════════════════════════════════════

  async function subscribe(stationId){
    // First time: request permission
    if(!state.pushEnabled){
      const perm = await requestPermission();
      if(perm === 'denied'){
        SB.showToast('🔕 Notifications blocked. Enable in browser settings.');
        return false;
      }
    }

    state.subscriptions.add(stationId);
    saveSubs();

    // Save to Supabase if signed in
    if(typeof SB !== 'undefined' && SB.isReady && typeof AUTH !== 'undefined' && AUTH.isSignedIn){
      saveSubscriptionToDB(stationId, true);
    }

    const s = METRO.STATIONS[stationId];
    SB.showToast(`🔔 Subscribed to ${s?.n || stationId}`);
    updateSubButtons(stationId, true);

    // Run initial checks immediately
    checkThresholdAlerts();
    return true;
  }

  function unsubscribe(stationId){
    state.subscriptions.delete(stationId);
    saveSubs();
    if(typeof SB !== 'undefined' && SB.isReady && typeof AUTH !== 'undefined' && AUTH.isSignedIn){
      saveSubscriptionToDB(stationId, false);
    }
    const s = METRO.STATIONS[stationId];
    SB.showToast(`🔕 Unsubscribed from ${s?.n || stationId}`);
    updateSubButtons(stationId, false);
  }

  function toggleSubscription(stationId){
    if(state.subscriptions.has(stationId)) unsubscribe(stationId);
    else subscribe(stationId);
  }

  function isSubscribed(stationId){ return state.subscriptions.has(stationId); }

  async function saveSubscriptionToDB(stationId, active){
    if(!SB.client) return;
    try{
      if(active){
        await SB.client.from('station_subscriptions').upsert({
          user_id: AUTH.currentUser?.id,
          station_id: stationId,
          station_name: METRO.STATIONS[stationId]?.n || stationId,
          active: true,
        }, { onConflict: 'user_id,station_id' });
      }else{
        await SB.client.from('station_subscriptions')
          .update({ active: false })
          .match({ user_id: AUTH.currentUser?.id, station_id: stationId });
      }
    }catch(err){ console.warn('[NOTIFY] DB sub save failed:', err.message); }
  }

  async function loadSubscriptionsFromDB(){
    if(!SB?.isReady || !AUTH?.isSignedIn) return;
    try{
      const { data } = await SB.client
        .from('station_subscriptions')
        .select('station_id')
        .eq('user_id', AUTH.currentUser.id)
        .eq('active', true);
      if(data?.length){
        data.forEach(r => state.subscriptions.add(r.station_id));
        saveSubs();
        console.log(`[NOTIFY] Loaded ${data.length} subscriptions from DB`);
      }
    }catch{}
  }

  // ══════════════════════════════════════════════════════════════
  //  UPDATE LOOP — called by crowd.js after every recomputeAll
  // ══════════════════════════════════════════════════════════════

  function onCrowdUpdate(){
    recomputeAllConfidence();
    recomputeAllAnomalies();
    checkThresholdAlerts();
  }

  // ══════════════════════════════════════════════════════════════
  //  HELPERS FOR UI
  // ══════════════════════════════════════════════════════════════

  // Update subscribe button state inside station panel
  function updateSubButtons(stationId, isSub){
    const btn = document.getElementById('sp-sub-btn');
    if(!btn || btn.dataset.id !== stationId) return;
    btn.textContent  = isSub ? '🔔 Subscribed' : '🔕 Subscribe';
    btn.dataset.sub  = isSub ? '1' : '0';
    btn.style.background = isSub ? 'rgba(0,230,118,.12)' : '';
    btn.style.borderColor = isSub ? 'rgba(0,230,118,.4)' : '';
    btn.style.color  = isSub ? 'var(--low)' : '';
  }

  // Build the confidence badge HTML string
  function confidenceBadge(stationId){
    const c = state.confidenceMap[stationId];
    if(!c) return '';
    const pips = [1,2,3].map(i =>
      `<span style="width:5px;height:5px;border-radius:50%;background:${i <= Math.ceil(c.score/34) ? c.color : 'var(--border)'}"></span>`
    ).join('');
    return `<span class="conf-badge" title="${c.label}: ${c.sources.join(', ')}" style="--cc:${c.color}">
      ${pips}
      <span style="font-size:7px;color:${c.color};font-family:'Space Mono',monospace;margin-left:3px">${c.tier.toUpperCase()}</span>
    </span>`;
  }

  // Build the anomaly banner HTML string
  function anomalyBanner(stationId){
    const a = state.anomalyMap[stationId];
    if(!a) return '';
    return `<div class="anomaly-banner" style="--ac:${a.color}">
      <span>${a.icon}</span>
      <span>Anomaly detected — ${a.label}</span>
      <span style="font-size:8px;opacity:.7">Model: ${a.modelVal}% · Reports: ${a.blendedVal}%</span>
    </div>`;
  }

  // List of all current anomalies (for stats panel)
  function getAnomalies(){
    return Object.values(state.anomalyMap).sort((a,b) => b.absDelta - a.absDelta);
  }

  // ── Init ──────────────────────────────────────────────────────
  async function init(){
    loadSubs();
    await initPush();

    // If already granted from a previous visit, mark ready
    if(Notification.permission === 'granted') state.pushEnabled = true;

    // Load DB subs once auth is ready (called again from AUTH.onSignedIn)
    setTimeout(loadSubscriptionsFromDB, 3000);

    console.log(`[NOTIFY] Ready — ${state.subscriptions.size} subscriptions, push: ${Notification.permission}`);
  }

  return {
    init,
    onCrowdUpdate,
    subscribe, unsubscribe, toggleSubscription, isSubscribed,
    loadSubscriptionsFromDB,
    computeConfidence, recomputeAllConfidence,
    computeAnomaly,    recomputeAllAnomalies,
    confidenceBadge, anomalyBanner, getAnomalies,
    sendPush,
    get subscriptions(){ return state.subscriptions; },
    get confidenceMap(){ return state.confidenceMap; },
    get anomalyMap(){    return state.anomalyMap;    },
    get pushEnabled(){   return state.pushEnabled;   },
  };
})();
