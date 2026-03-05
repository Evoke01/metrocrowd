// ══════════════════════════════════════════════════════════════════
//  NEWS ENGINE v5 — Smart Relevance Pipeline
//
//  Pipeline:
//   RSS Article
//     ↓ 1. DMRC relevance gate  (must mention metro/DMRC)
//     ↓ 2. Surge keyword filter (must contain operational signals)
//     ↓ 3. Event classification (operational vs informational)
//     ↓ 4. Station detection    (specific station OR network fallback)
//     ↓ 5. Boost calculation    (severity_weight × recency_decay)
//     ↓ Add to crowd model only if category = operational
// ══════════════════════════════════════════════════════════════════
window.NEWS=(function(){

  // ── RSS Feed URLs ─────────────────────────────────────────────
  const GN='https://news.google.com/rss/search?hl=en-IN&gl=IN&ceid=IN:en&q=';
  const FEEDS=[
    {url:GN+encodeURIComponent('Delhi Metro delay OR disruption OR accident OR breakdown'),      label:'Disruptions'},
    {url:GN+encodeURIComponent('Delhi Metro crowd OR rush hour OR overcrowded OR congestion'),   label:'Crowd'},
    {url:GN+encodeURIComponent('Delhi Metro protest OR strike OR shutdown OR blockade'),          label:'Protest'},
    {url:GN+encodeURIComponent('Delhi Metro fire OR security alert OR evacuation OR stampede'),   label:'Emergency'},
    {url:GN+encodeURIComponent('Delhi Metro OR DMRC incident OR closure OR suspended service'),   label:'Incidents'},
    {url:GN+encodeURIComponent('Delhi Metro "Rajiv Chowk" OR "Kashmere Gate" OR "Anand Vihar"'), label:'Hubs'},
    {url:GN+encodeURIComponent('Delhi Metro Noida OR Gurgaon OR Faridabad'),                      label:'NCR'},
    {url:GN+encodeURIComponent('DMRC OR "Delhi Metro Rail Corporation"'),                         label:'DMRC'},
  ];

  const R2J  ='https://api.rss2json.com/v1/api.json?count=15&rss_url=';
  const PROXY='https://api.allorigins.win/get?url=';

  let pollTimer=null, lastFetch=0;
  const SEEN={};             // uid → true (dedup)
  const FEED_CACHE={};       // url → {items,ts}
  const POLL_INTERVAL=20*60*1000;

  // ══════════════════════════════════════════════════════════════
  //  STEP 1 — DMRC RELEVANCE GATE
  //  Article must mention metro/DMRC at all — hard filter
  // ══════════════════════════════════════════════════════════════
  const METRO_RE=/\b(metro|dmrc|delhi metro rail|delhi rail)\b/i;

  // ══════════════════════════════════════════════════════════════
  //  STEP 2 — SURGE KEYWORD FILTER
  //  Article must contain at least one operational signal word
  //  to even be considered as a crowd event.
  //  Pure informational articles (inaugurations, policy, speeches)
  //  are DISPLAY-ONLY — they never touch the crowd model.
  // ══════════════════════════════════════════════════════════════
  const SURGE_KEYWORDS=[
    // Physical disruption
    'delay','delayed','delays',
    'breakdown','broke down','technical fault','technical snag',
    'disruption','disrupted','service disruption',
    'suspension','suspended','service suspended','halt','halted',
    'shutdown','shut down','closed','closure',
    'accident','collision','derail','derailed',
    'incident','emergency',
    // Crowd signals
    'crowd','crowded','overcrowded','overcrowding',
    'rush hour','rush-hour','packed','congestion','congested',
    'jam','jammed','overflowing','heavy footfall',
    'long queue','long lines','serpentine queue',
    'stampede','crush',
    // Security / civil unrest
    'security alert','bomb threat','evacuation','evacuated',
    'protest','protester','agitation','blockade','dharna','march',
    'strike','bandh','shutdown','gherao',
    // Natural disruption
    'waterlogging','waterlogged','flood','flooded','rain','storm',
    // Fire / safety
    'fire','smoke','blaze','explosion',
    // Service-level
    'cancelled','cancellation','rerouted','diversion',
    'extra train','special train','additional service',
  ];

  // Build a single regex from surge keywords for fast matching
  const SURGE_RE = new RegExp(
    SURGE_KEYWORDS.map(k=>k.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&')).join('|'),
    'i'
  );

  // ══════════════════════════════════════════════════════════════
  //  STEP 3 — EVENT CLASSIFICATION TABLE
  //
  //  category: 'operational'   → boosts crowd model + shown in news tab
  //            'informational' → shown in news tab only (boost = 1.0)
  //
  //  Each rule: { re, category, sev, baseBoost, icon, label }
  //  Checked in priority order — first match wins.
  // ══════════════════════════════════════════════════════════════
  const CLASSIFICATION=[

    // ── INFORMATIONAL — no crowd effect ───────────────────────
    // These must come FIRST so they don't accidentally match
    // operational patterns below (e.g. "inauguration" ≠ disruption)
    {
      re:/inaugurat|ribbon.cut|launch.ceremon|flag.off|dedic[ae]t|commision|open.to.public/i,
      category:'informational', sev:'announcement', baseBoost:1.0,
      icon:'🎀', label:'Inauguration',
    },
    {
      re:/policy|budget|fare.hike|fare.revision|annual.report|masterplan|blueprint|tender|contract.award/i,
      category:'informational', sev:'announcement', baseBoost:1.0,
      icon:'📋', label:'Policy / Admin',
    },
    {
      re:/construction.plan|new.line|phase.\d|extension.plan|proposed|survey|feasibility|dpr\b/i,
      category:'informational', sev:'announcement', baseBoost:1.0,
      icon:'🏗️', label:'Expansion Plan',
    },
    {
      re:/speech|address|statement|press.conference|minister.said|official.said|md.said|ceo.said/i,
      category:'informational', sev:'announcement', baseBoost:1.0,
      icon:'🗣️', label:'Official Statement',
    },
    {
      re:/award|recogni[sz]|rank|honour|accolade|certif[yi]/i,
      category:'informational', sev:'announcement', baseBoost:1.0,
      icon:'🏆', label:'Award / Recognition',
    },
    {
      re:/app.update|new.feature|digital|qr.code|card.launch|token/i,
      category:'informational', sev:'announcement', baseBoost:1.0,
      icon:'📱', label:'Tech / Digital',
    },

    // ── OPERATIONAL — affects crowd model ─────────────────────
    {
      re:/bomb|terror|security.alert|threat|evacuat|stampede/i,
      category:'operational', sev:'security', baseBoost:1.65,
      icon:'🚨', label:'Security Alert',
    },
    {
      re:/fire|smoke|blaze|explosion|casualt|injur/i,
      category:'operational', sev:'emergency', baseBoost:1.55,
      icon:'🔥', label:'Fire / Emergency',
    },
    {
      re:/accident|collision|derail/i,
      category:'operational', sev:'emergency', baseBoost:1.50,
      icon:'⚠️', label:'Accident',
    },
    {
      re:/protest|agitation|blockade|dharna|bandh|gherao/i,
      category:'operational', sev:'protest', baseBoost:1.45,
      icon:'📢', label:'Protest / Agitation',
    },
    {
      re:/strike\b|work.stop|walk.?out/i,
      category:'operational', sev:'protest', baseBoost:1.42,
      icon:'✊', label:'Strike',
    },
    {
      re:/suspend|shutdown|shut.down|service.halt|halt|closed.for|out.of.service/i,
      category:'operational', sev:'closure', baseBoost:1.40,
      icon:'🚫', label:'Closure / Suspension',
    },
    {
      re:/delay|delayed|slow.movement|go-slow|signal.fail|power.fail|technical.fault|technical.snag|breakdown/i,
      category:'operational', sev:'delay', baseBoost:1.35,
      icon:'⏱️', label:'Delay / Breakdown',
    },
    {
      re:/crowd|overcrowd|heavy.footfall|rush.hour|packed|congest|long.queue|serpentine|overflowing/i,
      category:'operational', sev:'crowd', baseBoost:1.30,
      icon:'👥', label:'Crowd Surge',
    },
    {
      re:/waterlog|flood|rain.disrupt|storm.disrupt/i,
      category:'operational', sev:'weather', baseBoost:1.25,
      icon:'🌧️', label:'Weather Disruption',
    },
    {
      re:/festival|mela|diwali|holi|eid|navratri|republic.day|independence.day/i,
      category:'operational', sev:'event', baseBoost:1.38,
      icon:'🎉', label:'Festival / Event',
    },
    {
      re:/ipl|cricket.match|concert|stadium.event|rally/i,
      category:'operational', sev:'event', baseBoost:1.35,
      icon:'🏟️', label:'Sports / Concert',
    },
    {
      re:/diversion|reroute|extra.train|special.train|additional.service/i,
      category:'operational', sev:'service', baseBoost:1.12,
      icon:'🚇', label:'Service Change',
    },
    {
      re:/maintenance|inspection|scheduled.work|track.work/i,
      category:'operational', sev:'maintenance', baseBoost:1.08,
      icon:'🔧', label:'Maintenance',
    },
  ];

  // ══════════════════════════════════════════════════════════════
  //  STEP 4 — STATION DETECTION
  //  If no station found → network_event (small boost, interchanges only)
  // ══════════════════════════════════════════════════════════════
  let stationKwMap=null;

  const LANDMARK_MAP={
    'rajiv chowk':['RJC'],'connaught place':['RJC','BAR'],'cp ':['RJC'],
    'kashmere gate':['KAG'],'kashmiri gate':['KAG'],
    'new delhi':['NWD'],'shivaji stadium':['SJV'],
    'mandi house':['MNH'],'pragati maidan':['PMD'],'ito':['ITO'],
    'karol bagh':['KRB'],'kirti nagar':['KTN'],
    'rajouri garden':['RJG'],'janakpuri':['JAP','JNE'],
    'dwarka sector 21':['DW21'],'dwarka':['DWK','DW21','DWM'],
    'vaishali':['VAI'],'anand vihar':['ANV'],'kaushambi':['KSM'],
    'yamuna bank':['YMB'],'akshardham':['AKS'],
    'lajpat nagar':['LPN'],'hauz khas':['HAZ'],'ina ':['INA'],
    'aiims':['AIM'],'green park':['GPK'],
    'kalkaji':['KLK'],'nehru place':['NPL','NLV'],
    'okhla':['ONS','SKV','OP1'],'kalindi kunj':['KLJ'],
    'jasola':['JVS','JAM','JSV'],'sarita vihar':['SVR','SRV'],
    'badarpur':['BDB'],'faridabad':['EMJ','OFB','BKM','S28'],
    'noida':['N15','N16','N18','NCC','NEC','BOT'],
    'gurgaon':['HUD','IFC'],'gurugram':['HUD','IFC'],
    'rohini':['RHE','RHW','R18'],'pitampura':['PTP'],
    'netaji subhash':['NJS'],'punjabi bagh':['PBW'],
    'welcome':['WEL'],'shahdara':['SHA'],'dilshad garden':['DLG'],
    'botanical garden':['BOT'],'airport':['T1','ARC','NWD'],
    'aerocity':['ARC'],'terminal 1':['T1'],'igi':['T1','ARC'],
    'shiv vihar':['SVH'],'gokulpuri':['GKP'],'jafrabad':['JAF'],
    'johri enclave':['JHE'],'maujpur':['MPB'],
    'central secretariat':['CES'],'chandni chowk':['CHC'],
    'sarojini nagar':['SNR'],'bhikaji cama':['BCP'],
    'greater noida':['AQPCH','AQKP2','AQGNW'],
    'majlis park':['MJP'],'shalimar bagh':['SHB'],
    'trilokpuri':['TRL'],'lal quila':['LQL'],'red fort':['LQL'],
    'jama masjid':['JMS'],'india gate':['CES','MNH'],
    'khan market':['KMK'],'jln stadium':['JNS'],
    'botanical':['BOT'],'sector 18':['N18'],
  };

  function buildStationKwMap(){
    if(stationKwMap) return;
    stationKwMap={};
    Object.entries(LANDMARK_MAP).forEach(([kw,ids])=>{
      stationKwMap[kw.toLowerCase().trim()]=ids;
    });
    const skip=new Set(['metro','line','station','phase','sector','delhi',
      'north','south','east','west','gate','park','nagar','vihar','road',
      'place','enclave','market','house','garden','bazar','chowk']);
    Object.entries(METRO.STATIONS).forEach(([id,s])=>{
      s.n.toLowerCase()
        .split(/[\s\-,()\/]+/)
        .filter(w=>w.length>4&&!skip.has(w)&&!/^\d+$/.test(w))
        .forEach(w=>{
          if(!stationKwMap[w]) stationKwMap[w]=[];
          if(!stationKwMap[w].includes(id)) stationKwMap[w].push(id);
        });
    });
  }

  function detectStations(text){
    buildStationKwMap();
    const found=new Set();
    // Check multi-word landmarks first (longest match wins)
    const sorted=Object.keys(stationKwMap).sort((a,b)=>b.length-a.length);
    for(const kw of sorted){
      if(text.includes(kw)) stationKwMap[kw].forEach(id=>{
        if(METRO.STATIONS[id]) found.add(id);
      });
    }
    return [...found];
  }

  // Interchange station IDs for network-level fallback
  function getInterchangeIds(){
    return Object.entries(METRO.STATIONS)
      .filter(([,s])=>s.ix||s.hot)
      .map(([id])=>id);
  }

  // ══════════════════════════════════════════════════════════════
  //  STEP 5 — BOOST CALCULATION
  //
  //  Formula: boost = severity_weight × news_count_factor × recency_decay
  //
  //  severity_weight  = baseBoost defined per classification rule
  //                     delay=1.35, protest=1.45, security=1.65 etc.
  //
  //  news_count_factor = how many corroborating articles exist for
  //                      the same severity × station bucket.
  //                      Prevents a single obscure headline from
  //                      spiking a station by 40%.
  //                      1 article  → ×1.00  (no multiplier)
  //                      2 articles → ×1.06
  //                      3 articles → ×1.12
  //                      4 articles → ×1.18
  //                      5+ articles→ ×1.24  (cap)
  //
  //  recency_decay     = 1.0 at 0h → 0.55 at 18h (linear)
  //                      Fresh news carries full weight.
  //                      18-hour-old article is 55% as impactful.
  //
  //  Final boost is capped at 1.70 (max +70% crowd surge).
  //  Informational events always have boost = 1.0 (no effect).
  // ══════════════════════════════════════════════════════════════
  const MAX_AGE_MS=18*3600*1000;

  // Defined severity weights (matches classification baseBoost values)
  // These are the single-source weights. Multi-source amplifies via news_count_factor.
  const SEV_WEIGHTS={
    security:1.65, emergency:1.55, closure:1.40,
    protest:1.45,  delay:1.35,     crowd:1.30,
    event:1.38,    weather:1.25,   service:1.12,
    maintenance:1.08, announcement:1.0,
  };

  function recencyDecay(ageMs){
    return Math.max(0.55, 1-(ageMs/MAX_AGE_MS)*0.45);
  }

  function newsCountFactor(count){
    // 1.0 base, +0.06 per additional corroborating article, cap at 1.24
    return 1.0 + Math.min(count-1, 4) * 0.06;
  }

  // Called per-item during processItem — uses newsCount=1 placeholder.
  // fetchCycle re-applies final boost after counting corroborating articles.
  function calcBoost(baseBoost, ageMs, newsCount=1){
    const sw    = baseBoost;                  // severity weight
    const ncf   = newsCountFactor(newsCount); // news corroboration factor
    const decay = recencyDecay(ageMs);        // recency factor
    const raw   = sw * ncf * decay;
    return Math.min(1.70, Math.max(1.01, +raw.toFixed(3)));
  }

  // Re-score boost for all events after full cycle, using corroboration counts.
  // Groups events by sev × station overlap to find how many articles agree.
  function applyNewsCountBoosts(events){
    // Build station→[event] index for fast overlap checking
    const stationIndex={};
    events.forEach((ev,i)=>{
      if(ev.category!=='operational') return;
      (ev.affected||[]).forEach(sid=>{
        if(!stationIndex[sid]) stationIndex[sid]=[];
        stationIndex[sid].push(i);
      });
    });

    events.forEach((ev,i)=>{
      if(ev.category!=='operational'||!ev._baseBoost) return;

      // Count how many other operational events share the same sev and ≥1 station
      const sharedSet=new Set();
      (ev.affected||[]).forEach(sid=>{
        (stationIndex[sid]||[]).forEach(j=>{
          if(j!==i && events[j].sev===ev.sev && events[j].category==='operational'){
            sharedSet.add(j);
          }
        });
      });
      const newsCount=1+sharedSet.size;  // self + corroborating articles

      ev.newsCount = newsCount;
      ev.boost     = calcBoost(ev._baseBoost, ev.ageMs, newsCount);
      ev.boostBreakdown = {
        severityWeight: +ev._baseBoost.toFixed(3),
        newsCountFactor:+newsCountFactor(newsCount).toFixed(3),
        recencyDecay:   +recencyDecay(ev.ageMs).toFixed(3),
        newsCount,
      };
    });

    return events;
  }

  // ══════════════════════════════════════════════════════════════
  //  RSS FETCH LAYER (unchanged from v4)
  // ══════════════════════════════════════════════════════════════
  async function fetchFeed(feedUrl){
    const now=Date.now();
    if(FEED_CACHE[feedUrl]&&now-FEED_CACHE[feedUrl].ts<18*60*1000)
      return FEED_CACHE[feedUrl].items;

    let items=[];

    try{
      const r=await fetch(R2J+encodeURIComponent(feedUrl),{signal:AbortSignal.timeout(8000)});
      if(r.ok){
        const d=await r.json();
        if(d.status==='ok'&&d.items?.length){
          items=d.items.map(i=>({
            title:i.title||'',
            desc: i.description||i.content||'',
            link: i.link||i.guid||'',
            pubDate:i.pubDate||i.published||'',
            source:i.author||d.feed?.title||'Google News',
          }));
          FEED_CACHE[feedUrl]={items,ts:now};
          return items;
        }
      }
    }catch(_){}

    try{
      const r=await fetch(PROXY+encodeURIComponent(feedUrl),{signal:AbortSignal.timeout(12000)});
      if(r.ok){
        const {contents}=await r.json();
        const parser=new DOMParser();
        const xml=parser.parseFromString(contents,'text/xml');
        items=[...xml.querySelectorAll('item')].map(el=>({
          title:   el.querySelector('title')?.textContent?.replace(/<[^>]*>/g,'')||'',
          desc:    el.querySelector('description')?.textContent?.replace(/<[^>]*>/g,'')||'',
          link:    el.querySelector('link')?.textContent||el.querySelector('guid')?.textContent||'',
          pubDate: el.querySelector('pubDate')?.textContent||'',
          source:  el.querySelector('source')?.textContent||'Google News',
        }));
        FEED_CACHE[feedUrl]={items,ts:now};
      }
    }catch(_){}

    return items;
  }

  // ══════════════════════════════════════════════════════════════
  //  MAIN PIPELINE — process one RSS item
  // ══════════════════════════════════════════════════════════════
  function processItem(item){
    const raw=((item.title||'')+' '+(item.desc||''));
    const text=raw.toLowerCase();

    // ── GATE 1: Must mention metro / DMRC ─────────────────────
    if(!METRO_RE.test(text)) return null;

    // ── Deduplication ─────────────────────────────────────────
    const uid='n5_'+Math.abs([...(item.title+'x5')].reduce(
      (h,c)=>Math.imul(31,h)+c.charCodeAt(0)|0,0)).toString(36);
    if(SEEN[uid]) return null;

    // ── Age filter ────────────────────────────────────────────
    const pubTs=item.pubDate?new Date(item.pubDate).getTime():Date.now();
    const ageMs=Date.now()-pubTs;
    if(ageMs>MAX_AGE_MS) return null;

    // ── GATE 2: Surge keyword filter ──────────────────────────
    // Informational articles won't have surge words → skip as events
    // but we still classify them and show them as info-only
    const hasSurge=SURGE_RE.test(text);

    // ── STEP 3: Classify ──────────────────────────────────────
    let cls=null;
    for(const rule of CLASSIFICATION){
      if(rule.re.test(text)){ cls=rule; break; }
    }

    // If no classification matched, fall back to generic informational
    if(!cls){
      cls={
        category: hasSurge ? 'operational' : 'informational',
        sev:      hasSurge ? 'delay' : 'announcement',
        baseBoost:hasSurge ? 1.10 : 1.0,
        icon:     hasSurge ? '📰' : 'ℹ️',
        label:    hasSurge ? 'General Disruption' : 'General News',
      };
    }

    // Informational articles that have no surge signal → display only, no boost
    if(cls.category==='informational' && !hasSurge){
      // Still create event for news tab display, but boost=1.0, active=false
      SEEN[uid]=true;
      const ts=new Date(pubTs);
      return {
        id:uid,
        name:(item.title||'').replace(/<[^>]*>/g,'').slice(0,90),
        icon:cls.icon, boost:1.0, sev:cls.sev,
        category:'informational',
        active:false,
        affected:[],
        networkEvent:false,
        detail:(item.desc||'').replace(/<[^>]*>/g,'').slice(0,130),
        source:item.source||'Google News',
        url:item.link||'',
        label:cls.label,
        time:ts.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}),
        date:ts.toLocaleDateString('en-IN',{month:'short',day:'numeric'}),
        ageMs,_news:true,
      };
    }

    // ── STEP 4: Station detection ──────────────────────────────
    const stationIds=detectStations(text);
    let affected=stationIds;
    let networkEvent=false;

    if(affected.length===0){
      // No station mentioned → network-level event
      // Small boost applied to interchange stations only
      affected=getInterchangeIds();
      networkEvent=true;
      // Reduce boost for network events (can't pinpoint, so less certain)
      cls={...cls, baseBoost: Math.min(cls.baseBoost, 1.15)};
    }

    // ── STEP 5: Calculate boost with recency decay ─────────────
    // newsCount=1 placeholder — fetchCycle re-applies after counting
    const boost=calcBoost(cls.baseBoost, ageMs, 1);

    // Auto-activate: operational + has surge + boost is meaningful
    const sevOrder={security:0,emergency:1,closure:2,protest:3,delay:4,crowd:5,event:6,weather:7,service:8,maintenance:9};
    const highSev=(sevOrder[cls.sev]||9)<=4; // security → delay auto-activate
    const autoActive=cls.category==='operational' && boost>1.12 && (stationIds.length>0 || (highSev&&networkEvent));

    SEEN[uid]=true;
    const ts=new Date(pubTs);
    return{
      id:uid,
      name:(item.title||'').replace(/<[^>]*>/g,'').slice(0,90),
      icon:cls.icon, boost, sev:cls.sev,
      _baseBoost:cls.baseBoost,   // stored for re-scoring in fetchCycle
      newsCount:1,                // updated by applyNewsCountBoosts
      boostBreakdown:{            // populated by applyNewsCountBoosts
        severityWeight:cls.baseBoost,
        newsCountFactor:1.0,
        recencyDecay:+recencyDecay(ageMs).toFixed(3),
        newsCount:1,
      },
      category:cls.category,
      label:cls.label,
      active:autoActive,
      affected:affected.slice(0,14),
      networkEvent,
      stationCount:stationIds.length,
      detail:(item.desc||'').replace(/<[^>]*>/g,'').slice(0,130),
      source:item.source||'Google News',
      url:item.link||'',
      time:ts.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}),
      date:ts.toLocaleDateString('en-IN',{month:'short',day:'numeric'}),
      ageMs,_news:true,
    };
  }

  // ══════════════════════════════════════════════════════════════
  //  POLL CYCLE
  // ══════════════════════════════════════════════════════════════
  async function fetchCycle(){
    const now=Date.now();
    if(now-lastFetch<60000) return;
    lastFetch=now;

    setStatus('🔄 Scanning Google News RSS…');
    const newEvents=[];
    let totalScanned=0, filtered=0;

    for(const feed of FEEDS){
      try{
        const items=await fetchFeed(feed.url);
        totalScanned+=items.length;
        items.forEach(item=>{
          const ev=processItem(item);
          if(ev){ newEvents.push(ev); }
          else{ filtered++; }
        });
      }catch(_){}
      await sleep(300);
    }

    // Merge + expire old
    const existing=CROWD.state.newsEvents.filter(e=>
      !e._news||(Date.now()-(e.ageMs||0)<MAX_AGE_MS));
    const existingIds=new Set(existing.map(e=>e.id));
    const merged=[...existing];
    newEvents.forEach(ev=>{if(!existingIds.has(ev.id))merged.push(ev)});

    // ── Re-score boosts using corroboration counts ─────────────
    // Now that we have the full merged set, count how many articles
    // share the same severity + station bucket and update boost accordingly.
    applyNewsCountBoosts(merged.filter(e=>e.category==='operational'));

    // Sort: active → operational → severity → recency
    const sevOrder={security:0,emergency:1,closure:2,protest:3,delay:4,crowd:5,event:6,weather:7,maintenance:8,service:9,announcement:10};
    merged.sort((a,b)=>{
      if(a.active!==b.active) return a.active?-1:1;
      if(a.category!==b.category) return a.category==='operational'?-1:1;
      const sd=(sevOrder[a.sev]||9)-(sevOrder[b.sev]||9);
      if(sd!==0) return sd;
      return(a.ageMs||0)-(b.ageMs||0);
    });

    CROWD.state.newsEvents=merged.slice(0,50);

    const operational=merged.filter(e=>e.category==='operational');
    const activeN=merged.filter(e=>e.active).length;
    const t=new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});

    setStatus(
      `${totalScanned} scanned · ${filtered} filtered · `+
      `${operational.length} operational · ${activeN} active · ${t}`
    );
    updateBadge(activeN, operational.length);

    // Cache to Supabase (operational only)
    if(typeof SB!=='undefined'&&SB.isReady&&newEvents.length){
      SB.cacheNewsEvents(newEvents.filter(e=>e.category==='operational'));
    }

    // Ticker: urgent operational events
    const urgent=merged.filter(e=>
      e.active && e.category==='operational' &&
      ['security','emergency','closure','protest','delay'].includes(e.sev));
    const ticker=document.getElementById('ticker');
    const tickerInner=document.getElementById('ticker-inner');
    if(ticker&&tickerInner){
      if(urgent.length){
        tickerInner.textContent='📡 LIVE · '+urgent.map(e=>`${e.icon} ${e.name}`).join('   ·   ');
        ticker.style.display='block';
      }else{
        ticker.style.display='none';
      }
    }

    if(typeof CROWD!=='undefined'){
      CROWD.recomputeAll();
      if(typeof MAP!=='undefined') MAP.updateMarkers();
      if(typeof UI!=='undefined'){ UI.updateHeader(); UI.refreshIfActive('events'); }
    }

    console.log(
      `[NEWS v5] ${totalScanned} scanned → `+
      `${filtered} rejected by gates · `+
      `${newEvents.filter(e=>e.category==='operational').length} operational · `+
      `${newEvents.filter(e=>e.category==='informational').length} informational · `+
      `${activeN} auto-active`
    );
  }

  function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

  function setStatus(txt){
    const el=document.getElementById('news-status');if(el)el.textContent=txt;
  }

  function updateBadge(active,operational){
    const etxt=document.getElementById('etxt'),edot=document.getElementById('edot');
    if(etxt) etxt.textContent=active>0?`${active} Alerts Active`:`${operational} Operational Events`;
    if(edot) edot.style.background=active>0?'#FF6B00':'#E040FB';
  }

  function start(){
    fetchCycle();
    clearInterval(pollTimer);
    pollTimer=setInterval(fetchCycle,POLL_INTERVAL);
    console.log(`[NEWS v5] Polling every ${POLL_INTERVAL/60000}min — smart pipeline active`);
  }
  function stop(){clearInterval(pollTimer);pollTimer=null}

  return{start,stop,fetchCycle,setStatus};
})();
