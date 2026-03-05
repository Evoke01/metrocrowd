// ══════════════════════════════════════════════════════════════════
//  NEWS ENGINE v4 — Google News RSS
//  Sources:
//    1. Google News RSS (news.google.com/rss/search) via rss2json.com
//    2. Fallback: allorigins CORS proxy + DOMParser for raw XML
//  Polling: every 20 minutes
//  Pipeline: fetch → deduplicate → detect keywords →
//            map station names → create events → update crowd model
// ══════════════════════════════════════════════════════════════════
window.NEWS = (function () {

  // ── RSS Feed URLs ──────────────────────────────────────────────
  const GN_BASE = 'https://news.google.com/rss/search?hl=en-IN&gl=IN&ceid=IN:en&q=';
  const FEEDS = [
    { url: GN_BASE + encodeURIComponent('Delhi Metro'), label: 'General' },
    { url: GN_BASE + encodeURIComponent('DMRC OR "Delhi Metro Rail"'), label: 'DMRC' },
    { url: GN_BASE + encodeURIComponent('Delhi Metro delay OR disruption OR closure OR accident'), label: 'Disruptions' },
    { url: GN_BASE + encodeURIComponent('Delhi Metro crowd OR rush OR packed OR congestion'), label: 'Crowd' },
    { url: GN_BASE + encodeURIComponent('Delhi Metro fire OR protest OR strike OR security'), label: 'Emergency' },
    { url: GN_BASE + encodeURIComponent('Delhi Metro "Rajiv Chowk" OR "Kashmere Gate" OR "Anand Vihar"'), label: 'Hubs' },
    { url: GN_BASE + encodeURIComponent('Delhi Metro "Lajpat Nagar" OR "Hauz Khas" OR "Yamuna Bank"'), label: 'South' },
    { url: GN_BASE + encodeURIComponent('Delhi Metro Noida OR Gurgaon OR Faridabad OR Vaishali'), label: 'NCR' },
    { url: GN_BASE + encodeURIComponent('"Delhi Metro" station maintenance OR upgrade OR work'), label: 'Maintenance' },
  ];

  // ── RSS2JSON proxy (no CORS, returns JSON) ─────────────────────
  // Free tier: 10,000 requests/month ≈ unlimited at 20-min poll
  const R2J = 'https://api.rss2json.com/v1/api.json?count=15&rss_url=';
  // Fallback raw CORS proxy
  const PROXY = 'https://api.allorigins.win/get?url=';

  let pollTimer = null;
  let lastFetch = 0;
  const SEEN = new Set();           // deduplication by item hash
  const FEED_CACHE = {};            // url → {items,ts}
  const POLL_INTERVAL = 20 * 60 * 1000; // 20 minutes

  // ── Keyword → severity map ─────────────────────────────────────
  const KEYWORDS = [
    { re: /bomb|terror|security alert|threat|evacuat/i, boost: 1.65, icon: '🚨', sev: 'security' },
    { re: /fire|smoke|blaze|explosion|casualt|injur/i, boost: 1.55, icon: '🔥', sev: 'emergency' },
    { re: /accident|collision|derail/i, boost: 1.50, icon: '⚠️', sev: 'emergency' },
    { re: /protest|agitation|blockade|march|dharna|strike/i, boost: 1.45, icon: '📢', sev: 'protest' },
    { re: /closure|shut|suspend|halt|suspend|cancel/i, boost: 1.40, icon: '🚫', sev: 'closure' },
    { re: /delay|slow|disrupt|breakdown|technical fault/i, boost: 1.35, icon: '⏱️', sev: 'delay' },
    { re: /maintenance|work|upgrade|repair|inspection/i, boost: 1.18, icon: '🔧', sev: 'maintenance' },
    { re: /crowd|rush|packed|congest|overcrowd|jam/i, boost: 1.30, icon: '👥', sev: 'crowd' },
    { re: /flood|rain|waterlog|storm/i, boost: 1.22, icon: '🌧️', sev: 'weather' },
    { re: /festival|mela|diwali|holi|eid|navratri/i, boost: 1.40, icon: '🎉', sev: 'event' },
    { re: /match|ipl|cricket|concert|event|show/i, boost: 1.35, icon: '🏟️', sev: 'event' },
    { re: /extended|extra|special train|additional service/i, boost: 1.10, icon: '🚇', sev: 'service' },
  ];

  // ── Station name → IDs (keyword → station IDs) ────────────────
  // Build at init from METRO.STATIONS names + manual landmark map
  let stationKwMap = null;
  const LANDMARK_MAP = {
    'connaught': ['RJC', 'BAR'], 'rajiv chowk': ['RJC'], 'cp ': ['RJC'],
    'kashmere gate': ['KAG'], 'kashmiri gate': ['KAG'],
    'new delhi': ['NWD'], 'shivaji stadium': ['SJV'],
    'mandi house': ['MNH'], 'pragati maidan': ['PMD'], 'ito': ['ITO'],
    'karol bagh': ['KRB'], 'kirti nagar': ['KTN'],
    'rajouri garden': ['RJG'], 'janakpuri': ['JAP', 'JNE'],
    'dwarka': ['DWK', 'DW21', 'DWM'], 'dwarka sector 21': ['DW21'],
    'vaishali': ['VAI'], 'anand vihar': ['ANV'], 'kaushambi': ['KSM'],
    'yamuna bank': ['YMB'], 'akshardham': ['AKS'],
    'lajpat nagar': ['LPN'], 'hauz khas': ['HAZ'], 'ina ': ['INA'],
    'aiims': ['AIM'], 'green park': ['GPK'],
    'kalkaji': ['KLK'], 'nehru place': ['NPL', 'NLV'],
    'okhla': ['ONS', 'SKV', 'OP1'], 'kalindi kunj': ['KLJ'],
    'jasola': ['JVS', 'JAM', 'JSV'], 'sarita vihar': ['SVR', 'SRV'],
    'badarpur': ['BDB'], 'faridabad': ['EMJ', 'OFB', 'BKM'],
    'noida': ['N15', 'N16', 'N18', 'NCC', 'NEC'],
    'gurgaon': ['HUD', 'IFC'], 'gurugram': ['HUD', 'IFC'],
    'rohini': ['RHE', 'RHW', 'R18'], 'pitampura': ['PTP'],
    'netaji subhash': ['NJS'], 'punjabi bagh': ['PBW'],
    'welcome': ['WEL'], 'shahdara': ['SHA'], 'dilshad': ['DLG'],
    'botanical garden': ['BOT'], 'airport': ['T1', 'ARC', 'NWD'],
    'aerocity': ['ARC'], 'terminal 1': ['T1'],
    'shiv vihar': ['SVH'], 'gokulpuri': ['GKP'], 'jafrabad': ['JAF'],
    'johri enclave': ['JHE'], 'maujpur': ['MPB'],
    'central secretariat': ['CES'], 'chandni chowk': ['CHC'],
    'sarojini': ['SNR'], 'bhikaji': ['BCP'],
    'greater noida': ['AQPCH', 'AQKP2', 'AQGNW'],
    'majlis park': ['MJP'], 'shalimar bagh': ['SHB'],
    'trilokpuri': ['TRL'],
  };

  function buildStationKwMap() {
    if (stationKwMap) return;
    stationKwMap = {};
    // Add landmark map
    Object.entries(LANDMARK_MAP).forEach(([kw, ids]) => { stationKwMap[kw.toLowerCase().trim()] = ids });
    // Auto-extract from station names (words > 4 chars)
    const skip = new Set(['metro', 'line', 'station', 'phase', 'sector', 'delhi', 'north', 'south', 'east', 'west', 'gate']);
    Object.entries(METRO.STATIONS).forEach(([id, s]) => {
      s.n.toLowerCase().split(/[\s\-,()]+/).filter(w => w.length > 4 && !skip.has(w)).forEach(w => {
        if (!stationKwMap[w]) stationKwMap[w] = [];
        if (!stationKwMap[w].includes(id)) stationKwMap[w].push(id);
      });
    });
  }

  // ── Fetch one RSS feed via rss2json ────────────────────────────
  async function fetchFeed(feedUrl) {
    const now = Date.now();
    const cacheKey = feedUrl;
    // Use cache if fresh (< 18 min)
    if (FEED_CACHE[cacheKey] && now - FEED_CACHE[cacheKey].ts < 18 * 60 * 1000)
      return FEED_CACHE[cacheKey].items;

    let items = [];

    // Method 1: rss2json.com (clean JSON, handles CORS)
    try {
      const r = await fetch(R2J + encodeURIComponent(feedUrl),
        { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const d = await r.json();
        if (d.status === 'ok' && d.items?.length) {
          items = d.items.map(i => ({
            title: i.title || '',
            desc: i.description || i.content || '',
            link: i.link || i.guid || '',
            pubDate: i.pubDate || i.published || '',
            source: i.author || d.feed?.title || 'Google News',
          }));
          FEED_CACHE[cacheKey] = { items, ts: now };
          return items;
        }
      }
    } catch (_) { }

    // Method 2: allorigins raw XML → DOMParser
    try {
      const r = await fetch(PROXY + encodeURIComponent(feedUrl),
        { signal: AbortSignal.timeout(12000) });
      if (r.ok) {
        const { contents } = await r.json();
        const parser = new DOMParser();
        const xml = parser.parseFromString(contents, 'text/xml');
        const els = [...xml.querySelectorAll('item')];
        items = els.map(el => ({
          title: el.querySelector('title')?.textContent?.replace(/<[^>]*>/g, '') || '',
          desc: el.querySelector('description')?.textContent?.replace(/<[^>]*>/g, '') || '',
          link: el.querySelector('link')?.textContent ||
            el.querySelector('guid')?.textContent || '',
          pubDate: el.querySelector('pubDate')?.textContent || '',
          source: el.querySelector('source')?.textContent || 'Google News',
        }));
        FEED_CACHE[cacheKey] = { items, ts: now };
      }
    } catch (_) { }

    return items;
  }

  // ── Parse one RSS item into a crowd event ──────────────────────
  function parseItem(item) {
    const fullText = ((item.title || '') + ' ' + (item.desc || '')).toLowerCase();

    // Must mention metro/DMRC to avoid false positives
    if (!/metro|dmrc|delhi rail/i.test(fullText)) return null;

    // Unique ID from title hash
    const uid = 'rss_' + Math.abs([...(item.title + 'rss')].reduce(
      (h, c) => Math.imul(31, h) + c.charCodeAt(0) | 0, 0)).toString(36);
    if (SEEN.has(uid)) return null;

    // Age filter: skip articles older than 18 hours
    const pubTs = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();
    const ageMs = Date.now() - pubTs;
    if (ageMs > 18 * 3600 * 1000) return null;

    // Detect keyword → severity
    let boost = 1.10, icon = '📰', sev = 'info';
    for (const kw of KEYWORDS) {
      if (kw.re.test(fullText)) { boost = kw.boost; icon = kw.icon; sev = kw.sev; break }
    }

    // Map to affected stations
    buildStationKwMap();
    const affected = new Set();
    Object.entries(stationKwMap).forEach(([kw, ids]) => {
      if (fullText.includes(kw)) ids.forEach(id => { if (METRO.STATIONS[id]) affected.add(id) });
    });

    // Auto-activate if severity ≥ delay and affects at least one station
    const autoActive = (sev !== 'info' && sev !== 'service') && boost >= 1.25 && affected.size > 0;

    SEEN.add(uid);
    const ts = new Date(pubTs);
    return {
      id: uid,
      name: (item.title || '').replace(/<[^>]*>/g, '').slice(0, 90),
      icon, boost, sev, active: autoActive,
      affected: [...affected].slice(0, 12),
      detail: (item.desc || '').replace(/<[^>]*>/g, '').slice(0, 130),
      source: item.source || 'Google News',
      url: item.link || '',
      time: ts.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      date: ts.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
      ageMs, _news: true,
    };
  }

  // ── Main poll cycle ────────────────────────────────────────────
  async function fetchCycle() {
    const now = Date.now();
    if (now - lastFetch < 60000) return; // minimum 60s between cycles
    lastFetch = now;

    setStatus('🔄 Scanning Google News RSS…');
    const newEvents = [];
    let totalItems = 0;

    for (const feed of FEEDS) {
      try {
        const items = await fetchFeed(feed.url);
        totalItems += items.length;
        items.forEach(item => {
          const ev = parseItem(item);
          if (ev) newEvents.push(ev);
        });
      } catch (_) { }
      // Stagger requests to be polite
      await sleep(300);
    }

    // Merge with existing, drop old ones (>18h)
    const existing = CROWD.state.newsEvents.filter(e => !e._news || (Date.now() - e.ageMs < 18 * 3600 * 1000));
    const existingIds = new Set(existing.map(e => e.id));
    const merged = [...existing];
    newEvents.forEach(ev => { if (!existingIds.has(ev.id)) merged.push(ev) });

    // Sort: active→by severity→by recency
    const sevOrder = { security: 0, emergency: 1, closure: 2, protest: 3, delay: 4, crowd: 5, event: 6, maintenance: 7, weather: 8, service: 9, info: 10 };
    merged.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      const sd = (sevOrder[a.sev] || 9) - (sevOrder[b.sev] || 9);
      if (sd !== 0) return sd;
      return (a.ageMs || 0) - (b.ageMs || 0);
    });

    CROWD.state.newsEvents = merged.slice(0, 40);
    const activeN = merged.filter(e => e.active).length;
    const t = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    setStatus(`${totalItems} headlines scanned · ${merged.length} events · ${activeN} active · ${t}`);
    updateBadge(activeN, merged.length);

    // Ticker for urgent events
    const urgent = merged.filter(e => e.active && ['security', 'emergency', 'closure', 'protest', 'delay'].includes(e.sev));
    const ticker = document.getElementById('ticker');
    const tickerInner = document.getElementById('ticker-inner');
    if (ticker && tickerInner) {
      if (urgent.length) {
        tickerInner.textContent = '📡 LIVE · ' + urgent.map(e => `${e.icon} ${e.name}`).join('   ·   ');
        ticker.style.display = 'block';
      } else {
        ticker.style.display = 'none';
      }
    }

    // Trigger crowd refresh
    if (typeof CROWD !== 'undefined') {
      CROWD.recomputeAll();
      if (typeof MAP !== 'undefined') MAP.updateMarkers();
      if (typeof UI !== 'undefined') { UI.updateHeader(); UI.refreshIfActive('events') }
    }
    console.log(`[NEWS] ${totalItems} items → ${newEvents.length} new events · ${activeN} active`);
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

  function setStatus(txt) {
    const el = document.getElementById('news-status'); if (el) el.textContent = txt;
  }

  function updateBadge(active, total) {
    const etxt = document.getElementById('etxt'), edot = document.getElementById('edot');
    if (etxt) etxt.textContent = active > 0 ? `${active} Alerts Active` : `${total} News Events`;
    if (edot) edot.style.background = active > 0 ? '#FF6B00' : '#E040FB';
  }

  function start() {
    fetchCycle(); // immediate first fetch
    clearInterval(pollTimer);
    pollTimer = setInterval(fetchCycle, POLL_INTERVAL);
    console.log(`[NEWS] Polling every ${POLL_INTERVAL / 60000} min via Google News RSS`);
  }

  function stop() { clearInterval(pollTimer); pollTimer = null }

  return { start, stop, fetchCycle, setStatus };
})();