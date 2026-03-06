window.UI=(function(){
  let activeTab='map',panelId=null,selLevel='';

  function init(){
    setupSlider();setupFilters();populateReportSelect();
  }

  function switchTab(tab){
    activeTab=tab;
    document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on',t.dataset.t===tab));
    document.querySelectorAll('.vw').forEach(v=>v.classList.remove('on'));
    const el=document.getElementById(tab+'-vw');if(el)el.classList.add('on');
    if(tab==='stats')renderStats();
    if(tab==='lines')renderLines();
    if(tab==='events')renderEvents();
    if(tab==='route')ROUTE.populateSelects();
    if(tab==='report'){populateReportSelect();loadNetworkReports();}
  }

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

    // ── Service hours indicator ───────────────────────────────
    const shEl=document.getElementById('sp-service-hours');
    if(shEl){
      const sh=METRO.stationServiceHours(id);
      const nowH=CROWD.state.hour;
      const isOpen=nowH>=sh.open&&nowH<=sh.close;
      const openLines=s.l.map(l=>METRO.SERVICE_HOURS[l]).filter(Boolean);
      // Earliest first train and latest last train across this station's lines
      const firstTrain=openLines.map(l=>l.firstTrain).sort()[0]||'—';
      const lastTrain =openLines.map(l=>l.lastTrain).sort().reverse()[0]||'—';
      shEl.innerHTML=isOpen
        ?`<span style="color:var(--low)">● Open</span> · First ${firstTrain} · Last ${lastTrain}`
        :`<span style="color:var(--muted)">○ Closed</span> · Opens ${firstTrain} · Last train ${lastTrain}`;
    }
    _sc('sc1',v+'%',c);_sc('sc2',CROWD.label(v),c);_s('sc3',CROWD.waitLabel(v));
    _st('spb','width',v+'%');_st('spb','background',c);

    const ld=document.getElementById('sp-line-dots');
    if(ld)ld.innerHTML=s.l.map(l=>`<span style="width:8px;height:8px;border-radius:50%;background:${METRO.LINE_COLORS[l]};display:inline-block;margin-right:3px"></span><span>${METRO.LINE_NAMES[l]}</span>`).join('<span style="color:var(--muted);margin:0 4px">·</span>');

    // ── Confidence badge ──────────────────────────────────────
    const cbEl=document.getElementById('sp-confidence');
    if(cbEl) cbEl.innerHTML = typeof NOTIFY !== 'undefined' ? NOTIFY.confidenceBadge(id) : '';

    // ── Anomaly banner ────────────────────────────────────────
    const abEl=document.getElementById('sp-anomaly');
    if(abEl) abEl.innerHTML = typeof NOTIFY !== 'undefined' ? NOTIFY.anomalyBanner(id) : '';

    // ── Subscribe button ──────────────────────────────────────
    const sbEl=document.getElementById('sp-sub-btn');
    if(sbEl){
      const isSub = typeof NOTIFY !== 'undefined' && NOTIFY.isSubscribed(id);
      sbEl.dataset.id  = id;
      sbEl.dataset.sub = isSub ? '1' : '0';
      sbEl.textContent = isSub ? '🔔 Subscribed' : '🔕 Subscribe';
      sbEl.style.background  = isSub ? 'rgba(0,230,118,.12)' : '';
      sbEl.style.borderColor = isSub ? 'rgba(0,230,118,.4)'  : '';
      sbEl.style.color       = isSub ? 'var(--low)' : '';
    }

    const sp=document.getElementById('spspk');
    if(sp){const fc=CROWD.stationForecast(id);sp.innerHTML=fc.map((fv,h)=>`<div class="spk" style="height:${Math.round(fv*.26)}px;background:${h===CROWD.state.hour?c:CROWD.color(fv)};opacity:${h===CROWD.state.hour?1:.5};flex:1;min-width:2px;border-radius:1px 1px 0 0"></div>`).join('')}

    document.getElementById('sp')?.classList.add('show');
    if(activeTab==='map')MAP.flyTo(id);

    // Load community reports for this station (async, non-blocking)
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
        MAP.setLineFilter(l);
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
    const listEl  =document.getElementById('rplist');
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
    const id=document.getElementById('rpst').value;if(!id||!selLevel)return;

    // Optimistic local update
    CROWD.state.userReports[id]=selLevel;
    triggerUpdate();

    // Optimistic prepend into panel + report list
    prependReport({
      station_id:id, station_name:METRO.STATIONS[id]?.n||id,
      level:selLevel, created_at:new Date().toISOString(),
      session_id:(typeof ANON!=='undefined'?ANON.id():localStorage.getItem('metro_anon_id')),
    });

    // Persist to Supabase
    if(typeof SB!=='undefined'&&SB.isReady){
      SB.submitReport(id,selLevel).then(()=>{
        // Reload from DB after small delay (debounce vs optimistic)
        setTimeout(()=>{ delete reportCache[id]; loadPanelReports(id); },1200);
      });
    }

    const msg=document.getElementById('sucmsg');
    if(msg){msg.style.display='block';setTimeout(()=>msg.style.display='none',3000)}
    document.getElementById('rpst').value='';
    document.querySelectorAll('.clb').forEach(b=>b.className='clb');selLevel='';
  }

  function triggerUpdate(){
    CROWD.recomputeAll();MAP.updateMarkers();updateHeader();
    if(panelId)refreshPanel();
    if(activeTab==='stats'){renderStats()}
    if(activeTab==='lines')renderLines();
    if(activeTab==='events')renderEvents();
  }

  function openStationFromStats(id){switchTab('map');setTimeout(()=>openPanel(id),80)}

  // Helpers
  function _s(id,v){const e=document.getElementById(id);if(e)e.textContent=v}
  function _sc(id,v,c){const e=document.getElementById(id);if(e){e.textContent=v;e.style.color=c}}
  function _st(id,p,v){const e=document.getElementById(id);if(e)e.style[p]=v}

  return{init,switchTab,refreshIfActive,updateHeader,openPanel,closePanel,refreshPanel,
    renderStats,renderLines,renderEvents,renderTimeline,toggleEvent,pickLevel,submitReport,
    loadStationReports,loadPanelReports,prependReport,
    openStationFromStats,triggerUpdate,get activeTab(){return activeTab}};
})();
