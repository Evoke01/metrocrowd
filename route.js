// ══════════════════════════════════════════════════════════════════
//  ROUTE ENGINE v4
//  Fixes: Pink/Magenta edge-line confusion, GPS distance-based fares
//  (Aug 2025 DMRC fare revision), redesigned result UI
// ══════════════════════════════════════════════════════════════════
window.ROUTE=(function(){
  let graph=null;
  const EDGE_LINE={};   // 'A→B' → line code

  // ── LINE_PATH key → canonical line code ──────────────────────
  // Explicit map prevents prefix-match ambiguity (P* vs PWEL, etc.)
  const PATH_KEY_LINE={
    Y:'Y',
    BW:'B',BE:'B',BNE:'B',BSE:'B',
    RW:'R',RE:'R',
    GA:'G',GB:'G',GC:'G',
    // Pink paths — ALL must map to 'P', not confused with Magenta
    PNW:'P',PW:'P',PE:'P',PNE:'P',PTR:'P',PWEL:'P',PAZ:'P',
    // Magenta — single key, no prefix clash
    M:'M',
    VN:'V',VITO:'V',VS:'V',
    A:'A',Gr:'Gr',Aq:'Aq',
  };

  function keyToLine(key){
    if(PATH_KEY_LINE[key]) return PATH_KEY_LINE[key];
    // fallback: single-char keys (Y,B,R,G,P,M,V,A)
    if(key.length===1) return key;
    return 'B';
  }

  function ensureGraph(){
    if(graph) return;
    graph=METRO.buildGraph();
    Object.entries(METRO.LINE_PATHS).forEach(([key,path])=>{
      const lc=keyToLine(key);
      for(let i=0;i<path.length-1;i++){
        const a=path[i],b=path[i+1];
        if(!METRO.STATIONS[a]||!METRO.STATIONS[b]) continue;
        const k1=a+'→'+b, k2=b+'→'+a;
        if(!EDGE_LINE[k1]) EDGE_LINE[k1]=lc;
        if(!EDGE_LINE[k2]) EDGE_LINE[k2]=lc;
      }
    });
  }

  // ── Segment line: prefer EDGE_LINE, then shared line ─────────
  function segmentLine(a,b){
    return EDGE_LINE[a+'→'+b] || EDGE_LINE[b+'→'+a] || sharedLine(a,b) || 'B';
  }

  function sharedLine(a,b){
    const sa=METRO.STATIONS[a]?.l||[];
    const sb=METRO.STATIONS[b]?.l||[];
    // Prefer the line that both stations actually share in LINE_PATHS order
    for(const l of sa){ if(sb.includes(l)) return l; }
    return sa[0]||'B';
  }

  // ── Build colored segments ────────────────────────────────────
  function buildSegments(path){
    if(!path||path.length<2) return [];
    const segs=[];
    let curLine=segmentLine(path[0],path[1]),segStart=0;
    for(let i=1;i<path.length;i++){
      const nextLine=i<path.length-1?segmentLine(path[i],path[i+1]):curLine;
      if(nextLine!==curLine||i===path.length-1){
        segs.push({ids:path.slice(segStart,i+1),line:curLine});
        segStart=i; curLine=nextLine;
      }
    }
    return segs;
  }

  // ── BFS with optional crowd avoidance ────────────────────────
  function bfs(from,to,avoidPacked){
    ensureGraph();
    if(!from||!to||from===to) return null;
    if(!METRO.STATIONS[from]||!METRO.STATIONS[to]) return null;
    const vis=new Set([from]);
    const q=[[from,[from]]];
    while(q.length){
      const[cur,path]=q.shift();
      if(cur===to) return path;
      let nb=[...(graph[cur]||[])];
      if(avoidPacked) nb.sort((a,b)=>(CROWD.state.crowdMap[a]||0)-(CROWD.state.crowdMap[b]||0));
      for(const n of nb){
        if(vis.has(n)) continue;
        if(avoidPacked&&n!==to){
          const s=METRO.STATIONS[n];
          if(s?.ix&&(CROWD.state.crowdMap[n]||0)>82){vis.add(n);continue}
        }
        vis.add(n); q.push([n,[...path,n]]);
      }
    }
    return avoidPacked?bfs(from,to,false):null;
  }

  // ══════════════════════════════════════════════════════════════
  //  FARE ENGINE — Aug 2025 DMRC revision, distance-based
  //
  //  Standard lines (DMRC, effective 25 Aug 2025):
  //   0–2 km   → ₹11
  //   2–5 km   → ₹21
  //   5–12 km  → ₹32
  //   12–21 km → ₹43
  //   21–32 km → ₹54
  //   >32 km   → ₹64
  //  Smart Card: −10%
  //
  //  Airport Express (station-specific, same revision):
  //   NWD ↔ SJV: ₹21  NWD ↔ DHK: ₹43
  //   NWD ↔ T1:  ₹43  NWD ↔ ARC: ₹60  NWD ↔ DW21: ₹75
  //
  //  NMRC Aqua Line: separate operator, stop-based
  //   1 stop: ₹10  2-5 stops: ₹20  6-12 stops: ₹30  13+: ₹40
  // ══════════════════════════════════════════════════════════════
  const FARE_SLABS=[
    {maxKm:2,  fare:11},
    {maxKm:5,  fare:21},
    {maxKm:12, fare:32},
    {maxKm:21, fare:43},
    {maxKm:32, fare:54},
    {maxKm:Infinity, fare:64},
  ];

  // Airport Express fixed fares from New Delhi (NWD) in each direction
  const AEL_FARES={
    'NWD-SJV':21,'NWD-DHK':43,'NWD-T1':43,'NWD-ARC':60,'NWD-DW21':75,
    'SJV-NWD':21,'DHK-NWD':43,'T1-NWD':43,'ARC-NWD':60,'DW21-NWD':75,
    'SJV-DHK':30,'SJV-T1':30,'SJV-ARC':50,'SJV-DW21':65,
    'DHK-T1':21,'DHK-ARC':30,'DHK-DW21':50,
    'T1-ARC':21,'T1-DW21':43,
    'ARC-DW21':21,
  };

  function haversineKm(lat1,lng1,lat2,lng2){
    const R=6371,dLat=(lat2-lat1)*Math.PI/180,dLng=(lng2-lng1)*Math.PI/180;
    const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  }

  function routeDistanceKm(path){
    let km=0;
    for(let i=1;i<path.length;i++){
      const a=METRO.GPS[path[i-1]], b=METRO.GPS[path[i]];
      if(a&&b) km+=haversineKm(a[0],a[1],b[0],b[1]);
    }
    return +km.toFixed(1);
  }

  const AEL_STATIONS=new Set(['NWD','SJV','DHK','T1','ARC','DW21']);
  const AQ_STATIONS=new Set(METRO.LINE_PATHS.Aq||[]);

  function calcFare(path,segs){
    if(!path||path.length<2) return{token:'₹—',smart:'₹—',km:0,type:'standard'};

    const from=path[0], to=path[path.length-1];
    const usedLines=new Set(segs.map(s=>s.line));

    // Pure Airport Express trip
    if(usedLines.size===1&&usedLines.has('A')){
      const key=from+'-'+to, keyR=to+'-'+from;
      const f=AEL_FARES[key]||AEL_FARES[keyR]||60;
      return{token:'₹'+f, smart:'₹'+Math.round(f*.9), km:0, type:'airport',
             note:'Airport Express fare'};
    }

    // Pure Aqua Line trip (NMRC — station-count based)
    if(usedLines.size===1&&usedLines.has('Aq')){
      const stops=path.length-1;
      const f=stops<=1?10:stops<=5?20:stops<=12?30:40;
      return{token:'₹'+f, smart:'₹'+Math.round(f*.9), km:0, type:'nmrc',
             note:'Aqua Line (NMRC)'};
    }

    // Mixed journey: Airport Express + standard → add components
    let total=0;
    if(usedLines.has('A')){
      // Find the AEL segment boundaries
      const aelSeg=segs.find(s=>s.line==='A');
      if(aelSeg){
        const af=from+'-'+to, afR=to+'-'+from;
        total+=(AEL_FARES[af]||AEL_FARES[afR]||60);
      }
    }

    // Standard DMRC portion — by GPS distance
    const km=routeDistanceKm(path);
    const slab=FARE_SLABS.find(s=>km<=s.maxKm)||FARE_SLABS[FARE_SLABS.length-1];
    const stdFare=slab.fare;

    const finalToken=usedLines.has('A')?total:stdFare;
    return{
      token:'₹'+finalToken,
      smart:'₹'+Math.round(finalToken*.9),
      km,
      type:'standard',
      note:`${km} km · Aug 2025 rates`,
    };
  }

  // ── Draw route on SVG ─────────────────────────────────────────
  function drawRoute(path){
    const g=document.getElementById('g-route');
    if(!g) return;
    while(g.firstChild) g.removeChild(g.firstChild);
    if(!path||path.length<2) return;
    const NS='http://www.w3.org/2000/svg';
    const segs=buildSegments(path);

    segs.forEach(seg=>{
      if(seg.ids.length<2) return;
      const col=METRO.LINE_COLORS[seg.line]||'#FFFFFF';
      const pts=seg.ids.map(id=>{const s=METRO.STATIONS[id];return s?`${s.x},${s.y}`:null}).filter(Boolean).join(' ');

      // Glow
      const glow=document.createElementNS(NS,'polyline');
      glow.setAttribute('points',pts);glow.setAttribute('fill','none');
      glow.setAttribute('stroke',col);glow.setAttribute('stroke-width','10');
      glow.setAttribute('stroke-linecap','round');glow.setAttribute('stroke-linejoin','round');
      glow.setAttribute('opacity','.22');glow.setAttribute('filter','url(#glow-route)');
      g.appendChild(glow);

      // Main line with draw animation
      const pl=document.createElementNS(NS,'polyline');
      pl.setAttribute('points',pts);pl.setAttribute('fill','none');
      pl.setAttribute('stroke',col);pl.setAttribute('stroke-width','5');
      pl.setAttribute('stroke-linecap','round');pl.setAttribute('stroke-linejoin','round');
      pl.setAttribute('opacity','0.97');
      const segLen=seg.ids.reduce((s,id,i)=>{
        if(!i) return 0;
        const a=METRO.STATIONS[seg.ids[i-1]],b=METRO.STATIONS[id];
        return s+(a&&b?Math.hypot(b.x-a.x,b.y-a.y):0);
      },0)*2;
      pl.setAttribute('stroke-dasharray',segLen);
      pl.setAttribute('stroke-dashoffset',segLen);
      g.appendChild(pl);
      requestAnimationFrame(()=>{
        pl.style.transition='stroke-dashoffset 1.1s cubic-bezier(0.4,0,0.2,1)';
        pl.setAttribute('stroke-dashoffset','0');
      });
    });

    // Station markers
    path.forEach((id,i)=>{
      const s=METRO.STATIONS[id]; if(!s) return;
      const isEnd=i===0||i===path.length-1;
      const segLine=i<path.length-1?segmentLine(id,path[i+1]):segmentLine(path[i-1],id);
      const col=METRO.LINE_COLORS[segLine]||'#fff';
      if(isEnd){
        const outer=document.createElementNS(NS,'circle');
        outer.setAttribute('cx',s.x);outer.setAttribute('cy',s.y);outer.setAttribute('r',11);
        outer.setAttribute('fill',col);outer.setAttribute('opacity','.3');g.appendChild(outer);
        const inner=document.createElementNS(NS,'circle');
        inner.setAttribute('cx',s.x);inner.setAttribute('cy',s.y);inner.setAttribute('r',7);
        inner.setAttribute('fill',col);inner.setAttribute('stroke','#080C12');inner.setAttribute('stroke-width','2');
        g.appendChild(inner);
      } else if(s.ix){
        const ix=document.createElementNS(NS,'circle');
        ix.setAttribute('cx',s.x);ix.setAttribute('cy',s.y);ix.setAttribute('r',7);
        ix.setAttribute('fill','none');ix.setAttribute('stroke','#fff');ix.setAttribute('stroke-width','2');
        ix.setAttribute('opacity','.7');g.appendChild(ix);
      } else {
        const dot=document.createElementNS(NS,'circle');
        dot.setAttribute('cx',s.x);dot.setAttribute('cy',s.y);dot.setAttribute('r',4);
        dot.setAttribute('fill',col);dot.setAttribute('opacity','.6');g.appendChild(dot);
      }
    });
  }

  function clearRoute(){
    const g=document.getElementById('g-route');
    if(g) while(g.firstChild) g.removeChild(g.firstChild);
  }

  // ── Compute ───────────────────────────────────────────────────
  function compute(from,to,avoidPacked){
    ensureGraph();
    const path=bfs(from,to,avoidPacked);
    drawRoute(path);
    if(!path||path.length<2) return{ok:false,reason:'No route found between these stations.'};

    const crowdVals=path.map(id=>CROWD.state.crowdMap[id]||0);
    const avg=Math.round(crowdVals.reduce((s,v)=>s+v,0)/crowdVals.length);
    const max=Math.max(...crowdVals);
    const stops=path.length-1;
    const estMin=Math.round(stops*2.5);
    const segs=buildSegments(path);
    const changes=segs.length-1;
    const fareInfo=calcFare(path,segs);

    const hops=path.map((id,i)=>{
      const s=METRO.STATIONS[id];
      const v=CROWD.state.crowdMap[id]||0;
      const line=i<path.length-1?segmentLine(id,path[i+1]):(i>0?segmentLine(path[i-1],id):'Y');
      const nextLine=i<path.length-1?segmentLine(id,path[i+1]):null;
      const prevLine=i>0?segmentLine(path[i-1],id):null;
      const isChange=i>0&&i<path.length-1&&prevLine&&nextLine&&prevLine!==nextLine;
      return{id,s,v,line,isChange,isFirst:i===0,isLast:i===path.length-1};
    });

    return{ok:true,path,hops,stops,avg,max,estMin,fareInfo,changes,segs};
  }

  // ══════════════════════════════════════════════════════════════
  //  RENDER — redesigned result UI
  // ══════════════════════════════════════════════════════════════
  function render(result){
    const res=document.getElementById('rres');if(!res)return;
    if(!result.ok){
      res.style.display='block';
      res.innerHTML=`<div class="route-error">${result.reason}</div>`;
      return;
    }

    const from=result.hops[0]?.s?.n||'Origin';
    const to=result.hops[result.hops.length-1]?.s?.n||'Dest';
    const crowdColor=CROWD.color(result.avg);

    // ── Summary strip ──────────────────────────────────────────
    const summaryHTML=`
    <div class="rs-header">
      <div class="rs-route-title">
        <span class="rs-from">${from}</span>
        <span class="rs-arrow">→</span>
        <span class="rs-to">${to}</span>
      </div>
      <div class="rs-chips">
        ${result.segs.map(s=>`<span class="rs-line-chip" style="background:${METRO.LINE_COLORS[s.line]}22;color:${METRO.LINE_COLORS[s.line]};border:1px solid ${METRO.LINE_COLORS[s.line]}55">${METRO.LINE_NAMES[s.line]||s.line}</span>`).join('<span class="rs-chip-arrow">→</span>')}
      </div>
    </div>
    <div class="rs-stats">
      <div class="rs-stat">
        <div class="rs-stat-val">${result.stops}</div>
        <div class="rs-stat-lbl">Stops</div>
      </div>
      <div class="rs-stat">
        <div class="rs-stat-val">~${result.estMin}m</div>
        <div class="rs-stat-lbl">Est. Time</div>
      </div>
      <div class="rs-stat">
        <div class="rs-stat-val" style="color:${crowdColor}">${result.avg}%</div>
        <div class="rs-stat-lbl">Avg Crowd</div>
      </div>
      <div class="rs-stat">
        <div class="rs-stat-val" style="color:var(--a2)">${result.changes}</div>
        <div class="rs-stat-lbl">Changes</div>
      </div>
    </div>
    <div class="rs-fare-row">
      <div class="rs-fare-item">
        <span class="rs-fare-lbl">Token</span>
        <span class="rs-fare-val">${result.fareInfo.token}</span>
      </div>
      <div class="rs-fare-divider"></div>
      <div class="rs-fare-item">
        <span class="rs-fare-lbl">Smart Card</span>
        <span class="rs-fare-val rs-fare-sc">${result.fareInfo.smart}</span>
      </div>
      <div class="rs-fare-divider"></div>
      <div class="rs-fare-item rs-fare-note">
        <span class="rs-fare-lbl">Basis</span>
        <span class="rs-fare-val" style="font-size:8px">${result.fareInfo.note||'Aug 2025 rates'}</span>
      </div>
    </div>`;

    // ── Hop list ───────────────────────────────────────────────
    // Group hops by segment for visual section headers
    let prevLine=null;
    const hopsHTML=result.hops.map(({id,s,v,line,isChange,isFirst,isLast})=>{
      if(!s) return '';
      const col=METRO.LINE_COLORS[line]||'#fff';
      const lineCol=CROWD.color(v);
      const isClosed=v===0;

      // Section header when line changes
      let sectionHeader='';
      if(line!==prevLine){
        sectionHeader=`<div class="rh-segment-header" style="--lc:${col}">
          <span class="rh-seg-dot" style="background:${col}"></span>
          <span class="rh-seg-name">${METRO.LINE_NAMES[line]||line}</span>
          ${isChange?'<span class="rh-seg-badge">↔ Interchange here</span>':''}
        </div>`;
        prevLine=line;
      }

      return sectionHeader+`<div class="rhop ${isFirst?'rhop-first':''} ${isLast?'rhop-last':''}">
        <div class="rhl">
          <div class="hdot" style="
            background:${isFirst||isLast?col:'none'};
            width:${isFirst||isLast?12:8}px;
            height:${isFirst||isLast?12:8}px;
            border:${isFirst||isLast?'2px solid '+col:'2px solid '+col+'99'};
            border-radius:50%;
            flex-shrink:0;
          "></div>
          ${!isLast?`<div class="hln" style="background:${col};opacity:.5"></div>`:''}
        </div>
        <div class="hin">
          <div class="hnm">
            ${s.n}
            ${s.ix&&!isFirst&&!isLast?`<span class="rix-badge">⇄</span>`:''}
          </div>
          <div class="hmt">
            ${s.l.map(l=>`<span class="line-dot-chip" style="background:${METRO.LINE_COLORS[l]}22;color:${METRO.LINE_COLORS[l]};border:1px solid ${METRO.LINE_COLORS[l]}44">${METRO.LINE_NAMES[l]}</span>`).join('')}
          </div>
          ${!isClosed?`<div class="hcrowd" style="color:${lineCol}">
            <span class="hcrowd-bar" style="width:${v}%;background:${lineCol}"></span>
            <span>${v}%</span>
            <span class="hcrowd-dot" style="color:var(--muted)">·</span>
            <span>${CROWD.label(v)}</span>
            <span class="hcrowd-dot" style="color:var(--muted)">·</span>
            <span>${CROWD.waitLabel(v)}</span>
          </div>`:'<div class="hcrowd" style="color:var(--muted)">○ Station closed</div>'}
        </div>
      </div>`;
    }).join('');

    res.style.display='block';
    res.innerHTML=summaryHTML+`<div class="rh-list">${hopsHTML}</div>`;
  }

  // ── GPS Nearest Station ───────────────────────────────────────
  function nearestStation(lat,lng){
    let best=null,bestDist=Infinity;
    Object.entries(METRO.GPS||{}).forEach(([id,[slat,slng]])=>{
      const d=Math.hypot(lat-slat,lng-slng);
      if(d<bestDist){bestDist=d;best=id;}
    });
    return best;
  }

  function requestLocation(targetSelect){
    if(!navigator.geolocation){showGeoError('Geolocation not supported.');return;}
    setGeoBtn('📡 Locating…',true);
    navigator.geolocation.getCurrentPosition(
      pos=>{
        const{latitude:lat,longitude:lng}=pos.coords;
        const nearest=nearestStation(lat,lng);
        if(nearest&&METRO.STATIONS[nearest]){
          const sel=document.getElementById(targetSelect);
          if(sel){sel.value=nearest;sel.dispatchEvent(new Event('change'));}
          showGeoSuccess(`📍 Nearest: ${METRO.STATIONS[nearest].n}`);
        }else{showGeoError('No nearby station found.');}
        setGeoBtn('📍 Use My Location',false);
      },
      err=>{
        const msg=err.code===1?'Location access denied.':err.code===2?'Location unavailable.':'Timed out.';
        showGeoError(msg);setGeoBtn('📍 Use My Location',false);
      },
      {timeout:10000,maximumAge:60000,enableHighAccuracy:false}
    );
  }

  function setGeoBtn(txt,disabled){
    const b=document.getElementById('geo-btn');
    if(b){b.textContent=txt;b.disabled=disabled;b.style.opacity=disabled?'.6':'1';}
  }
  function showGeoSuccess(msg){const el=document.getElementById('geo-msg');if(el){el.textContent=msg;el.style.color='var(--low)';el.style.display='block';setTimeout(()=>el.style.display='none',4000);}}
  function showGeoError(msg){const el=document.getElementById('geo-msg');if(el){el.textContent=msg;el.style.color='var(--pk)';el.style.display='block';setTimeout(()=>el.style.display='none',5000);}}

  function populateSelects(){
    const opts=Object.entries(METRO.STATIONS).sort((a,b)=>a[1].n.localeCompare(b[1].n))
      .map(([id,s])=>`<option value="${id}">${s.n} (${s.l.join('/')})</option>`).join('');
    ['rfrom','rto'].forEach(eid=>{
      const sel=document.getElementById(eid);if(!sel)return;
      const prev=sel.value;
      sel.innerHTML=`<option value="">— ${eid==='rfrom'?'From':'To'} Station —</option>`+opts;
      if(prev) sel.value=prev;
    });
  }

  return{compute,render,drawRoute,clearRoute,populateSelects,requestLocation,nearestStation};
})();
