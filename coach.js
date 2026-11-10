// ─────────────────────────────────────────────────────────────────────────────
//  COACH.js  —  Delhi Metro Coach Recommendation Engine v2
//  New in v2:
//    · Destination-aware  — best coach based on exit at YOUR destination
//    · Time-of-day patterns — peak vs off-peak crowd weights
//    · Destination prompt — add where you're going for better advice
//    · Lift/accessibility info per station
//    · Better mobile UI — hero card + ranked list
// ─────────────────────────────────────────────────────────────────────────────
window.COACH = (function () {

  // ── 1. LINE CONFIG ────────────────────────────────────────────────────────
  const LINE_CFG = {
    Y:  { coaches:8, seated:50, standing:330, name:'Yellow',  color:'#FFD700' },
    B:  { coaches:8, seated:50, standing:330, name:'Blue',    color:'#0057A8' },
    R:  { coaches:8, seated:50, standing:330, name:'Red',     color:'#E53935' },
    P:  { coaches:6, seated:50, standing:292, name:'Pink',    color:'#E91E8C' },
    M:  { coaches:6, seated:50, standing:292, name:'Magenta', color:'#9C27B0' },
    V:  { coaches:6, seated:50, standing:292, name:'Violet',  color:'#7B1FA2' },
    G:  { coaches:6, seated:50, standing:292, name:'Green',   color:'#43A047' },
    A:  { coaches:6, seated:50, standing:292, name:'Airport', color:'#FF6D00' },
    Gr: { coaches:4, seated:50, standing:292, name:'Grey',    color:'#90A4AE' },
    Aq: { coaches:4, seated:50, standing:292, name:'Aqua',    color:'#00BCD4' },
  };

  // ── 2. PLATFORM TYPES ─────────────────────────────────────────────────────
  // U = Underground → exits center  |  E = Elevated → exits at ends
  const PLT = {
    GTN:'U',VIV:'U',VDH:'U',CVL:'U',KAG:'U',CCK:'U',CBZ:'U',NWD:'U',
    PCK:'U',RJC:'U',MDH:'U',BRK:'U',CSC:'U',UBW:'U',LKM:'U',
    INP:'U',PMM:'U',JNP:'U',LQL:'U',JME:'U',DLG:'U',ITO:'U',
    HZK:'U',KLK:'U',NEE:'U',GVP:'U',INA:'U',LAJ:'U',DKN:'U',
  };

  // ── 3. EXIT POSITIONS ─────────────────────────────────────────────────────
  const EXIT_OVERRIDE = {
    RJC:[4,5,6], KAG:[3,4,5], NWD:[4,5], HZK:[3,4],
    CSC:[4,5], INA:[2,3], IGI1:[1,2], IGIIA:[5,6],
  };

  function getExitCoaches(sid, n) {
    if (EXIT_OVERRIDE[sid]) return EXIT_OVERRIDE[sid];
    const type = PLT[sid] || 'E';
    if (type === 'U') {
      const mid = Math.round(n / 2);
      return [-1,0,1].map(d => mid+d).filter(c => c>=1 && c<=n);
    }
    return [1,2,n-1,n].filter(c => c>=1 && c<=n);
  }

  // ── 4. TERMINAL STATIONS ──────────────────────────────────────────────────
  const TERMINAL_STATIONS = new Set([
    'SAB','MCC','SST2','NEC','VSH','DW21','MJP','SVH','KLJ',
    'RNS','DHB','YBS','AQ51','AQGNW','HRS','BSS','RJC','KAG',
  ]);

  // ── 5. LIFT COACHES ───────────────────────────────────────────────────────
  const LIFT_COACH = {
    RJC:4,KAG:3,HZK:3,NWD:5,CSC:4,VIV:4,BRK:4,CCK:3,INA:2,
  };

  // ── 6. CROWD INDEX ────────────────────────────────────────────────────────
  function coachCrowdIndex(i, n, h) {
    let base;
    if (i===1)       base = 2.8;
    else if (i===n)  base = 1.9;
    else if (i===2)  base = 4.4;
    else if (i===n-1)base = 2.5;
    else {
      const pos = (i-1)/(n-1), peak = 0.40;
      base = 5.0 - 2.8*Math.exp(-Math.pow((pos-peak)/0.22,2));
    }
    const hour = h !== undefined ? h : new Date().getHours();
    const isPeak = (hour>=8&&hour<=10)||(hour>=17&&hour<=20);
    if (isPeak) {
      if (i===2||i===3) base *= 1.25;
      else if (i>=n-1)  base *= 0.80;
    }
    return Math.round(base*10)/10;
  }

  // ── 7. RECOMMEND ─────────────────────────────────────────────────────────
  function recommend(sid, line, crowdScore, destId, h) {
    const cfg = LINE_CFG[line];
    if (!cfg) return null;
    const n    = cfg.coaches;
    const hour = h !== undefined ? h : new Date().getHours();
    const exitSet  = new Set(getExitCoaches(sid, n));
    const destSet  = destId ? new Set(getExitCoaches(destId, n)) : new Set();
    const destName = destId && METRO.STATIONS[destId] ? METRO.STATIONS[destId].n : '';
    const isTerm   = TERMINAL_STATIONS.has(sid);
    const rushMult = crowdScore>70 ? 1.4 : crowdScore>40 ? 1.1 : 1.0;

    const coaches = [];
    for (let i=1;i<=n;i++) {
      const crowd = coachCrowdIndex(i,n,hour);
      const score = (
        (exitSet.has(i)  ? 2.0 : 0) +
        (destSet.has(i)  ? 2.5 : 0) +
        ((5-crowd)*1.5)             +
        (LIFT_COACH[sid]===i ? 0.5 : 0)
      ) * rushMult;
      coaches.push({
        num:i, crowd, score,
        isLadies: i===1,
        isLadiesLast: isTerm&&i===n,
        exitFriendly: exitSet.has(i),
        destExitFriendly: destSet.has(i),
        hasLift: LIFT_COACH[sid]===i,
      });
    }
    coaches.sort((a,b)=>b.score-a.score);
    return { coaches, cfg, n, isTerm, destName,
      best: coaches[0], top3: coaches.slice(0,3).map(c=>c.num),
      platformType: PLT[sid]||'E',
      isPeak: (hour>=8&&hour<=10)||(hour>=17&&hour<=20),
    };
  }

  // ── 8. HELPERS ────────────────────────────────────────────────────────────
  function crowdLabel(idx) {
    if (idx<=2.0) return {text:'Empty',    col:'#4ade80'};
    if (idx<=2.8) return {text:'Light',    col:'#86efac'};
    if (idx<=3.4) return {text:'Moderate', col:'#fbbf24'};
    if (idx<=4.1) return {text:'Busy',     col:'#f97316'};
    return              {text:'Packed',   col:'#ef4444'};
  }

  function timeTag(h) {
    const dot = (col) => `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${col};margin-right:4px;vertical-align:middle"></span>`;
    if (h>=8&&h<=10)  return dot('#ef4444')+'Morning Peak';
    if (h>=17&&h<=20) return dot('#ef4444')+'Evening Peak';
    if (h>=11&&h<=16) return dot('#4ade80')+'Off-Peak';
    if (h>=21||h<=6)  return dot('#4ade80')+'Late Night';
    return dot('#fbbf24')+'Shoulder';
  }

  function bar(idx, col) {
    const pct = Math.round(((idx-1)/4)*100);
    return `<div style="height:3px;background:var(--brd);border-radius:2px;overflow:hidden;margin-top:3px">
      <div style="height:100%;width:${pct}%;background:${col};border-radius:2px"></div></div>`;
  }

  // ── 9. RENDER ─────────────────────────────────────────────────────────────
  function renderCoachStrip(sid, lineCode, crowdScore, destId, h) {
    const s = METRO.STATIONS[sid];
    if (!s) return '';
    const line = lineCode && LINE_CFG[lineCode] ? lineCode : s.l[0];
    const res  = recommend(sid, line, crowdScore||0, destId, h);
    if (!res) return '';

    const {coaches,cfg,n,isTerm,destName,best,top3,platformType,isPeak} = res;
    const byNum = [...coaches].sort((a,b)=>a.num-b.num);
    const effectiveH = h !== undefined ? h : new Date().getHours();
    const lc    = crowdLabel(best.crowd);

    // HERO CARD
    const hero = `
      <div style="background:linear-gradient(135deg,rgba(245,168,0,.12),rgba(245,168,0,.04));
        border:1.5px solid rgba(245,168,0,.35);border-radius:16px;padding:16px;margin-bottom:12px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px">
          <div>
            <div style="font-size:9px;color:var(--sub);letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px">${T("coach_board_here")}</div>
            <div style="font-size:44px;font-weight:900;font-family:'DM Serif Display',sans-serif;color:var(--y);line-height:1">Coach ${best.num}</div>
            ${coaches[1]?`<div style="font-size:11px;color:var(--sub);margin-top:3px">or Coach ${coaches[1].num} as backup</div>`:''}
          </div>
          <div style="text-align:right">
            <div style="color:var(--y)"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="11" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/><line x1="7" y1="12" x2="17" y2="12"/><path d="M7 18l-2 3M17 18l2 3"/></svg></div>
            <div style="font-size:10px;font-weight:700;color:${lc.col};margin-top:2px">${lc.text}</div>
            <div style="font-size:9px;color:var(--sub)">${n}-coach</div>
          </div>
        </div>
        <div style="display:flex;gap:5px;flex-wrap:wrap">
          ${best.exitFriendly?`<span style="font-size:9px;padding:3px 8px;border-radius:20px;background:rgba(245,168,0,.12);color:var(--y);border:1px solid rgba(245,168,0,.25);display:inline-flex;align-items:center;gap:3px"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>Near exit</span>`:''}
          ${best.destExitFriendly&&destName?`<span style="font-size:9px;padding:3px 8px;border-radius:20px;background:rgba(74,222,128,.1);color:#4ade80;border:1px solid rgba(74,222,128,.25);display:inline-flex;align-items:center;gap:3px"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>Near ${destName} exit</span>`:''}
          ${best.hasLift?`<span style="font-size:9px;padding:3px 8px;border-radius:20px;background:rgba(129,140,248,.12);color:#818cf8;border:1px solid rgba(129,140,248,.25);display:inline-flex;align-items:center;gap:3px"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2"/><path d="M6 9h12l-2 9H8L6 9z"/></svg>Lift</span>`:''}
          <span style="font-size:9px;padding:3px 8px;border-radius:20px;background:rgba(255,255,255,.05);color:var(--sub);border:1px solid var(--brd)">${timeTag(effectiveH)}</span>
          <span style="font-size:9px;padding:3px 8px;border-radius:20px;background:rgba(255,255,255,.05);color:var(--sub);border:1px solid var(--brd)">${platformType==='U'?'↓ Underground':'↑ Elevated'}</span>
        </div>
      </div>`;

    // DESTINATION PROMPT
    const destPrompt = !destId ? `
      <div onclick="COACH_UI.openDestPicker()"
        style="background:var(--card2);border:1px dashed var(--brd);border-radius:12px;
          padding:10px 14px;margin-bottom:12px;cursor:pointer;display:flex;align-items:center;gap:10px">
        <div style="color:var(--sub)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg></div>
        <div style="flex:1">
          <div style="font-size:11px;font-weight:700;color:var(--txt)">${T("coach_add_dest")}</div>
          <div style="font-size:10px;color:var(--sub);margin-top:1px">${T('coach_dest_sub')}</div>
        </div>
        <div style="color:var(--sub);font-size:16px">›</div>
      </div>` : `
      <div style="background:rgba(74,222,128,.06);border:1px solid rgba(74,222,128,.2);
        border-radius:12px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:10px">
        <div style="color:#4ade80"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg></div>
        <div style="flex:1">
          <div style="font-size:9px;color:var(--sub)">Destination</div>
          <div style="font-size:12px;font-weight:700;color:#4ade80">${destName}</div>
        </div>
        <div onclick="COACH_UI.clearDest()" style="font-size:9px;color:var(--sub);cursor:pointer;
          padding:3px 8px;border:1px solid var(--brd);border-radius:8px">Clear</div>
      </div>`;

    // VISUAL STRIP
    const pills = byNum.map(c => {
      const isL = c.isLadies||c.isLadiesLast;
      const cl2 = crowdLabel(c.crowd);
      let bg, bdr, nc;
      if (isL)              { bg='rgba(236,72,153,.1)'; bdr='1.5px solid rgba(236,72,153,.4)'; nc='#f9a8d4'; }
      else if(c.num===best.num){ bg='rgba(245,168,0,.18)'; bdr='2px solid rgba(245,168,0,.7)'; nc='var(--y)'; }
      else if(top3.includes(c.num)){ bg='rgba(74,222,128,.07)'; bdr='1px solid rgba(74,222,128,.3)'; nc='#4ade80'; }
      else { bg='var(--card2)'; bdr='1px solid var(--brd)'; nc='var(--sub)'; }
      return `<div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;
          width:${n===8?'38px':'44px'};padding:8px 3px 6px;border-radius:10px;
          background:${bg};border:${bdr};position:relative;transition:transform .15s"
        onmouseover="this.style.transform='scale(1.07)'" onmouseout="this.style.transform=''">
        ${c.num===best.num?`<div style="position:absolute;top:-8px;left:50%;transform:translateX(-50%);
          font-size:6px;background:var(--y);color:#000;padding:1px 5px;border-radius:4px;
          font-weight:800;white-space:nowrap">BEST</div>`:''}
        <div style="font-size:13px;font-weight:900;font-family:'DM Serif Display',sans-serif;color:${nc};line-height:1">${c.num}</div>
        ${isL?`<div style="color:#f9a8d4;margin-top:3px"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"/><path d="M12 13v8M9 18h6"/></svg></div>`:
          `<div style="height:3px;width:80%;border-radius:2px;background:${cl2.col};opacity:.7;margin-top:4px"></div>`}
        ${c.exitFriendly&&!isL?`<div style="font-size:6px;color:var(--y);margin-top:2px">exit</div>`:''}
        ${c.destExitFriendly&&destId&&!isL?`<div style="font-size:6px;color:#4ade80;margin-top:1px">dest</div>`:''}
        ${c.hasLift&&!isL?`<div style="color:#818cf8;margin-top:1px"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2"/><path d="M6 9h12l-2 9H8L6 9z"/></svg></div>`:''}
      </div>`;
    }).join('');

    const strip = `
      <div style="margin-bottom:14px">
        <div style="font-size:9px;color:var(--sub);letter-spacing:.08em;text-transform:uppercase;
          font-family:'DM Serif Display',sans-serif;margin-bottom:8px;display:flex;align-items:center;gap:8px">
          <span>${T("coach_front")}</span><span style="flex:1;height:1px;background:var(--brd)"></span><span>${T("coach_rear")}</span>
        </div>
        <div style="display:flex;gap:4px;overflow-x:auto;padding-bottom:6px;scrollbar-width:none">
          ${pills}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
          <div style="font-size:9px;color:var(--sub);display:flex;align-items:center;gap:3px"><div style="width:10px;height:3px;background:var(--y);border-radius:2px"></div>${T("coach_best")}</div>
          <div style="font-size:9px;color:var(--sub);display:flex;align-items:center;gap:3px"><div style="width:10px;height:3px;background:#4ade80;border-radius:2px"></div>${T("coach_good")}</div>
          <div style="font-size:9px;color:#f9a8d4;display:flex;align-items:center;gap:3px"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"/><path d="M12 13v8M9 18h6"/></svg>${T("coach_ladies")}</div>
        </div>
      </div>`;

    // RANKED LIST (non-ladies, top 5)
    const ranked = coaches.filter(c=>!c.isLadies&&!c.isLadiesLast).slice(0,5).map((c,i)=>{
      const cl2 = crowdLabel(c.crowd);
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;
          background:${i===0?'rgba(245,168,0,.07)':'var(--card2)'};
          border:1px solid ${i===0?'rgba(245,168,0,.25)':'var(--brd)'};margin-bottom:6px">
        <div style="font-size:20px;font-weight:900;font-family:'DM Serif Display',sans-serif;
          color:${i===0?'var(--y)':'var(--sub)'};width:26px;text-align:center">${c.num}</div>
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:5px;margin-bottom:2px">
            <span style="font-size:11px;font-weight:700;color:${cl2.col}">${cl2.text}</span>
            ${c.exitFriendly?`<span style="font-size:9px;color:var(--y);background:rgba(245,168,0,.1);padding:1px 6px;border-radius:8px">near exit</span>`:''}
            ${c.destExitFriendly&&destId?`<span style="font-size:9px;color:#4ade80;background:rgba(74,222,128,.08);padding:1px 6px;border-radius:8px;display:inline-flex;align-items:center;gap:2px"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="2"/></svg>dest exit</span>`:''}
            ${c.hasLift?`<span style="font-size:9px;color:#818cf8;background:rgba(129,140,248,.08);padding:1px 6px;border-radius:8px;display:inline-flex;align-items:center"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2"/><path d="M6 9h12l-2 9H8L6 9z"/></svg></span>`:''}
          </div>
          ${bar(c.crowd,cl2.col)}
        </div>
        ${i===0?`<div style="color:var(--y)"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>`:''}
      </div>`;
    }).join('');

    // LINE SELECTOR
    const lineSel = s.l.length>1?`
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
        ${s.l.map(l=>{
          const lc2=LINE_CFG[l]; if(!lc2) return '';
          const active=l===line;
          return `<button onclick="COACH.switchLine('${sid}','${l}')" style="font-size:10px;font-weight:700;
            padding:5px 12px;border-radius:20px;cursor:pointer;
            background:${active?lc2.color+'22':'var(--card2)'};
            border:1.5px solid ${active?lc2.color+'66':'var(--brd)'};
            color:${active?lc2.color:'var(--sub)'};">${lc2.name}</button>`;
        }).join('')}
      </div>`:'' ;

    // LADIES NOTE
    const ladiesNote = `
      <div style="background:rgba(236,72,153,.06);border:1px solid rgba(236,72,153,.2);
        border-radius:10px;padding:10px 12px;margin-top:8px;display:flex;align-items:center;gap:10px">
        <div style="color:#f9a8d4"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"/><path d="M12 13v8M9 18h6"/></svg></div>
        <div style="font-size:10px;color:var(--sub);line-height:1.5">
          <b style="color:#f9a8d4">Coach 1</b> always reserved for women.
          ${isTerm?`<b style="color:#f9a8d4">Coach ${n}</b> also reserved at this terminal.`:''}
        </div>
      </div>`;

    return `<div id="coach-section" data-station="${sid}" data-line="${line}" data-dest="${destId||''}">
      ${lineSel}${hero}${destPrompt}${strip}
      <div style="font-size:11px;font-weight:700;color:var(--txt);margin:12px 0 8px">${T("coach_all_coaches")}</div>
      ${ranked}${ladiesNote}
    </div>`;
  }

  // ── 10. COACH_UI — screen controller ─────────────────────────────────────
  const COACH_UI = (function(){
    let _sid=null, _line=null, _dest=null, _timeH=null; // null = now

    // DMRC service hours: ~05:30–23:30
    function _isOpen(h) { return h >= 6 && h <= 23; }

    function _effectiveHour() {
      return _timeH !== null ? _timeH : new Date().getHours();
    }

    function _refresh(){
      const el=document.getElementById('coach-content');
      if(!el||!_sid||!_line) return;
      const h = _effectiveHour();

      if(!_isOpen(h)){
        // Show closed state instead of coach data
        const openAt = h < 6 ? '6:00 AM' : '—';
        el.innerHTML=`<div style="background:var(--card);border:1px solid var(--brd);border-radius:16px;
          padding:28px 20px;text-align:center;margin-top:8px">
          <div style="font-size:32px;margin-bottom:12px">🚇</div>
          <div style="font-family:'DM Serif Display',sans-serif;font-size:16px;font-weight:800;color:var(--txt);margin-bottom:6px">
            ${T("coach_metro_closed")}
          </div>
          <div style="font-size:12px;color:var(--sub);line-height:1.6">
            DMRC service runs approximately<br>
            <strong style="color:var(--txt)">6:00 AM – 11:30 PM</strong><br>
            ${h < 6 ? `First service from <strong style="color:var(--y)">${openAt}</strong>` : 'Last service has departed'}
          </div>
        </div>`;
        return;
      }

      const crowd=window.CROWD?.state?.crowdMap?.[_sid]||0;
      // Scale crowd by time-of-day factor relative to now
      const nowH = new Date().getHours();
      const crowdForTime = _timeH !== null ? _scaleCrowdForHour(crowd, nowH, h) : crowd;
      el.innerHTML=renderCoachStrip(_sid,_line,crowdForTime,_dest,h);
    }

    // Scale crowd estimate for a different hour using the crowd curve
    function _scaleCrowdForHour(nowCrowd, nowH, targetH) {
      // Simple pattern: peak hours 8-10 and 17-20 → high, midnight-5 → 0, other → medium
      function _factor(h) {
        if(h<6||h>23) return 0;
        if((h>=8&&h<=10)||(h>=17&&h<=20)) return 1.0;
        if((h>=7&&h<8)||(h>10&&h<=11)||(h>=16&&h<17)||(h>20&&h<=21)) return 0.72;
        if(h>=11&&h<=16) return 0.52;
        return 0.28; // early morning / late night
      }
      const nf = _factor(nowH) || 0.01;
      const tf = _factor(targetH);
      return Math.min(100, Math.round(nowCrowd * tf / nf));
    }

    function buildTimeChips(){
      const tc = document.getElementById('c-time-chips');
      if(!tc) return;
      const now = new Date().getHours();
      const slots = [
        {l:'Now',  h:null},
        {l:'+1h',  h:(now+1)%24},
        {l:'+2h',  h:(now+2)%24},
        {l:'8 AM', h:8},
        {l:'1 PM', h:13},
        {l:'6 PM', h:18},
      ];
      tc.innerHTML = slots.map((s,i)=>`
        <div class="chip${i===0?' on':''}"
          onclick="COACH_UI.setTimeH(${s.h===null?'null':s.h},this)"
          style="${!_isOpen(s.h!==null?s.h:now)?'opacity:.4':''}"
        >${s.l}${s.h!==null&&!_isOpen(s.h)?'<span style="font-size:8px;margin-left:3px;opacity:.6">✕</span>':''}</div>
      `).join('');
    }

    function setTimeH(h, el){
      _timeH = h; // null = now
      document.querySelectorAll('#c-time-chips .chip').forEach(c=>c.classList.remove('on'));
      if(el) el.classList.add('on');
      _refresh();
    }

    function setStation(id){
      _sid=id; _dest=null;
      const s=id&&METRO.STATIONS[id]; if(!s) return;
      document.getElementById('c-stn-val').textContent=s.n;
      document.getElementById('c-stn-val').classList.remove('ph');
      if(s.l.length===1){
        _line=s.l[0];
        const lc=LINE_CFG[_line];
        document.getElementById('c-line-val').textContent=lc?lc.name+' Line':_line;
        document.getElementById('c-line-val').classList.remove('ph');
        document.getElementById('c-line-row').style.cssText='opacity:1;pointer-events:auto';
        _refresh();
      } else {
        document.getElementById('c-line-row').style.cssText='opacity:1;pointer-events:auto';
      }
    }

    function openLinePicker(){
      if(!_sid) return;
      const s=METRO.STATIONS[_sid]; if(!s) return;
      const existing=document.getElementById('_lp'); if(existing){existing.remove();return;}
      const div=document.createElement('div');
      div.id='_lp';
      div.style.cssText='display:flex;gap:8px;flex-wrap:wrap;padding:8px 16px;';
      s.l.forEach(l=>{
        const lc=LINE_CFG[l]; if(!lc) return;
        const btn=document.createElement('button');
        btn.textContent=lc.name+' Line';
        btn.style.cssText=`font-size:11px;font-weight:700;padding:6px 14px;border-radius:20px;cursor:pointer;
          background:${lc.color}22;border:1.5px solid ${lc.color}66;color:${lc.color};`;
        btn.onclick=()=>{pickLine(l);div.remove();};
        div.appendChild(btn);
      });
      document.getElementById('c-line-row').after(div);
    }

    function pickLine(l){
      _line=l;
      const lc=LINE_CFG[l];
      document.getElementById('c-line-val').textContent=lc?lc.name+' Line':l;
      document.getElementById('c-line-val').classList.remove('ph');
      _refresh();
    }

    function openDestPicker(){
      if(typeof SEARCH!=='undefined') SEARCH.open('coach-dest');
    }

    function setDest(id){ _dest=id; _refresh(); }
    function clearDest(){ _dest=null; _refresh(); }

    return {setStation,openLinePicker,pickLine,openDestPicker,setDest,clearDest,setTimeH,buildTimeChips};
  })();

  window.COACH_UI=COACH_UI;

  function switchLine(sid,l){ COACH_UI.pickLine(l); }

  return { LINE_CFG, recommend, renderCoachStrip, switchLine, platformType:id=>PLT[id]||'E' };
})();
