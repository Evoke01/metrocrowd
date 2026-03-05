// ══════════════════════════════════════════════════════════════════
//  ROUTE ENGINE v3
//  • BFS crowd-aware pathfinding
//  • Correct per-segment line colors on SVG
//  • GPS geolocation → nearest station auto-fill
//  • Fare estimate, interchange detection, animated draw
// ══════════════════════════════════════════════════════════════════
window.ROUTE=(function(){
  let graph=null;
  // For each edge (a→b) store the line code
  const EDGE_LINE={};

  function ensureGraph(){
    if(graph)return;
    graph=METRO.buildGraph();
    // Build edge→line map
    Object.entries(METRO.LINE_PATHS).forEach(([key,path])=>{
      const lineCode=key.replace(/[^A-Za-z]/g,'').match(/^[A-Z]+/)?.[0]||'B';
      // Normalize key to line code
      const lc=key.length<=3?key:lineCode;
      for(let i=0;i<path.length-1;i++){
        const a=path[i],b=path[i+1];
        if(!METRO.STATIONS[a]||!METRO.STATIONS[b])continue;
        const k1=a+'→'+b,k2=b+'→'+a;
        // Only set if not already set (prefer first/primary line)
        if(!EDGE_LINE[k1])EDGE_LINE[k1]=lc;
        if(!EDGE_LINE[k2])EDGE_LINE[k2]=lc;
      }
    });
  }

  // Map path key prefix to line code
  function pathKeyToLine(key){
    const map={Y:'Y',B:'B',BW:'B',BE:'B',BNE:'B',BSE:'B',R:'R',RW:'R',RE:'R',
      G:'G',GA:'G',GB:'G',GC:'G',P:'P',PNW:'P',PW:'P',PE:'P',PTR:'P',PWEL:'P',PAZ:'P',
      M:'M',V:'V',VN:'V',VITO:'V',VS:'V',A:'A',Gr:'Gr',Aq:'Aq'};
    for(const [prefix,lc] of Object.entries(map)){
      if(key.startsWith(prefix))return lc;
    }
    return 'B';
  }

  // ── BFS ─────────────────────────────────────────────────────────
  function bfs(from,to,avoidPacked){
    ensureGraph();
    if(!from||!to||from===to)return null;
    if(!METRO.STATIONS[from]||!METRO.STATIONS[to])return null;
    const vis=new Set([from]);
    const q=[[from,[from]]];
    while(q.length){
      const[cur,path]=q.shift();
      if(cur===to)return path;
      let nb=[...(graph[cur]||[])];
      if(avoidPacked)nb.sort((a,b)=>(CROWD.state.crowdMap[a]||0)-(CROWD.state.crowdMap[b]||0));
      for(const n of nb){
        if(vis.has(n))continue;
        if(avoidPacked&&n!==to){
          const s=METRO.STATIONS[n];
          if(s?.ix&&(CROWD.state.crowdMap[n]||0)>82){vis.add(n);continue}
        }
        vis.add(n);q.push([n,[...path,n]]);
      }
    }
    return avoidPacked?bfs(from,to,false):null;
  }

  // ── Get dominant line for segment a→b ───────────────────────────
  function segmentLine(a,b){
    return EDGE_LINE[a+'→'+b]||EDGE_LINE[b+'→'+a]||sharedLine(a,b)||'B';
  }

  function sharedLine(a,b){
    const sa=METRO.STATIONS[a]?.l||[];
    const sb=METRO.STATIONS[b]?.l||[];
    return sa.find(l=>sb.includes(l))||sa[0]||'B';
  }

  // ── Build colored segments for SVG drawing ───────────────────────
  function buildSegments(path){
    if(!path||path.length<2)return[];
    const segs=[];
    let curLine=segmentLine(path[0],path[1]);
    let segStart=0;
    for(let i=1;i<path.length;i++){
      const nextLine=i<path.length-1?segmentLine(path[i],path[i+1]):curLine;
      if(nextLine!==curLine||i===path.length-1){
        segs.push({ids:path.slice(segStart,i+1),line:curLine});
        segStart=i;
        curLine=nextLine;
      }
    }
    return segs;
  }

  // ── Draw route on SVG map with correct line colors ───────────────
  function drawRoute(path){
    const g=document.getElementById('g-route');
    if(!g)return;
    while(g.firstChild)g.removeChild(g.firstChild);
    if(!path||path.length<2)return;
    const NS='http://www.w3.org/2000/svg';

    const segs=buildSegments(path);

    // Calculate total path length for animation
    let totalLen=0;
    path.forEach((id,i)=>{
      if(!i)return;
      const a=METRO.STATIONS[path[i-1]],b=METRO.STATIONS[id];
      if(a&&b)totalLen+=Math.hypot(b.x-a.x,b.y-a.y);
    });

    // Draw each segment in its line color
    segs.forEach(seg=>{
      if(seg.ids.length<2)return;
      const col=METRO.LINE_COLORS[seg.line]||'#FFFFFF';
      const pts=seg.ids.map(id=>{
        const s=METRO.STATIONS[id];return s?`${s.x},${s.y}`:null;
      }).filter(Boolean).join(' ');

      // Glow
      const glow=document.createElementNS(NS,'polyline');
      glow.setAttribute('points',pts);
      glow.setAttribute('fill','none');
      glow.setAttribute('stroke',col);
      glow.setAttribute('stroke-width','10');
      glow.setAttribute('stroke-linecap','round');
      glow.setAttribute('stroke-linejoin','round');
      glow.setAttribute('opacity','.25');
      glow.setAttribute('filter','url(#glow-route)');
      g.appendChild(glow);

      // Main colored line
      const pl=document.createElementNS(NS,'polyline');
      pl.setAttribute('points',pts);
      pl.setAttribute('fill','none');
      pl.setAttribute('stroke',col);
      pl.setAttribute('stroke-width','4.5');
      pl.setAttribute('stroke-linecap','round');
      pl.setAttribute('stroke-linejoin','round');
      pl.setAttribute('opacity','0.95');

      // Animate with dash
      const segLen=seg.ids.reduce((s,id,i)=>{
        if(!i)return 0;
        const a=METRO.STATIONS[seg.ids[i-1]],b=METRO.STATIONS[id];
        return s+(a&&b?Math.hypot(b.x-a.x,b.y-a.y):0);
      },0)*2;
      pl.setAttribute('stroke-dasharray',segLen);
      pl.setAttribute('stroke-dashoffset',segLen);
      g.appendChild(pl);
      requestAnimationFrame(()=>{
        pl.style.transition='stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)';
        pl.setAttribute('stroke-dashoffset','0');
      });
    });

    // Station markers on route
    path.forEach((id,i)=>{
      const s=METRO.STATIONS[id];if(!s)return;
      const isEnd=i===0||i===path.length-1;
      const segLine=i<path.length-1?segmentLine(id,path[i+1]):segmentLine(path[i-1],id);
      const col=METRO.LINE_COLORS[segLine]||'#fff';

      // White ring
      const ring=document.createElementNS(NS,'circle');
      ring.setAttribute('cx',s.x);ring.setAttribute('cy',s.y);
      ring.setAttribute('r',isEnd?10:6);
      ring.setAttribute('fill',isEnd?col:'none');
      ring.setAttribute('stroke','#FFFFFF');
      ring.setAttribute('stroke-width',isEnd?0:2);
      ring.setAttribute('opacity',isEnd?1:.7);
      g.appendChild(ring);

      // Interchange indicator
      if(s.ix&&!isEnd){
        const ix=document.createElementNS(NS,'circle');
        ix.setAttribute('cx',s.x);ix.setAttribute('cy',s.y);
        ix.setAttribute('r',8);ix.setAttribute('fill','none');
        ix.setAttribute('stroke','#FFFFFF');ix.setAttribute('stroke-width','1.5');
        ix.setAttribute('opacity','.5');
        g.appendChild(ix);
      }
    });

    // Line legend at top
    const usedLines=[...new Set(segs.map(s=>s.line))];
    usedLines.forEach((l,i)=>{
      const col=METRO.LINE_COLORS[l]||'#fff';
      const rect=document.createElementNS(NS,'rect');
      rect.setAttribute('x',10+i*70);rect.setAttribute('y',10);
      rect.setAttribute('width',65);rect.setAttribute('height',18);
      rect.setAttribute('rx',9);rect.setAttribute('fill',col);rect.setAttribute('opacity','.9');
      g.appendChild(rect);
      const txt=document.createElementNS(NS,'text');
      txt.setAttribute('x',42+i*70);txt.setAttribute('y',23);
      txt.setAttribute('text-anchor','middle');
      txt.setAttribute('font-size','8');txt.setAttribute('font-family','Space Mono,monospace');
      txt.setAttribute('fill','#000');txt.setAttribute('font-weight','700');
      txt.textContent=METRO.LINE_NAMES[l]||l;
      g.appendChild(txt);
    });
  }

  function clearRoute(){
    const g=document.getElementById('g-route');
    if(g)while(g.firstChild)g.removeChild(g.firstChild);
  }

  // ── Compute + render ─────────────────────────────────────────────
  function compute(from,to,avoidPacked){
    ensureGraph();
    const path=bfs(from,to,avoidPacked);
    drawRoute(path);
    if(!path||path.length<2)return{ok:false,reason:'No route found. Check if stations are connected.'};

    const crowdVals=path.map(id=>CROWD.state.crowdMap[id]||0);
    const avg=Math.round(crowdVals.reduce((s,v)=>s+v,0)/crowdVals.length);
    const max=Math.max(...crowdVals);
    const stops=path.length-1;
    const estMin=Math.round(stops*2.5);

    // Detect line changes
    const segs=buildSegments(path);
    const changes=segs.length-1;

    // Build hop details
    const hops=path.map((id,i)=>{
      const s=METRO.STATIONS[id];
      const v=CROWD.state.crowdMap[id]||0;
      const line=i<path.length-1?segmentLine(id,path[i+1]):(i>0?segmentLine(path[i-1],id):'Y');
      const nextLine=i<path.length-1?segmentLine(id,path[i+1]):null;
      const prevLine=i>0?segmentLine(path[i-1],id):null;
      const isChange=i>0&&i<path.length-1&&prevLine&&nextLine&&prevLine!==nextLine;
      return{id,s,v,line,isChange,isFirst:i===0,isLast:i===path.length-1};
    });

    return{ok:true,path,hops,stops,avg,max,estMin,estFare:fare(stops),changes,segs};
  }

  function fare(stops){
    if(stops<=2)return'₹10';if(stops<=5)return'₹20';if(stops<=12)return'₹30';
    if(stops<=21)return'₹40';if(stops<=32)return'₹50';return'₹60';
  }

  // ── Render hops into DOM ─────────────────────────────────────────
  function render(result){
    const res=document.getElementById('rres');if(!res)return;
    if(!result.ok){
      res.style.display='block';
      document.getElementById('rhops').innerHTML=`<div style="color:var(--muted);font-size:10px;font-family:'Space Mono',monospace;padding:8px">${result.reason}</div>`;
      document.getElementById('rsum').innerHTML='';
      return;
    }
    document.getElementById('rtitle').textContent=`Route · ${result.stops} stops · ~${result.estMin}m`;

    document.getElementById('rhops').innerHTML=result.hops.map(({id,s,v,line,isChange,isFirst,isLast})=>{
      if(!s)return'';
      const col=METRO.LINE_COLORS[line]||'#fff';
      const lineCol=CROWD.color(v);
      const isIx=s.ix&&!isFirst&&!isLast;
      return`<div class="rhop">
        <div class="rhl">
          <div class="hdot" style="background:${col};width:${isFirst||isLast?12:8}px;height:${isFirst||isLast?12:8}px;margin-top:${isFirst||isLast?1:3}px;${isIx?'outline:2px solid #fff;outline-offset:1px':''}"></div>
          ${!isLast?`<div class="hln" style="background:${col};opacity:.6"></div>`:''}
        </div>
        <div class="hin">
          <div class="hnm">${s.n}${isChange?` <span style="font-size:8px;background:${col}22;color:${col};border:1px solid ${col}44;border-radius:6px;padding:1px 5px;font-family:'Space Mono',monospace">↔ Change</span>`:''}</div>
          <div class="hmt" style="color:${col}">${s.l.map(l=>`<span style="color:${METRO.LINE_COLORS[l]}">${METRO.LINE_NAMES[l]}</span>`).join(' · ')}</div>
          <span class="hbg" style="background:${lineCol}22;color:${lineCol};border:1px solid ${lineCol}44">${v}% · ${CROWD.label(v)} · ${CROWD.waitLabel(v)}</span>
        </div>
      </div>`;
    }).join('');

    document.getElementById('rsum').innerHTML=`
      <div class="rsc"><div class="rsv">${result.stops}</div><div class="rsl">Stops</div></div>
      <div class="rsc"><div class="rsv" style="color:${CROWD.color(result.avg)}">${result.avg}%</div><div class="rsl">Avg Crowd</div></div>
      <div class="rsc"><div class="rsv">~${result.estMin}m</div><div class="rsl">Est Time</div></div>
      <div class="rsc"><div class="rsv" style="color:${CROWD.color(result.max)}">${result.max}%</div><div class="rsl">Peak</div></div>
      <div class="rsc"><div class="rsv">${result.estFare}</div><div class="rsl">Fare</div></div>
      <div class="rsc"><div class="rsv" style="color:var(--a2)">${result.changes}</div><div class="rsl">Line Changes</div></div>
    `;
    res.style.display='block';
  }

  // ── GPS Nearest Station ──────────────────────────────────────────
  function nearestStation(lat,lng){
    let best=null,bestDist=Infinity;
    Object.entries(METRO.GPS||{}).forEach(([id,[slat,slng]])=>{
      const d=Math.hypot(lat-slat,lng-slng);
      if(d<bestDist){bestDist=d;best=id}
    });
    return best;
  }

  function requestLocation(targetSelect){
    if(!navigator.geolocation){
      showGeoError('Geolocation not supported by your browser.');
      return;
    }
    setGeoBtn('📡 Locating…',true);
    navigator.geolocation.getCurrentPosition(
      pos=>{
        const{latitude:lat,longitude:lng}=pos.coords;
        const nearest=nearestStation(lat,lng);
        if(nearest&&METRO.STATIONS[nearest]){
          const sel=document.getElementById(targetSelect);
          if(sel){sel.value=nearest;sel.dispatchEvent(new Event('change'))}
          showGeoSuccess(`📍 Nearest: ${METRO.STATIONS[nearest].n}`);
        } else {
          showGeoError('Could not find a nearby station.');
        }
        setGeoBtn('📍 Use My Location',false);
      },
      err=>{
        const msg=err.code===1?'Location access denied. Please allow location in browser settings.':
                   err.code===2?'Location unavailable. Try again.':'Location request timed out.';
        showGeoError(msg);
        setGeoBtn('📍 Use My Location',false);
      },
      {timeout:10000,maximumAge:60000,enableHighAccuracy:false}
    );
  }

  function setGeoBtn(txt,disabled){
    const b=document.getElementById('geo-btn');
    if(b){b.textContent=txt;b.disabled=disabled;b.style.opacity=disabled?'.6':'1'}
  }

  function showGeoSuccess(msg){
    const el=document.getElementById('geo-msg');
    if(el){el.textContent=msg;el.style.color='var(--low)';el.style.display='block';setTimeout(()=>el.style.display='none',4000)}
  }

  function showGeoError(msg){
    const el=document.getElementById('geo-msg');
    if(el){el.textContent=msg;el.style.color='var(--pk)';el.style.display='block';setTimeout(()=>el.style.display='none',5000)}
  }

  function populateSelects(){
    const opts=Object.entries(METRO.STATIONS).sort((a,b)=>a[1].n.localeCompare(b[1].n))
      .map(([id,s])=>`<option value="${id}">${s.n} (${s.l.join('/')})</option>`).join('');
    ['rfrom','rto'].forEach(eid=>{
      const sel=document.getElementById(eid);if(!sel)return;
      const prev=sel.value;
      sel.innerHTML=`<option value="">— ${eid==='rfrom'?'From':'To'} Station —</option>`+opts;
      if(prev)sel.value=prev;
    });
  }

  return{compute,render,drawRoute,clearRoute,populateSelects,requestLocation,nearestStation};
})();
