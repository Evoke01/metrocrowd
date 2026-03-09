window.UI=(function(){
  let activeTab='home',panelId=null,selLevel='';

  // ── v3 state ──────────────────────────────────────────────────
  let homeStation = localStorage.getItem('v3_home_station') || null;
  let overlayMode = '';          // 'home'|'coach'|'route-from'|'route-to'|'report'
  let cfStation = null, cfLine = null, cfHour = new Date().getHours(), cfDir = 'a';
  let repStation = null;
  let routeFrom = null, routeTo = null;
  let karma = parseInt(localStorage.getItem('v3_karma')||'0',10);

  // ── DMRC line colours (for overlays) ─────────────────────────
  const LINE_COLORS_DMRC={yellow:'#F5A800',blue:'#0060A9',red:'#E93124',pink:'#E75480',magenta:'#AE0E6B',violet:'#7B2D8B',green:'#128807',orange:'#F26522',grey:'#9E9E9E'};

  function init(){
    buildHomeGreeting();
    buildCFTimeChips();
    _initKarma();

    // Default to Rajiv Chowk if no saved station
    if(!homeStation){
      const rjc=Object.keys(METRO.STATIONS).find(id=>METRO.STATIONS[id].n==='Rajiv Chowk')
               ||Object.keys(METRO.STATIONS)[0];
      homeStation=rjc;
      localStorage.setItem('v3_home_station',homeStation);
    }

    // Ensure crowd data is populated before rendering home
    CROWD.recomputeAll();
    _applyHomeStation(homeStation,false);
    buildFC();
    buildHomeLineList();

    setTimeout(()=>loadNetworkReports(),800);

    // Clock
    function tick(){const d=new Date(),h=d.getHours(),m=d.getMinutes();
      _s('sbar-clock',`${h}:${m<10?'0'+m:m}`);}
    setInterval(tick,30000);tick();
    // Greeting refresh + crowd refresh every 2 min
    setInterval(buildHomeGreeting,60000);
    setInterval(()=>{
      CROWD.recomputeAll();
      _applyHomeStation(homeStation,false);
      buildFC();
      buildHomeLineList();
    },120000);
  }

  // ── NAV ───────────────────────────────────────────────────────
  function navTo(screenId){
    activeTab=screenId;
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    const el=document.getElementById(screenId);if(el)el.classList.add('active');
    document.querySelectorAll('.bni').forEach(b=>b.classList.toggle('on',b.dataset.tab===screenId));
    if(screenId==='s-route')_refreshRouteDisplay();
    if(screenId==='s-report')loadNetworkReports();
    if(screenId==='s-home'){buildFC();buildHomeLineList();}
  }
  function switchTab(tab){
    const MAP={map:'s-home',stats:'s-home',route:'s-route',report:'s-report',home:'s-home',coach:'s-coach',station:'s-station'};
    navTo(MAP[tab]||'s-'+tab);
  }

  function refreshIfActive(tab){if(activeTab===tab)switchTab(tab)}

  // ── HOME SCREEN ───────────────────────────────────────────────
  function buildHomeGreeting(){
    const d=new Date(),h=d.getHours();
    const gr=h<12?'Good Morning':h<17?'Good Afternoon':'Good Evening';
    _s('h-greet',gr);
    _s('h-date',d.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'}));
  }

  function _applyHomeStation(id,animate){
    homeStation=id;
    localStorage.setItem('v3_home_station',id);
    const s=METRO.STATIONS[id];if(!s)return;
    const v=CROWD.state.crowdMap[id]||0;
    const c=_v3Color(v);
    _s('h-from',s.n);
    _s('fc-stn',s.n);
    _s('home-stn-lbl',s.n.split(' ').slice(0,2).join(' '));
    const numEl=document.getElementById('h-num');
    if(numEl){numEl.textContent=v+'%';numEl.style.color=c}
    const lblEl=document.getElementById('h-lbl');
    if(lblEl){lblEl.textContent=_v3Label(v);lblEl.style.color=c}
    const subEl=document.getElementById('h-sub');
    if(subEl)subEl.textContent=s.l.map(l=>METRO.LINE_NAMES[l]).join(' · ')+(s.ix?' · Interchange':'');
    const barEl=document.getElementById('h-bar');
    if(barEl){barEl.style.width=v+'%';barEl.style.background=c}
    const tagEl=document.getElementById('h-tag');
    if(tagEl){
      if(v<40){tagEl.className='hero-tag safe';tagEl.textContent='✓ Good time to board now';}
      else if(v<70){tagEl.className='hero-tag';tagEl.textContent='⚠ Moderate — wait may help';}
      else{tagEl.className='hero-tag';tagEl.textContent='✕ Very packed — try next train';}
    }
    buildFC();
  }

  function buildFC(){
    const now=new Date().getHours();
    const slots=[];
    for(let i=0;i<8;i++){
      const h=(now+i)%24;
      let v;
      if(homeStation&&CROWD.stationForecast){
        const fc=CROWD.stationForecast(homeStation);
        v=fc[h]||0;
      } else {
        v=h>=8&&h<=10?Math.round(60+Math.random()*28):h>=17&&h<=20?Math.round(65+Math.random()*25):h<6||h>22?Math.round(8+Math.random()*18):Math.round(28+Math.random()*30);
      }
      slots.push({h,v,isNow:i===0});
    }
    const mx=Math.max(1,...slots.map(s=>s.v));
    const strip=document.getElementById('fc-strip');if(!strip)return;
    strip.innerHTML=slots.map(s=>{
      const ht=Math.round(s.v/mx*100);
      const c=_v3Fill(s.v);
      const lbl=s.isNow?'Now':(s.h>12?`${s.h-12}p`:s.h===12?'12p':s.h===0?'12a':`${s.h}a`);
      return `<div class="fc-slot${s.isNow?' now':''}">
        <div class="fc-time">${lbl}</div>
        <div class="fc-well"><div class="fc-fill" style="height:${ht}%;background:${c}"></div></div>
        <div class="fc-val">${s.v}%</div>
      </div>`;
    }).join('');
  }

  function buildHomeLineList(){
    const ll=document.getElementById('line-list');if(!ll)return;
    const avgs=CROWD.lineAverages?CROWD.lineAverages():[];
    if(!avgs.length){ll.innerHTML='<div style="padding:14px;font-size:11px;color:var(--sub);text-align:center">Loading…</div>';return;}
    ll.innerHTML=avgs.map(({l,avg,name,color,count,isOpen,firstTrain,lastTrain})=>{
      const c=isOpen?_v3Color(avg):'var(--dim)';
      const pct=isOpen?avg+'%':'Closed';
      return`<div class="line-row" onclick="UI.openSearch('station')">
        <div class="lr-dot" style="background:${color||'#888'};opacity:${isOpen?1:.4}"></div>
        <div class="lr-name" style="opacity:${isOpen?1:.55}">${name}</div>
        <div class="lr-st" style="opacity:${isOpen?1:.4}">${count} st</div>
        <div class="lr-right">
          <div class="lr-pct" style="color:${c}">${pct}</div>
          ${isOpen?`<div class="lr-bar-bg"><div class="lr-bar-fill" style="width:${avg}%;background:${c}"></div></div>`:''}
        </div>
      </div>`;
    }).join('');
  }

  // ── v3 colour helpers ─────────────────────────────────────────
  function _v3Color(p){return p===0?'var(--dim)':p<40?'#4ade80':p<70?'var(--y)':'#f87171'}
  function _v3Fill(p){return p===0?'rgba(255,255,255,.06)':p<40?'#4ade80':p<70?'var(--y)':'#f87171'}
  function _v3Label(p){return p===0?'Station Closed':p<40?'Low Crowd':p<70?'Moderate Crowd':p<85?'High Crowd':'Packed'}

  // ── HOME STATION PICKER ───────────────────────────────────────
  function openHomeStationPicker(){
    overlayMode='home';
    _openStationOverlay('Set Home Station');
  }

  function openStationSearch(){
    overlayMode='station';
    _openStationOverlay('Check Station');
  }

  // ── COACH SCREEN ──────────────────────────────────────────────
  function openCoachStationPicker(){
    overlayMode='coach-station';
    _openStationOverlay('Select Station');
  }

  function openCoachLinePicker(){
    if(!cfStation)return;
    const lines=_cfLinesFor(cfStation);
    const grid=document.getElementById('ov-line-grid');if(!grid)return;
    grid.innerHTML=lines.map(lid=>{
      const col=LINE_COLORS_DMRC[lid]||'#888';
      const cfg=_getCFLineCfg(lid);
      return`<div class="line-btn" onclick="UI.pickCoachLine('${lid}')">
        <div class="lb-dot" style="background:${col}"></div>
        <div>
          <div class="lb-name">${cfg.name}</div>
          <div class="lb-meta">${cfg.coaches} coaches · every ${cfg.fp}–${cfg.fo} min</div>
        </div>
      </div>`;
    }).join('');
    document.getElementById('ov-line').classList.add('open');
  }

  function pickCoachStation(id){
    closeOverlay();
    cfStation=id;cfLine=null;
    const s=METRO.STATIONS[id];
    _s('c-stn-val',s?s.n:id);
    document.getElementById('c-stn-val')?.classList.remove('ph');
    _s('c-line-val','Select line');
    document.getElementById('c-line-val')?.classList.add('ph');
    const lr=document.getElementById('c-line-row');
    if(lr){lr.style.opacity='1';lr.style.pointerEvents='auto';}
    document.getElementById('c-dir-row').style.display='none';
    const lines=_cfLinesFor(id);
    if(lines.length===1){pickCoachLine(lines[0]);}
    else{openCoachLinePicker();}
  }

  function pickCoachLine(lid){
    closeOverlay();
    cfLine=lid;
    const cfg=_getCFLineCfg(lid);
    _s('c-line-val',cfg.name);
    document.getElementById('c-line-val')?.classList.remove('ph');
    const dr=document.getElementById('c-dir-row');if(dr)dr.style.display='flex';
    _s('c-dir-a-lbl','→ '+cfg.terminus);
    _s('c-dir-b-lbl','← '+cfg.origin);
    _renderCoachScreen();
  }

  function setCoachDir(d){
    cfDir=d;
    document.getElementById('c-dir-a').classList.toggle('on',d==='a');
    document.getElementById('c-dir-b').classList.toggle('on',d==='b');
    _renderCoachScreen();
  }

  function buildCFTimeChips(){
    const now=new Date().getHours();
    const slots=[{l:'Now',h:now},{l:'+1h',h:(now+1)%24},{l:'+2h',h:(now+2)%24},{l:'8 AM',h:8},{l:'1 PM',h:13},{l:'6 PM',h:18}];
    const tc=document.getElementById('c-time-chips');if(!tc)return;
    tc.innerHTML=slots.map((s,i)=>`<div class="chip ${i===0?'on':''}" onclick="UI.setCFHour(${s.h},this)">${s.l}</div>`).join('');
  }

  function setCFHour(h,el){
    document.querySelectorAll('#c-time-chips .chip').forEach(c=>c.classList.remove('on'));
    el.classList.add('on');
    cfHour=h;
    _renderCoachScreen();
  }

  function _cfLinesFor(stationId){
    // Build line list from METRO.STATIONS
    const s=METRO.STATIONS[stationId];if(!s)return[];
    // map internal line codes to DMRC coach line IDs
    const MAP_LINES={Y:'yellow',B:'blue',R:'red',P:'pink',M:'magenta',V:'violet',G:'green',A:'orange',Gr:'grey',Aq:'aqua'};
    return s.l.map(l=>MAP_LINES[l]).filter(Boolean);
  }

  function _getCFLineCfg(lid){
    const CFLINES={
      yellow:{name:'Yellow Line',coaches:8,fp:2,fo:5,origin:'Samaypur Badli',terminus:'HUDA City Centre'},
      blue:  {name:'Blue Line',  coaches:8,fp:2,fo:4,origin:'Dwarka Sec 21',terminus:'Noida Electronic City'},
      red:   {name:'Red Line',   coaches:8,fp:3,fo:6,origin:'Rithala',terminus:'Dilshad Garden'},
      pink:  {name:'Pink Line',  coaches:6,fp:4,fo:8,origin:'Majlis Park',terminus:'Shiv Vihar'},
      magenta:{name:'Magenta',   coaches:6,fp:4,fo:8,origin:'Janakpuri West',terminus:'Botanical Garden'},
      violet:{name:'Violet Line',coaches:6,fp:4,fo:7,origin:'Kashmere Gate',terminus:'Raja Nahar Singh'},
      green: {name:'Green Line', coaches:4,fp:5,fo:10,origin:'Inderlok',terminus:'Inderlok'},
      orange:{name:'Airport Express',coaches:6,fp:10,fo:15,origin:'New Delhi',terminus:'Dwarka Sec 21'},
      grey:  {name:'Grey Line',  coaches:4,fp:8,fo:15,origin:'Dwarka',terminus:'Najafgarh'},
    };
    return CFLINES[lid]||{name:lid,coaches:6,fp:5,fo:10,origin:'—',terminus:'—'};
  }

  // Coach crowd bias (condensed from metrocrowd_coach.html data)
  const COACH_BIAS={
    'Rajiv Chowk':{yellow:[2.0,1.8,1.4,1.1,0.8,0.7,0.6,0.5],blue:[1.5,1.3,1.0,0.9,1.4,1.6,1.8,2.0]},
    'Kashmere Gate':{yellow:[2.0,1.8,1.5,1.2,0.8,0.6,0.4,0.3],red:[1.8,1.7,1.4,1.1,0.8,0.6,0.4,0.3],violet:[1.6,1.5,1.3,1.0,0.8,0.7,0.5,0.4]},
    'Hauz Khas':{yellow:[1.4,1.6,1.8,1.7,1.2,0.8,0.6,0.5],magenta:[1.8,1.6,1.4,1.1,0.8,0.6,0.5,0.4]},
    'Botanical Garden':{blue:[0.5,0.6,0.7,0.9,1.2,1.6,1.8,2.0],magenta:[0.6,0.7,0.8,0.9,1.1,1.5,1.7,1.9]},
    'New Delhi':{yellow:[2.0,1.9,1.7,1.4,1.0,0.7,0.5,0.4]},
    'Anand Vihar':{blue:[2.0,1.8,1.5,1.1,0.8,0.6,0.5,0.4],pink:[1.9,1.7,1.4,1.0,0.8,0.7,0.5,0.4]},
    'Lajpat Nagar':{violet:[1.0,1.8,1.9,1.7,1.2,0.8,0.5,0.4],pink:[0.9,1.7,1.8,1.6,1.1,0.8,0.5,0.4]},
    'Mandi House':{blue:[1.9,1.7,1.4,1.0,0.8,0.7,0.6,0.5],violet:[1.8,1.6,1.3,0.9,0.8,0.7,0.6,0.5]},
    'INA':{yellow:[0.7,0.8,1.0,1.5,1.8,1.7,1.2,0.9],pink:[0.6,0.7,0.9,1.4,1.7,1.6,1.2,0.9]},
    'Central Secretariat':{yellow:[1.2,1.3,1.6,1.8,1.7,1.4,0.8,0.6],violet:[1.1,1.2,1.5,1.7,1.8,1.5,0.9,0.7]},
    'Rajouri Garden':{blue:[0.9,1.1,1.7,1.9,1.8,1.2,0.7,0.6],pink:[0.8,1.0,1.6,1.8,1.7,1.2,0.8,0.6]},
  };

  const GATE_TIPS={
    'Rajiv Chowk':'Gate 7 (Barakhamba) → <strong>Coach 1–2</strong> · Yellow↔Blue interchange → <strong>Coach 5–6</strong>',
    'Kashmere Gate':'Gate 1 (main) → <strong>Coach 1–2</strong> · Red platform packed at <strong>Coach 1–4</strong>',
    'Hauz Khas':'Gate 2 (exit) → <strong>Coach 3–4</strong> · Magenta interchange → <strong>Coach 1–2</strong>',
    'Botanical Garden':'Gate 1 aligns <strong>Coach 7–8</strong> · Noida crowd loads <strong>Coach 5–8</strong>',
    'New Delhi':'Railway station → <strong>Coach 1–4</strong> very packed',
    'Anand Vihar':'Bus/rail Gate 1 → <strong>Coach 1–3</strong> · Gate 3 → Coach 6–8',
    'Mandi House':'Gate 4 (ITO) → <strong>Coach 1</strong> · Violet change → Coach 4–6',
    'INA':'Gate 2 (market) → <strong>Coach 4–6</strong> · Pink change Gate 1 → Coach 1–2',
    'Central Secretariat':'Gate 1 → <strong>Coach 3–5</strong> · Gate 4 (India Gate) → Coach 6–8',
    'Lajpat Nagar':'Gate 1 (market) → <strong>Coach 2–4</strong> · Pink change → Coach 5–6',
  };

  const HOURLY_MULT={'05':0.15,'06':0.35,'07':0.7,'08':1.0,'09':0.95,'10':0.65,'11':0.5,'12':0.48,'13':0.52,'14':0.5,'15':0.55,'16':0.65,'17':0.85,'18':1.0,'19':0.9,'20':0.7,'21':0.55,'22':0.4,'23':0.2};
  const TIER_BASE={tier1:88,tier2:72,tier3:55,tier4:38};
  const TIERS={'Rajiv Chowk':'tier1','Kashmere Gate':'tier1','Hauz Khas':'tier1','New Delhi':'tier1','Botanical Garden':'tier1','Anand Vihar':'tier1','Rajouri Garden':'tier1','Welcome':'tier1','Mandi House':'tier2','Central Secretariat':'tier2','Lajpat Nagar':'tier2','Kalkaji Mandir':'tier2','INA':'tier2','Janakpuri West':'tier2'};

  function _cfCrowd(stationName,hour){
    const base=TIER_BASE[TIERS[stationName]||'tier4'];
    const mult=HOURLY_MULT[String(hour).padStart(2,'0')]||0.3;
    const noise=((stationName.charCodeAt(0)*7+stationName.charCodeAt(1)*3)%15-7)*0.5;
    return Math.min(98,Math.max(5,Math.round(base*mult+noise)));
  }

  function _cfCoaches(stationName,lineId,dir,hour,num){
    const base=_cfCrowd(stationName,hour);
    const key=lineId+'_'+(dir==='a'?'north':'south');
    const stBias=COACH_BIAS[stationName]||{};
    let bias=stBias[key]||stBias[lineId]||null;
    let arr=bias?bias.slice(0,num):Array(num).fill(1.0);
    while(arr.length<num)arr.push(0.8);
    const avg=arr.reduce((a,b)=>a+b,0)/arr.length;
    return arr.map((b,i)=>{
      const crowd=Math.min(100,Math.max(0,Math.round(base*b/avg)));
      return{coach:i+1,crowd,seats:Math.max(0,Math.round(50*(1-crowd/100))),status:crowd>=82?'packed':crowd>=65?'crowded':crowd>=40?'moderate':'empty'};
    });
  }

  function _cfFill(c){return c<40?'rgba(255,255,255,.12)':c<65?'var(--y)':'rgba(255,255,255,.8)'}
  function _cfCol(c){return c<40?'var(--sub)':c<65?'var(--y)':'var(--txt)'}
  function _cfClass(c){return c<40?'c-lo':c<65?'c-mi':'c-hi'}

  function _cfNextTrains(lid,hour){
    const cfg=_getCFLineCfg(lid);
    const peak=(hour>=7&&hour<=10)||(hour>=17&&hour<=20);
    const freq=peak?cfg.fp:cfg.fo;
    return[0,1,2,3,4].map(i=>({mins:i===0?0:freq*i+Math.round(Math.random()*2-1)}));
  }

  function _renderCoachScreen(){
    if(!cfStation||!cfLine)return;
    const s=METRO.STATIONS[cfStation];
    const sName=s?s.n:cfStation;
    const cfg=_getCFLineCfg(cfLine);
    const coaches=_cfCoaches(sName,cfLine,cfDir,cfHour,cfg.coaches);
    const bestIdx=coaches.reduce((bi,c,i,a)=>c.crowd<a[bi].crowd?i:bi,0);
    const best=coaches[bestIdx];
    const avg=Math.round(coaches.reduce((s,c)=>s+c.crowd,0)/coaches.length);
    const trains=_cfNextTrains(cfLine,cfHour);
    const timeLabel=cfHour===new Date().getHours()?'Now':cfHour>12?`${cfHour-12}:00 PM`:cfHour===12?'12:00 PM':`${cfHour}:00 AM`;

    const cards=coaches.map((c,i)=>{
      const isB=i===bestIdx;
      const fillH=Math.round(c.crowd*0.55);
      return`<div class="coach-card ${isB?'best':''}" onclick="document.querySelectorAll('.coach-card').forEach(x=>x.classList.remove('selected'));this.classList.add('selected')" id="cc-${i}">
        ${isB?'<div class="best-tag">BEST</div>':''}
        <div class="c-fill-bg" style="height:${fillH}%;background:${_cfFill(c.crowd)};opacity:.2"></div>
        <div class="coach-inner">
          <div class="c-num">C${c.coach}</div>
          <div class="c-pct" style="color:${_cfCol(c.crowd)}">${c.crowd}%</div>
          <div class="c-seats" style="color:${_cfCol(c.crowd)}">${c.seats} seats</div>
          <div class="c-tag ${_cfClass(c.crowd)}">${c.status}</div>
        </div>
      </div>`;
    }).join('');

    const hm=coaches.map(c=>`<div class="hm-seg" style="background:${_cfFill(c.crowd)};opacity:${.15+c.crowd/100*.6}"></div>`).join('');
    const trainHtml=trains.map((t,i)=>`<div class="nt-chip ${i===0?'now':''}"><div class="nt-min">${i===0?'NOW':t.mins+'m'}</div><div class="nt-lbl">${i===0?'boarding':'next'}</div></div>`).join('');
    const gate=GATE_TIPS[sName];

    document.getElementById('coach-content').innerHTML=`
      <div class="train-section">
        <div class="train-meta">
          <div class="train-meta-l">${cfg.name}</div>
          <div class="train-meta-r">${timeLabel} · ${cfg.coaches} coaches</div>
        </div>
        <div class="train-row"><div class="loco-ico">🚃</div>${cards}</div>
      </div>
      <div class="heatmap">${hm}</div>
      <div class="detail-card active">
        <div class="dc-header">
          <div class="dc-title">Board Coach ${best.coach} · Best option</div>
          <div class="dc-badge" style="background:${_cfFill(best.crowd)};color:${_cfCol(best.crowd)};opacity:.9">${best.status.toUpperCase()}</div>
        </div>
        <div class="dc-grid">
          <div class="dc-stat"><div class="dc-val ${_cfClass(best.crowd)}">${best.crowd}%</div><div class="dc-lbl">Crowd</div></div>
          <div class="dc-stat"><div class="dc-val ${_cfClass(best.crowd)}">${best.seats}</div><div class="dc-lbl">Free seats</div></div>
          <div class="dc-stat"><div class="dc-val c-lo">${avg}%</div><div class="dc-lbl">Train avg</div></div>
          <div class="dc-stat"><div class="dc-val ${_cfClass(best.crowd)}">${Math.max(0,avg-best.crowd)}%</div><div class="dc-lbl">Below avg</div></div>
        </div>
        <div class="dc-tip"><strong>Coach ${best.coach}</strong> is near the <strong>${best.coach<=cfg.coaches/2?'front (engine)':'rear'}</strong> of the train. ${best.crowd<40?' Plenty of space — sit comfortably.':best.crowd<65?' Moderate crowd — you should get a seat.':' Even best coach is packed — try the next train.'}</div>
      </div>
      ${gate?`<div class="gate-card"><div style="font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--sub);margin-bottom:7px">Gate → Coach Guide</div><div class="gt-text">${gate}</div></div>`:''}
      <div class="next-trains">
        <div style="font-size:9px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--sub)">Next Trains · every ${cfg.fp}–${cfg.fo} min</div>
        <div class="nt-row">${trainHtml}</div>
      </div>`;
  }

  // ── UNIFIED SEARCH ENTRY POINT ───────────────────────────────
  function openSearch(mode){
    const LABELS={
      'station':'Check Station',
      'coach-station':'Select Station',
      'r-from':'Select Origin',
      'r-to':'Select Destination',
      'report':'Select Station',
      'home':'Set Home Station',
    };
    overlayMode=mode;
    _openStationOverlay(LABELS[mode]||'Select Station');
  }

  function closeSearch(){closeOverlay();}
  function filterSearch(q){_renderStationList(q);}
  function closeLineSelect(){document.getElementById('ov-line')?.classList.remove('open');}

  function doRoute(){
    if(!routeFrom||!routeTo){showToast('⚠','Pick both stations first');return;}
    if(typeof ROUTE==='undefined'){
      const el=document.getElementById('rres');
      if(el)el.innerHTML='<div class="route-error">Route module loading… try again.</div>';
      return;
    }
    const avoid=true; // always try to avoid packed stations
    const result=ROUTE.compute(routeFrom,routeTo,avoid);
    ROUTE.render(result);
  }

    // ── STATION OVERLAY (shared) ──────────────────────────────────
  function _openStationOverlay(label){
    document.getElementById('ov-lbl').textContent=label;
    document.getElementById('ov-input').value='';
    _renderStationList('');
    document.getElementById('ov-search').classList.add('open');
    setTimeout(()=>document.getElementById('ov-input')?.focus(),80);
  }

  function filterOverlayStations(){
    _renderStationList(document.getElementById('ov-input')?.value||'');
  }

  function _renderStationList(q){
    const all=Object.keys(METRO.STATIONS).sort((a,b)=>METRO.STATIONS[a].n.localeCompare(METRO.STATIONS[b].n));
    const filtered=q?all.filter(id=>METRO.STATIONS[id].n.toLowerCase().includes(q.toLowerCase())):all;
    const LINE_COL_MAP={Y:'#FFD600',B:'#2979FF',R:'#F44336',P:'#E040FB',M:'#AB47BC',V:'#7E57C2',G:'#4CAF50',A:'#FF9800',Gr:'#9E9E9E',Aq:'#00BCD4'};
    const list=document.getElementById('ov-list');if(!list)return;
    list.innerHTML=filtered.slice(0,50).map(id=>{
      const s=METRO.STATIONS[id];if(!s)return'';
      const v=CROWD.state?.crowdMap?.[id]||0;
      const vc=_v3Color(v);
      const dots=s.l.map(l=>`<div class="ov-dot" style="background:${LINE_COL_MAP[l]||'#888'}"></div>`).join('');
      return`<div class="ov-item" onclick="UI._overlayPick('${id}')">
        <div class="ov-ico">${s.ix?'⇄':'·'}</div>
        <div style="flex:1">
          <div class="ov-name">${s.n}</div>
          <div class="ov-line">${s.l.map(l=>METRO.LINE_NAMES[l]).join(' · ')}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <div style="display:flex;gap:3px">${dots}</div>
          <div class="ov-pct" style="color:${vc}">${v?v+'%':''}</div>
        </div>
      </div>`;
    }).join('');
  }

  function _overlayPick(id){
    closeOverlay();
    if(overlayMode==='home') _applyHomeStation(id,true);
    else if(overlayMode==='station') showStationScreen(id);
    else if(overlayMode==='coach-station') pickCoachStation(id);
    else if(overlayMode==='route-from') _setRouteStation('from',id);
    else if(overlayMode==='route-to') _setRouteStation('to',id);
    else if(overlayMode==='report') _setReportStation(id);
  }

  // ── STATION SCREEN ────────────────────────────────────────────
  function showStationScreen(id){
    const s=METRO.STATIONS[id];if(!s)return;
    navTo('s-station');
    const v=CROWD.state?.crowdMap?.[id]||0;
    const c=_v3Color(v),cf=_v3Fill(v);
    // picker label
    const pv=document.getElementById('sp-val');
    if(pv){pv.textContent=s.n;pv.classList.remove('ph');}
    // big crowd number
    const nm=document.getElementById('cc-num');if(nm){nm.innerHTML=v+'<span class="cc-pct">%</span>';nm.style.opacity='1';nm.style.color=c;}
    _s('cc-name',s.n.toUpperCase());
    const lb=document.getElementById('cc-lbl');if(lb){lb.textContent=_v3Label(v);lb.style.opacity='1';lb.style.color=c;}
    const br=document.getElementById('cc-bar');if(br){br.style.width=v+'%';br.style.background=cf;}
    const dt=document.getElementById('cc-dot');if(dt)dt.style.opacity='1';
    _s('cc-meta','Updated just now · '+s.l.map(l=>METRO.LINE_NAMES[l]).join(' · '));
    // safe card
    const sc=document.getElementById('safe-card');
    if(sc){
      sc.style.display='flex';
      const icon=document.getElementById('sc-icon'),ans=document.getElementById('sc-ans'),sub=document.getElementById('sc-sub');
      if(v<40){sc.className='safe-card yes';if(icon)icon.textContent='✓';if(ans)ans.textContent='Good to board now';if(sub)sub.textContent='Low crowd — you should get a seat';}
      else if(v<70){sc.className='safe-card';if(icon)icon.textContent='⚠';if(ans)ans.textContent='Moderate crowd';if(sub)sub.textContent='Standing room — wait may help';}
      else{sc.className='safe-card no';if(icon)icon.textContent='✕';if(ans)ans.textContent='Very crowded — try next train';if(sub)sub.textContent='All seats occupied, packed aisles';}
    }
    // inline report
    const ir=document.getElementById('inline-rep');if(ir)ir.style.display='flex';
    ir?.querySelectorAll('.ir-opt').forEach(o=>o.classList.remove('active'));
    // mini forecast
    const mfc=document.getElementById('mf-card');if(mfc)mfc.style.display='block';
    const mfr=document.getElementById('mf-rows');
    if(mfr&&CROWD.stationForecast){
      const fc=CROWD.stationForecast(id);const now=new Date().getHours();
      mfr.innerHTML=[0,1,2,3].map(i=>{
        const h=(now+i)%24;const fv=fc[h]||0;const fc2=_v3Fill(fv);
        const lbl=i===0?'Now':(h>12?`${h-12}p`:h===12?'12p':`${h}a`);
        return`<div class="mf-row"><div class="mf-time">${lbl}</div><div class="mf-track"><div class="mf-fill" style="width:${fv}%;background:${fc2}"></div></div><div class="mf-val" style="color:${_v3Color(fv)}">${fv}%</div></div>`;
      }).join('');
    }
    // coach link
    const cl=document.getElementById('stn-coach-link');if(cl)cl.style.display='block';
    // community reports
    const cc=document.getElementById('comm-card');if(cc)cc.style.display='block';
    loadStationReports(id);
  }

  function gpsStation(){
    if(!navigator.geolocation){showToast('📡','GPS not available');return;}
    showToast('📡','Finding nearest station…');
    navigator.geolocation.getCurrentPosition(pos=>{
      const {latitude:lat,longitude:lng}=pos.coords;
      let best=null,bestD=Infinity;
      Object.keys(METRO.STATIONS).forEach(id=>{
        const st=METRO.STATIONS[id];
        if(st.gps){const d=Math.hypot(st.gps[0]-lat,st.gps[1]-lng);if(d<bestD){bestD=d;best=id;}}
      });
      if(best)showStationScreen(best);
      else showToast('📡','No station found nearby');
    },()=>showToast('📡','Location access denied'));
  }

  function goCoachFromStation(){
    // pre-fill coach screen with current station
    const pv=document.getElementById('sp-val');
    if(pv&&!pv.classList.contains('ph')){
      // find station ID by name
      const name=pv.textContent;
      const id=Object.keys(METRO.STATIONS).find(k=>METRO.STATIONS[k].n===name);
      if(id)pickCoachStation(id);
    }
    navTo('s-coach');
  }

  function closeOverlay(){
    document.getElementById('ov-search')?.classList.remove('open');
    document.getElementById('ov-line')?.classList.remove('open');
  }

  // ── ROUTE SCREEN ──────────────────────────────────────────────
  function openRouteStationPicker(side){
    overlayMode='route-'+side;
    _openStationOverlay(side==='from'?'Select Origin':'Select Destination');
  }

  function _setRouteStation(side,id){
    const s=METRO.STATIONS[id];if(!s)return;
    const v=CROWD.state?.crowdMap?.[id]||0;
    const vc=_v3Color(v);
    if(side==='from'){
      routeFrom=id;
      const el=document.getElementById('rFrom');if(el){el.textContent=s.n;el.classList.remove('ph');}
      const ce=document.getElementById('rFromC');if(ce){ce.textContent='Crowd: '+v+'%';ce.style.color=vc;ce.style.display='block';}
      const sel=document.getElementById('rFrom');if(sel)sel.value=id;
    } else {
      routeTo=id;
      const el=document.getElementById('rTo');if(el){el.textContent=s.n;el.classList.remove('ph');}
      const ce=document.getElementById('rToC');if(ce){ce.textContent='Crowd: '+v+'%';ce.style.color=vc;ce.style.display='block';}
      const sel=document.getElementById('rTo');if(sel)sel.value=id;
    }
  }

  function swapRoute(){
    const tmpId=routeFrom;routeFrom=routeTo;routeTo=tmpId;
    const fromEl=document.getElementById('rFrom'),toEl=document.getElementById('rTo');
    const fromC=document.getElementById('rFromC'),toC=document.getElementById('rToC');
    const fromSel=document.getElementById('rFrom'),toSel=document.getElementById('rTo');
    // Swap display
    const tmpTxt=fromEl?.textContent;if(fromEl&&toEl){fromEl.textContent=toEl.textContent;toEl.textContent=tmpTxt||'';}
    const tmpCss=fromC?.textContent;if(fromC&&toC){fromC.textContent=toC.textContent||'';toC.textContent=tmpCss||'';}
    if(fromEl)fromEl.classList.toggle('ph',!routeFrom);
    if(toEl)toEl.classList.toggle('ph',!routeTo);
    if(fromSel)fromSel.value=routeFrom||'';
    if(toSel)toSel.value=routeTo||'';
  }

  function _refreshRouteDisplay(){
    if(routeFrom){const s=METRO.STATIONS[routeFrom];const e=document.getElementById('rFrom');if(e&&s){e.textContent=s.n;e.classList.remove('ph');}}
    if(routeTo){const s=METRO.STATIONS[routeTo];const e=document.getElementById('rTo');if(e&&s){e.textContent=s.n;e.classList.remove('ph');}}
  }

  function populateRouteSelects(){
    ['rFrom','rTo'].forEach(eid=>{
      const sel=document.getElementById(eid);if(!sel)return;
      if(sel.options.length>1)return;
      const opts=Object.keys(METRO.STATIONS).sort((a,b)=>METRO.STATIONS[a].n.localeCompare(METRO.STATIONS[b].n))
        .map(id=>`<option value="${id}">${METRO.STATIONS[id].n}</option>`).join('');
      sel.innerHTML=`<option value="">— ${eid==='rFrom'?'From':'To'} —</option>`+opts;
    });
  }

  // ── REPORT SCREEN ─────────────────────────────────────────────
  function openReportStationPicker(){
    overlayMode='report';
    _openStationOverlay('Select Station');
  }

  function _setReportStation(id){
    repStation=id;
    const s=METRO.STATIONS[id];if(!s)return;
    const btnVal=document.getElementById('rep-stn');
    if(btnVal){btnVal.textContent=s.n;btnVal.style.color='var(--txt)';}
    const rpst=document.getElementById('rpst');if(rpst)rpst.value=id;
    _updateRepSubmitBtn();
  }

  function pickCp(el){
    document.querySelectorAll('.cp').forEach(c=>c.classList.remove('sel'));
    el.classList.add('sel');
    selLevel=el.dataset.v||'';
    _updateRepSubmitBtn();
  }

  function _updateRepSubmitBtn(){
    const btn=document.getElementById('rep-btn');
    if(btn)btn.disabled=!(repStation&&selLevel);
  }

  function _initKarma(){
    _s('karma-num',karma);
  }

  function _incKarma(){
    karma++;
    localStorage.setItem('v3_karma',karma);
    _s('karma-num',karma);
    _s('rs-karma',karma);
    const sub=document.getElementById('karma-sub');
    if(sub)sub.textContent=`${karma} report${karma!==1?'s':''} submitted`;
  }

  function populateRpFilter(){
    const sel=document.getElementById('rp-filter');if(!sel)return;
    if(sel.options.length>1)return;
    const opts=Object.keys(METRO.STATIONS).sort((a,b)=>METRO.STATIONS[a].n.localeCompare(METRO.STATIONS[b].n))
      .map(id=>`<option value="${id}">${METRO.STATIONS[id].n}</option>`).join('');
    sel.innerHTML='<option value="">— All recent reports —</option>'+opts;
  }

  // ── QUICK REPORT from panel ───────────────────────────────────
  function quickReport(el,level){
    document.querySelectorAll('.ir-opt').forEach(o=>o.classList.remove('active'));
    el.classList.add('active');
    // Determine station from station screen or legacy panelId
    const pvEl=document.getElementById('sp-val');
    const stationName=pvEl&&!pvEl.classList.contains('ph')?pvEl.textContent:null;
    const stId=stationName?Object.keys(METRO.STATIONS).find(k=>METRO.STATIONS[k].n===stationName):null;
    const qrStation=stId||panelId;
    if(qrStation){
      CROWD.state.userReports[panelId]=level;
      triggerUpdate();
      if(typeof SB!=='undefined'&&SB.isReady)SB.submitReport(qrStation,level);
      showToast('✅','Report submitted — thanks!');
    }
    setTimeout(()=>el.classList.remove('active'),2500);
  }

  // ── TOAST ─────────────────────────────────────────────────────
  function showToast(ico,txt){
    _s('tIco',ico);_s('tTxt',txt);
    const t=document.getElementById('toast');if(!t)return;
    t.classList.add('show');
    clearTimeout(showToast._tt);
    showToast._tt=setTimeout(()=>t.classList.remove('show'),2800);
  }
  function hideToast(){document.getElementById('toast')?.classList.remove('show')}

  function refreshIfActive(tab){if(activeTab===tab)switchTab(tab)}

  function updateHeader(){
    const ns=CROWD.networkStats();
    const a=document.getElementById('navg');if(a){a.textContent=ns.avg+'%';a.style.color=CROWD.color(ns.avg)}
    ['sn0','sn1','sn2','sn3','sn4'].forEach((id,i)=>{const e=document.getElementById(id);if(e)e.textContent=[ns.low,ns.med,ns.hi,ns.pk,ns.total][i]});
    const rc=Object.keys(CROWD.state.userReports).length;
    const rt=document.getElementById('rtxt');if(rt)rt.textContent=rc+' Report'+(rc!==1?'s':'');
    const ae=CROWD.state.newsEvents.filter(e=>e.active).length;
    const et=document.getElementById('etxt');const ed=document.getElementById('edot');
    if(et&&ae>0){et.textContent=ae+' Events Active';if(ed)ed.style.background='#FF6B00'}
  }

  function openPanel(id){
    if(!id){closePanel();return}
    const s=METRO.STATIONS[id];if(!s)return;
    panelId=id;
    const v=CROWD.state.crowdMap[id]||0,c=CROWD.color(v);
    _s('spn',s.n);
    _s('spl',s.l.map(l=>METRO.LINE_NAMES[l]).join(' · ')+(s.ix?' · Interchange':''));

    // ── Service hours ─────────────────────────────────────────
    const shEl=document.getElementById('sp-service-hours');
    if(shEl){
      const sh=METRO.stationServiceHours(id);
      const nowH=CROWD.state.hour;
      const isOpen=nowH>=sh.open&&nowH<=sh.close;
      const openLines=s.l.map(l=>METRO.SERVICE_HOURS[l]).filter(Boolean);
      const firstTrain=openLines.map(l=>l.firstTrain).sort()[0]||'—';
      const lastTrain=openLines.map(l=>l.lastTrain).sort().reverse()[0]||'—';
      shEl.innerHTML=isOpen
        ?`<span style="color:var(--low)">● Open</span> · First ${firstTrain} · Last ${lastTrain}`
        :`<span style="color:var(--sub)">○ Closed</span> · Opens ${firstTrain} · Last ${lastTrain}`;
    }

    // ── Coach Guide ───────────────────────────────────────────
    const coachEl=document.getElementById('sp-coach');
    if(coachEl&&typeof COACH!=='undefined'){
      coachEl.innerHTML=COACH.renderCoachStrip(id,s.l[0],v);
    }

    // ── Confidence + anomaly ──────────────────────────────────
    const cbEl=document.getElementById('sp-confidence');
    if(cbEl)cbEl.innerHTML=typeof NOTIFY!=='undefined'?NOTIFY.confidenceBadge(id):'';
    const abEl=document.getElementById('sp-anomaly');
    if(abEl)abEl.innerHTML=typeof NOTIFY!=='undefined'?NOTIFY.anomalyBanner(id):'';

    // ── Crowd card ────────────────────────────────────────────
    const numEl=document.getElementById('sc1');
    if(numEl){numEl.textContent=v+'%';numEl.style.color=c;}
    const lblEl=document.getElementById('sc2');
    if(lblEl){lblEl.textContent=CROWD.label(v);lblEl.style.color=c;}
    const waitEl=document.getElementById('sc3');
    if(waitEl)waitEl.textContent=CROWD.waitLabel(v);
    const barEl=document.getElementById('spb');
    if(barEl){barEl.style.width=v+'%';barEl.style.background=c;}
    const dotEl=document.getElementById('sp-dot');
    if(dotEl)dotEl.style.opacity='1';

    // ── Station name in crowd card ────────────────────────────
    const ccn=document.getElementById('sp-cc-name');
    if(ccn)ccn.textContent=s.n.toUpperCase();

    // ── Safe-to-board card ────────────────────────────────────
    const sc=document.getElementById('sp-safe');
    if(sc){
      sc.style.display='flex';
      if(v<40){sc.className='safe-card yes';_s('sp-safe-icon','✓');_s('sp-safe-ans','Good to board now');_s('sp-safe-sub','Crowd is low. ~1 train wait.');}
      else if(v<70){sc.className='safe-card';_s('sp-safe-icon','⏱');_s('sp-safe-ans','Wait 10–15 minutes');_s('sp-safe-sub','Crowd will ease soon.');}
      else{sc.className='safe-card';_s('sp-safe-icon','✕');_s('sp-safe-ans','Avoid right now');_s('sp-safe-sub','Very packed. Try alternate route.');}
    }

    // ── Line dots ─────────────────────────────────────────────
    const ld=document.getElementById('sp-line-dots');
    if(ld)ld.innerHTML=s.l.map(l=>`<span style="width:8px;height:8px;border-radius:50%;background:${METRO.LINE_COLORS[l]};display:inline-block;margin-right:2px"></span><span style="font-size:8px;color:var(--sub);font-weight:600">${METRO.LINE_NAMES[l]}</span>`).join('<span style="color:var(--sub);margin:0 4px">·</span>');

    // ── Subscribe button ──────────────────────────────────────
    const sbEl=document.getElementById('sp-sub-btn');
    if(sbEl){
      const isSub=typeof NOTIFY!=='undefined'&&NOTIFY.isSubscribed(id);
      sbEl.dataset.id=id;sbEl.dataset.sub=isSub?'1':'0';
      sbEl.textContent=isSub?'🔔 Alerts on':'🔕 Alert';
      sbEl.style.borderColor=isSub?'rgba(0,230,118,.4)':'';
      sbEl.style.color=isSub?'var(--low)':'';
    }

    // ── Sparkline ─────────────────────────────────────────────
    const sp=document.getElementById('spspk');
    if(sp){const fc=CROWD.stationForecast(id);sp.innerHTML=fc.map((fv,h)=>`<div class="spk" style="height:${Math.round(fv*.26)}px;background:${h===CROWD.state.hour?c:CROWD.color(fv)};opacity:${h===CROWD.state.hour?1:.5};flex:1;min-width:2px;border-radius:1px 1px 0 0"></div>`).join('')}

    document.getElementById('sp')?.classList.add('show');
    if(activeTab==='map'&&typeof MAP!=='undefined'&&MAP.flyTo)MAP.flyTo(id);
    loadPanelReports(id);
  }

  function closePanel(){panelId=null;document.getElementById('sp')?.classList.remove('show')}
  function refreshPanel(){if(panelId)openPanel(panelId)}

  function setupSlider(){
    const sl=document.getElementById('ts');if(!sl)return;
    sl.value=CROWD.state.hour;
    _s('tl',CROWD.hourLabel(CROWD.state.hour));
    sl.addEventListener('input',()=>{
      CROWD.state.hour=+sl.value;CROWD.state.isLive=false;
      _s('tl',CROWD.hourLabel(CROWD.state.hour));_s('tm','⏱ SIMULATE');
      triggerUpdate();if(activeTab==='stats')renderTimeline();
    });
  }

  function setupFilters(){
    document.querySelectorAll('.lfb').forEach(b=>{
      b.addEventListener('click',()=>{
        const l=b.dataset.l;
        document.querySelectorAll('.lfb').forEach(x=>{
          x.classList.remove('on');x.style.background='';
          x.style.color=x.dataset.l==='all'?'':(METRO.LINE_COLORS[x.dataset.l]||'');
          x.style.borderColor='';
        });
        b.classList.add('on');
        b.style.background=l==='all'?'var(--accent)':(METRO.LINE_COLORS[l]||'var(--accent)');
        b.style.color='#000';b.style.borderColor='transparent';
        if(typeof MAP!=='undefined'&&MAP.setLineFilter)MAP.setLineFilter(l);
      });
    });
  }

  // STATS
  function renderStats(){renderSummary();renderTimeline();renderIX();renderAnomalies()}

  function renderSummary(){
    const ns=CROWD.networkStats();const bs=METRO.STATIONS[ns.maxId];
    const anomCount = typeof NOTIFY!=='undefined' ? Object.keys(NOTIFY.anomalyMap).length : 0;
    document.getElementById('sg').innerHTML=`
      <div class="sg-card"><div class="sg-val" style="color:${CROWD.color(ns.avg)}">${ns.avg}%</div><div class="sg-lbl">Network Avg</div></div>
      <div class="sg-card"><div class="sg-val" style="color:${CROWD.color(ns.max)}">${ns.max}%</div><div class="sg-lbl">Peak Crowd</div></div>
      <div class="sg-card"><div class="sg-val" style="color:var(--low)">${ns.low}</div><div class="sg-lbl">Low Stations</div></div>
      <div class="sg-card"><div class="sg-val" style="color:var(--pk)">${ns.pk}</div><div class="sg-lbl">Packed Now</div></div>
      <div class="sg-card sg-clickable" onclick="UI.openStationFromStats('${ns.maxId}')">
        <div class="sg-val" style="font-size:10px;color:#fff;line-height:1.3">${bs?.n||'—'}</div>
        <div class="sg-lbl">Busiest ↗</div></div>
      <div class="sg-card"><div class="sg-val">${CROWD.hourLabel(CROWD.state.hour)}</div><div class="sg-lbl">Sim Time</div></div>
      <div class="sg-card"><div class="sg-val">${ns.total}</div><div class="sg-lbl">Total Stations</div></div>
      <div class="sg-card"><div class="sg-val" style="color:${anomCount>0?'var(--pk)':'var(--muted)'}">${anomCount}</div><div class="sg-lbl">⚡ Anomalies</div></div>
      <div class="sg-card"><div class="sg-val" style="color:var(--muted)">${ns.closed||0}</div><div class="sg-lbl">Closed Now</div></div>`;
  }

  function renderAnomalies(){
    const el=document.getElementById('anomaly-list');if(!el)return;
    if(typeof NOTIFY==='undefined'){el.innerHTML='';return}
    const list=NOTIFY.getAnomalies();
    if(!list.length){
      el.innerHTML='<div style="font-size:9px;color:var(--muted);font-family:Space Mono,monospace;padding:10px;text-align:center">No anomalies detected — model and reports agree ✓</div>';
      return;
    }
    el.innerHTML=list.map(a=>{
      const s=METRO.STATIONS[a.stationId];
      const conf=NOTIFY.confidenceMap[a.stationId];
      const isSub=NOTIFY.isSubscribed(a.stationId);
      return`<div class="anomaly-row" onclick="UI.openStationFromStats('${a.stationId}')">
        <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
          <span style="font-size:16px">${a.icon}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:11px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s?.n||a.stationId}</div>
            <div style="font-size:8px;font-family:'Space Mono',monospace;color:${a.color};margin-top:2px">${a.label}</div>
            <div style="font-size:8px;font-family:'Space Mono',monospace;color:var(--muted);margin-top:1px">Model ${a.modelVal}% → Reported ${a.blendedVal}% · ${conf?.tier||'low'} confidence</div>
          </div>
        </div>
        <button onclick="event.stopPropagation();NOTIFY.toggleSubscription('${a.stationId}')"
          style="flex-shrink:0;font-size:14px;background:none;border:none;cursor:pointer;opacity:${isSub?1:.4}"
          title="${isSub?'Unsubscribe':'Subscribe for alerts'}">${isSub?'🔔':'🔕'}</button>
      </div>`;
    }).join('');
  }

  function renderTimeline(){
    const svg2=document.getElementById('tlsvg');if(!svg2)return;
    const td=CROWD.networkTimeline();const W=360,H=80;
    const pts=td.map((v,h)=>`${(h/23)*(W-20)+10},${H-10-(v/100)*(H-24)}`).join(' ');
    const ap=`10,${H-10} `+td.map((v,h)=>`${(h/23)*(W-20)+10},${H-10-(v/100)*(H-24)}`).join(' ')+` ${W-10},${H-10}`;
    const cx=(CROWD.state.hour/23)*(W-20)+10,cy=H-10-(td[CROWD.state.hour]/100)*(H-24);
    const rush=[[6,10],[16,21]].map(([a,b])=>`<rect x="${(a/23)*(W-20)+10}" y="4" width="${((b-a)/23)*(W-20)}" height="${H-16}" fill="#FF6B00" opacity=".07" rx="2"/>`).join('');
    const ticks=[0,3,6,9,12,15,18,21].map(h=>{const x=(h/23)*(W-20)+10;const l=h===0?'12A':h===12?'12P':h<12?h+'A':(h-12)+'P';return`<text x="${x}" y="${H}" fill="#3E5272" font-size="6.5" font-family="Space Mono,monospace" text-anchor="middle">${l}</text>`}).join('');
    svg2.innerHTML=`<defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FF6B00" stop-opacity=".35"/><stop offset="100%" stop-color="#FF6B00" stop-opacity="0"/></linearGradient></defs>${rush}<polygon points="${ap}" fill="url(#tg)"/><polyline points="${pts}" fill="none" stroke="#FF6B00" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>${ticks}<line x1="${cx}" y1="4" x2="${cx}" y2="${H-10}" stroke="#FF6B00" stroke-width="1.2" stroke-dasharray="3,2" opacity=".8"/><circle cx="${cx}" cy="${cy}" r="3.5" fill="#FF6B00" stroke="#080C12" stroke-width="1.5"/><rect x="${cx-12}" y="${cy-14}" width="24" height="12" rx="3" fill="#FF6B00"/><text x="${cx}" y="${cy-5}" fill="#000" font-size="7" font-family="Space Mono,monospace" text-anchor="middle" font-weight="700">${td[CROWD.state.hour]}%</text>`;
  }

  function renderIX(){
    const data=CROWD.interchangePressure(10);
    document.getElementById('ixlist').innerHTML=data.map(({id,n,v},i)=>`
      <div class="ixr" onclick="UI.openStationFromStats('${id}')">
        <div class="ixrk">${i+1}</div><div class="ixnm">${n}</div>
        <div class="ixbw"><div class="ixbar" style="width:${v}%;background:${CROWD.color(v)}"></div></div>
        <div class="ixpct" style="color:${CROWD.color(v)}">${v}%</div></div>`).join('');
  }

  // LINES
  function renderLines(){
    document.getElementById('lclist').innerHTML=CROWD.lineAverages().map(({l,avg,name,color,count,isOpen,firstTrain,lastTrain})=>`
      <div class="lr">
        <div class="ldot" style="background:${isOpen?color:'#2A3F58'}"></div>
        <div class="lnm" style="flex:1;min-width:0">
          <div>${name} <span style="color:var(--muted);font-size:8px">(${count})</span></div>
          <div style="font-size:7px;font-family:'Space Mono',monospace;color:var(--muted);margin-top:1px">${isOpen?`● Open · Last ${lastTrain}`:`○ Closed · Opens ${firstTrain}`}</div>
        </div>
        <div class="lbw"><div class="lbar" style="width:${avg}%;background:${isOpen?color:'#2A3F58'};opacity:${isOpen?.85:.35}"></div></div>
        <div class="lpct" style="color:${isOpen?CROWD.color(avg):'var(--muted)'}">${isOpen?avg+'%':'—'}</div>
      </div>`).join('');
    const top=CROWD.topStations(12);
    document.getElementById('toplist').innerHTML=top.map(({id,v,s},i)=>s?`
      <div class="ixr" onclick="UI.openStationFromStats('${id}')">
        <div class="ixrk">#${i+1}</div><div class="ixnm">${s.n}</div>
        <div style="font-size:8px;font-family:'Space Mono',monospace;flex-shrink:0;margin-right:3px;color:${METRO.LINE_COLORS[s.l[0]]}">${s.l[0]}</div>
        <div class="ixbw"><div class="ixbar" style="width:${v}%;background:${CROWD.color(v)}"></div></div>
        <div class="ixpct" style="color:${CROWD.color(v)}">${v}%</div></div>`:'').join('');
  }

  // EVENTS — news-only
  function renderEvents(){
    const all=CROWD.state.newsEvents;
    const nsEl=document.getElementById('news-status');
    if(nsEl){
      const act=all.filter(e=>e.active).length;
      const op=all.filter(e=>e.category==='operational').length;
      nsEl.textContent=all.length
        ?`${all.length} articles · ${op} operational · ${act} boosting model · auto-refreshes every 20min`
        :'Scanning Google News RSS…';
    }
    if(!all.length){
      document.getElementById('evlist').innerHTML='<div style="font-size:9px;color:var(--muted);font-family:Space Mono,monospace;padding:14px;text-align:center;line-height:1.8">📡 Scanning Google News RSS for Delhi Metro alerts…<br>Results appear within 30 seconds.</div>';
      return;
    }
    document.getElementById('evlist').innerHTML=all.map(ev=>{

      // ── Severity colour ────────────────────────────────────────
      const sevCol={
        security:'var(--pk)',emergency:'var(--pk)',closure:'var(--pk)',
        protest:'var(--hi)',  delay:'var(--med)',   crowd:'var(--a2)',
        event:'var(--a2)',    weather:'#64B5F6',    maintenance:'var(--muted)',
        announcement:'var(--muted)',
      }[ev.sev]||'var(--muted)';

      // ── Station pills (only for specific-station events) ───────
      let locationLine='';
      if(ev.networkEvent){
        locationLine=`<div class="ev-location ev-network">🌐 Network-wide — applied to interchange stations only</div>`;
      } else if((ev.affected||[]).length>0){
        const stNames=(ev.affected||[]).slice(0,4).map(id=>METRO.STATIONS[id]?.n||id);
        const extra=(ev.affected?.length||0)>4?` +${ev.affected.length-4} more`:'';
        locationLine=`<div class="ev-location">📍 ${stNames.join(' · ')}${extra}</div>`;
      }

      // ── Live crowd pills (operational + active + specific stations only) ──
      let crowdPills='';
      if(ev.active && !ev.networkEvent && (ev.affected||[]).length){
        crowdPills=(ev.affected||[]).slice(0,5).map(id=>{
          const v=CROWD.state.crowdMap[id]||0,c=CROWD.color(v);
          return`<span class="ev-pill" style="background:${c}22;color:${c};border-color:${c}44">${(METRO.STATIONS[id]?.n||id).split(' ')[0]} ${v}%</span>`;
        }).join('');
      }

      // ── Boost breakdown (only show for operational) ────────────
      let boostLine='';
      if(ev.category==='operational' && ev.boost>1.01){
        const pct=Math.round((ev.boost-1)*100);
        const bd=ev.boostBreakdown;
        const ncf=bd?(ev.newsCount>1?` · ${ev.newsCount} sources`:''):'';
        boostLine=`<div class="ev-boost-line">
          <span class="ev-boost-pct" style="color:${sevCol}">+${pct}% crowd surge</span>
          ${ncf?`<span class="ev-boost-meta">${ncf}</span>`:''}
        </div>`;
      }

      // ── Confidence: based on newsCount + age + category ───────
      let confTier='Low', confColor='var(--muted)', confIcon='○';
      if(ev.category==='informational'){
        confTier='None'; confColor='var(--muted)'; confIcon='—';
      } else {
        const nc=ev.newsCount||1;
        const fresh=ev.ageMs<3*3600*1000;
        if(nc>=3||(nc>=2&&fresh)){confTier='High';confColor='var(--low)';confIcon='●●●';}
        else if(nc>=2||fresh){confTier='Medium';confColor='var(--med)';confIcon='●●○';}
        else{confTier='Low';confColor='var(--muted)';confIcon='●○○';}
      }

      // ── Trigger: what classification rule matched ──────────────
      const triggerLabel=ev.label||ev.sev||'General';

      // ── Category badge ─────────────────────────────────────────
      const catBadge=ev.category==='informational'
        ?`<span class="ev-cat-badge ev-info-badge">ℹ Info only</span>`
        :'';

      return`<div class="nec ${ev.active?'aev':''} ${ev.category==='informational'?'nec-info':''}" id="ec-${ev.id}">
        <div class="neh">
          <div style="flex:1;min-width:0">

            <!-- Title row -->
            <div class="nen">${ev.icon} ${ev.name}</div>

            <!-- Status + category badge -->
            <div class="ev-status-row">
              ${ev.category==='operational'
                ? `<span class="ev-status-dot" style="color:${ev.active?sevCol:'var(--muted)'}">${ev.active?'● ACTIVE':'○ Monitoring'}</span>`
                : `<span class="ev-status-dot" style="color:var(--muted)">○ Info</span>`
              }
              ${catBadge}
              <span class="ev-time">${ev.date||''} ${ev.time||''}</span>
            </div>

            <!-- Boost line (operational only) -->
            ${boostLine}

            <!-- Description -->
            ${ev.detail?`<div class="ned">${ev.detail}</div>`:''}

            <!-- Location -->
            ${locationLine}

            <!-- Live crowd pills -->
            ${crowdPills?`<div class="ev-pills-row">${crowdPills}</div>`:''}

            <!-- ── Credibility footer ─────────────────────────── -->
            <div class="ev-cred-footer">
              <div class="ev-cred-item">
                <span class="ev-cred-lbl">Source</span>
                ${ev.url
                  ?`<a href="${ev.url}" target="_blank" class="ev-cred-val ev-source-link">${ev.source||'News'} ↗</a>`
                  :`<span class="ev-cred-val">${ev.source||'Google News'}</span>`
                }
              </div>
              <div class="ev-cred-item">
                <span class="ev-cred-lbl">Confidence</span>
                <span class="ev-cred-val" style="color:${confColor}">${confIcon} ${confTier}</span>
              </div>
              <div class="ev-cred-item">
                <span class="ev-cred-lbl">Trigger</span>
                <span class="ev-cred-val">${triggerLabel}</span>
              </div>
            </div>

          </div>
        </div>
      </div>`;
    }).join('');
  }

  function toggleEvent(id){
    // kept for backward-compat but no longer wired to UI buttons
    const ev=CROWD.state.newsEvents.find(e=>e.id===id);
    if(ev){ev.active=!ev.active;triggerUpdate();renderEvents();}
  }

  // ══════════════════════════════════════════════════════════════
  //  REPORT SECTION
  // ══════════════════════════════════════════════════════════════

  // In-memory cache: stationId → [{station_id, station_name, level, created_at, session_id}]
  const reportCache = {};           // stationId → rows[]
  const REPORT_EXPIRY = 2*3600*1000; // 2 hours in ms
  let reportFilterId = '';           // current filter in report tab

  function populateReportSelect(){
    // Submit station selector
    const sel=document.getElementById('rpst');if(!sel)return;
    const prev=sel.value;
    sel.innerHTML='<option value="">— Select your station —</option>'+
      Object.entries(METRO.STATIONS).sort((a,b)=>a[1].n.localeCompare(b[1].n))
        .map(([id,s])=>`<option value="${id}">${s.n} (${s.l.join('/')})</option>`).join('');
    if(prev)sel.value=prev;

    // Filter selector in community reports
    const flt=document.getElementById('rp-filter');if(!flt)return;
    const fprev=flt.value;
    flt.innerHTML='<option value="">— All recent reports —</option>'+
      Object.entries(METRO.STATIONS).sort((a,b)=>a[1].n.localeCompare(b[1].n))
        .map(([id,s])=>`<option value="${id}">${s.n}</option>`).join('');
    if(fprev)flt.value=fprev;
  }

  // ── Time-ago helper ─────────────────────────────────────────
  function timeAgo(isoStr){
    if(!isoStr) return '';
    const diff=Date.now()-new Date(isoStr).getTime();
    if(diff<60000)     return `${Math.round(diff/1000)}s ago`;
    if(diff<3600000)   return `${Math.round(diff/60000)} min ago`;
    if(diff<86400000)  return `${Math.round(diff/3600000)}h ago`;
    return new Date(isoStr).toLocaleDateString('en-IN',{month:'short',day:'numeric'});
  }

  // ── Render a list of report rows into a container element ───
  function _renderRows(rows, el, stationName){
    if(!el) return;
    if(!rows||!rows.length){
      el.innerHTML=`<div class="rp-empty">
        <div>No community reports yet.</div>
        <div style="margin-top:4px;color:var(--muted)">Submit one above to help improve predictions.</div>
      </div>`;
      return;
    }
    // Filter out expired rows (belt-and-suspenders over DB expires_at)
    const fresh=rows.filter(r=>Date.now()-new Date(r.created_at).getTime()<REPORT_EXPIRY);
    if(!fresh.length){
      el.innerHTML=`<div class="rp-empty">All reports have expired (2h limit).<br>Submit a fresh report above.</div>`;
      return;
    }
    el.innerHTML=fresh.map(r=>{
      const lv=r.level||'moderate';
      const c=lv==='empty'?'var(--low)':lv==='moderate'?'var(--med)':'var(--pk)';
      const bg=lv==='empty'?'rgba(0,230,118,.08)':lv==='moderate'?'rgba(255,214,0,.08)':'rgba(255,23,68,.08)';
      const icon=lv==='empty'?'🟢':lv==='moderate'?'🟡':'🔴';
      const name=stationName||(r.station_name||METRO.STATIONS[r.station_id]?.n||r.station_id);
      const ago=timeAgo(r.created_at);
      const isOwn=r.session_id&&r.session_id===(typeof ANON!=='undefined'?ANON.id():localStorage.getItem('metro_anon_id'));
      return`<div class="rpit" id="rp-${r.id||r.created_at}">
        <div style="flex:1;min-width:0">
          ${stationName?'':`<div class="rpnm" style="font-size:10px">${name}</div>`}
          <div style="display:flex;align-items:center;gap:6px;margin-top:${stationName?'0':'2px'}">
            <span style="font-size:11px">${icon}</span>
            <span class="rplv" style="color:${c};background:${bg}">${lv.charAt(0).toUpperCase()+lv.slice(1)}</span>
            <span style="font-size:8px;color:var(--muted);font-family:'Space Mono',monospace">${ago}</span>
            ${isOwn?'<span style="font-size:7px;color:var(--muted);font-family:Space Mono,monospace;border:1px solid var(--border);border-radius:4px;padding:0 4px">you</span>':''}
          </div>
        </div>
      </div>`;
    }).join('');
  }

  // ── Load reports for a specific station from Supabase ───────
  async function loadStationReports(stationId){
    reportFilterId = stationId||'';
    const listEl   = document.getElementById('rplist');
    const statusEl = document.getElementById('rplist-status');
    if(!listEl) return;

    // Show loading state
    if(statusEl) statusEl.textContent='Loading…';
    listEl.innerHTML=`<div class="rp-empty" style="color:var(--muted)">Loading reports…</div>`;

    if(!stationId){
      // No filter → show all recent reports across network
      await loadNetworkReports();
      return;
    }

    // Check cache first (< 90s old)
    const cached=reportCache[stationId];
    if(cached&&Date.now()-cached.ts<90000){
      _renderRows(cached.rows, listEl, METRO.STATIONS[stationId]?.n);
      if(statusEl) statusEl.textContent=`${cached.rows.length} report${cached.rows.length!==1?'s':''} · from cache`;
      return;
    }

    if(!window.SB?.isReady){
      // Fallback to local memory
      const local=CROWD.state.userReports[stationId];
      if(local){
        _renderRows([{
          station_id:stationId,
          station_name:METRO.STATIONS[stationId]?.n||stationId,
          level:local,
          created_at:new Date().toISOString(),
          session_id:(typeof ANON!=='undefined'?ANON.id():localStorage.getItem('metro_anon_id')),
        }], listEl, METRO.STATIONS[stationId]?.n);
        if(statusEl) statusEl.textContent='Local only (Supabase not connected)';
      } else {
        _renderRows([], listEl, METRO.STATIONS[stationId]?.n);
        if(statusEl) statusEl.textContent='';
      }
      return;
    }

    try{
      const twoHrsAgo=new Date(Date.now()-REPORT_EXPIRY).toISOString();
      const {data,error}=await SB.client
        .from('crowd_reports')
        .select('id,station_id,station_name,level,created_at,session_id')
        .eq('station_id', stationId)
        .gt('created_at', twoHrsAgo)     // only within 2h expiry window
        .order('created_at',{ascending:false})
        .limit(10);

      if(error) throw error;

      // Cache result
      reportCache[stationId]={rows:data||[],ts:Date.now()};

      _renderRows(data||[], listEl, METRO.STATIONS[stationId]?.n);
      const n=data?.length||0;
      if(statusEl) statusEl.textContent=
        n ? `${n} report${n!==1?'s':''} in last 2h` : '';

    }catch(err){
      console.warn('[UI] loadStationReports:', err.message);
      listEl.innerHTML=`<div class="rp-empty">Could not load reports. Check connection.</div>`;
      if(statusEl) statusEl.textContent='';
    }
  }

  // ── Load recent reports across the whole network ─────────────
  async function loadNetworkReports(){
    const listEl  =document.getElementById('rep-feed');
    const statusEl=document.getElementById('rplist-status');

    if(!window.SB?.isReady){
      // Fall back to local memory
      const entries=Object.entries(CROWD.state.userReports);
      if(!entries.length){_renderRows([],listEl);if(statusEl)statusEl.textContent='';return;}
      _renderRows(entries.map(([sid,lv])=>({
        station_id:sid, station_name:METRO.STATIONS[sid]?.n||sid,
        level:lv, created_at:new Date().toISOString(),
        session_id:(typeof ANON!=='undefined'?ANON.id():localStorage.getItem('metro_anon_id')),
      })),listEl);
      if(statusEl)statusEl.textContent='Local session only';
      return;
    }

    try{
      const twoHrsAgo=new Date(Date.now()-REPORT_EXPIRY).toISOString();
      const {data,error}=await SB.client
        .from('crowd_reports')
        .select('id,station_id,station_name,level,created_at,session_id')
        .gt('created_at', twoHrsAgo)
        .order('created_at',{ascending:false})
        .limit(30);
      if(error) throw error;
      _renderRows(data||[], listEl, null);
      const n=data?.length||0;
      if(statusEl) statusEl.textContent=n?`${n} reports network-wide in last 2h`:'';
    }catch(err){
      _renderRows([],listEl);
      if(statusEl)statusEl.textContent='';
    }
  }

  // ── Station panel mini-report list (top 5 for selected station) ─
  async function loadPanelReports(stationId){
    const listEl  =document.getElementById('sp-replist');
    const countEl =document.getElementById('sp-rep-count');
    if(!listEl) return;

    listEl.innerHTML=`<div class="rp-empty" style="padding:6px 0;font-size:8px">Loading…</div>`;

    // Use cache if available
    const cached=reportCache[stationId];
    if(cached&&Date.now()-cached.ts<90000){
      _renderRows(cached.rows.slice(0,5), listEl, METRO.STATIONS[stationId]?.n);
      if(countEl) countEl.textContent=cached.rows.length?`(${cached.rows.length})` :'';
      return;
    }

    if(!window.SB?.isReady){
      // Local fallback
      const local=CROWD.state.userReports[stationId];
      _renderRows(local?[{station_id:stationId,station_name:METRO.STATIONS[stationId]?.n,
        level:local,created_at:new Date().toISOString(),
        session_id:(typeof ANON!=='undefined'?ANON.id():localStorage.getItem('metro_anon_id'))}]:[], listEl, METRO.STATIONS[stationId]?.n);
      if(countEl) countEl.textContent='';
      return;
    }

    try{
      const twoHrsAgo=new Date(Date.now()-REPORT_EXPIRY).toISOString();
      const {data,error}=await SB.client
        .from('crowd_reports')
        .select('id,station_id,station_name,level,created_at,session_id')
        .eq('station_id', stationId)
        .gt('created_at', twoHrsAgo)
        .order('created_at',{ascending:false})
        .limit(5);
      if(error) throw error;
      reportCache[stationId]={rows:data||[],ts:Date.now()};
      _renderRows(data||[], listEl, METRO.STATIONS[stationId]?.n);
      if(countEl) countEl.textContent=data?.length?`(${data.length})`:'';
    }catch(err){
      _renderRows([],listEl,METRO.STATIONS[stationId]?.n);
      if(countEl) countEl.textContent='';
    }
  }

  // ── Prepend a new report row in realtime ─────────────────────
  // Called by supabase.js realtime subscription on INSERT
  function prependReport(row){
    if(!row?.station_id) return;

    // Invalidate cache for this station
    delete reportCache[row.station_id];

    // Prepend to station panel if it's currently open
    if(panelId===row.station_id){
      const listEl=document.getElementById('sp-replist');
      const countEl=document.getElementById('sp-rep-count');
      if(listEl){
        const emptyMsg=listEl.querySelector('.rp-empty');
        if(emptyMsg) listEl.innerHTML='';

        const lv=row.level||'moderate';
        const c=lv==='empty'?'var(--low)':lv==='moderate'?'var(--med)':'var(--pk)';
        const bg=lv==='empty'?'rgba(0,230,118,.08)':lv==='moderate'?'rgba(255,214,0,.08)':'rgba(255,23,68,.08)';
        const icon=lv==='empty'?'🟢':lv==='moderate'?'🟡':'🔴';
        const newEl=document.createElement('div');
        newEl.className='rpit rpit-new';
        newEl.innerHTML=`
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:11px">${icon}</span>
              <span class="rplv" style="color:${c};background:${bg}">${lv.charAt(0).toUpperCase()+lv.slice(1)}</span>
              <span style="font-size:8px;color:var(--muted);font-family:'Space Mono',monospace">just now</span>
              <span style="font-size:7px;color:var(--low);font-family:Space Mono,monospace">● live</span>
            </div>
          </div>`;
        listEl.prepend(newEl);
        // Remove highlight after 4s
        setTimeout(()=>newEl.classList.remove('rpit-new'),4000);
        // Trim to 5 rows
        while(listEl.children.length>5) listEl.removeChild(listEl.lastChild);
        if(countEl){
          const n=listEl.children.length;
          countEl.textContent=n?`(${n})`:'';
        }
      }
    }

    // Prepend to report tab list if filter matches
    if(activeTab==='report'){
      const flt=document.getElementById('rp-filter');
      if(!flt||!flt.value||flt.value===row.station_id){
        loadStationReports(flt?.value||'');
      }
    }
  }

  function pickLevel(lv){
    selLevel=lv;
    document.querySelectorAll('.clb').forEach(b=>{b.className='clb';if(b.dataset.lv===lv)b.classList.add(lv==='empty'?'se':lv==='moderate'?'sm':'sp')});
  }

  function submitReport(){
    const id=repStation;
    if(!id||!selLevel){showToast('⚠','Pick a station and crowd level first');return;}

    // Optimistic local update
    CROWD.state.userReports[id]=selLevel;
    triggerUpdate();

    // Prepend into report feed
    prependReport({
      station_id:id, station_name:METRO.STATIONS[id]?.n||id,
      level:selLevel, created_at:new Date().toISOString(),
      session_id:(typeof ANON!=='undefined'?ANON.id():localStorage.getItem('metro_anon_id')),
    });

    // Persist to Supabase
    if(typeof SB!=='undefined'&&SB.isReady){
      SB.submitReport(id,selLevel).then(()=>{
        setTimeout(()=>{ delete reportCache[id]; },1200);
      });
    }

    // Show success card
    const ok=document.getElementById('rep-ok');
    if(ok){ok.style.display='flex';setTimeout(()=>ok.style.display='none',3500);}
    _incKarma();

    // Reset form
    repStation=null;selLevel='';
    const btnVal=document.getElementById('rep-stn');
    if(btnVal){btnVal.textContent='Select your station';btnVal.classList.add('ph');}
    document.querySelectorAll('.cp').forEach(c=>c.classList.remove('sel'));
    const btn=document.getElementById('rep-btn');if(btn)btn.disabled=true;
    const note=document.getElementById('rep-note');if(note)note.value='';
  }

  function triggerUpdate(){
    CROWD.recomputeAll();
    if(panelId)refreshPanel();
    if(activeTab==='s-home'){buildFC();buildHomeLineList();}
    if(activeTab==='s-station'&&panelId)showStationScreen(panelId);
  }

  function openStationFromStats(id){showStationScreen(id);}

  // Helpers
  function _s(id,v){const e=document.getElementById(id);if(e)e.textContent=v}
  function _sc(id,v,c){const e=document.getElementById(id);if(e){e.textContent=v;e.style.color=c}}
  function _st(id,p,v){const e=document.getElementById(id);if(e)e.style[p]=v}

  return{
    init, switchTab, navTo, refreshIfActive, updateHeader, get activeTab(){return activeTab},
    // Station panel (legacy + new screen)
    openPanel, closePanel, refreshPanel, loadStationReports, loadPanelReports, prependReport,
    showStationScreen, openStationFromStats,
    // Search overlay
    openSearch, closeSearch, filterSearch, closeLineSelect,
    // Station screen
    gpsStation, goCoachFromStation,
    // Coach screen
    openCoachLineSelect: openCoachLinePicker, coachSetDir: setCoachDir,
    setCFHour, pickCoachLine,
    // Route
    swapRoute, doRoute,
    // Report
    pickLevel: pickCp, submitReport, quickReport,
    // UI helpers
    showToast, hideToast, triggerUpdate,
    // Overlay internal (called from dynamic HTML)
    _overlayPick,
  };
})();
