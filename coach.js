// ────────────────────────────────────────────────────────────────────────────
//  COACH.js  –  Delhi Metro Coach Recommendation Engine
//  Data sources: Wikipedia DMRC, Metro Rail Today, DMRC press releases
//  Coach counts verified as of 2024 (post all 8-coach conversions on R/Y/B)
// ────────────────────────────────────────────────────────────────────────────
window.COACH = (function () {

  // ── 1. LINE CONFIGURATION ────────────────────────────────────────────────
  // Source: DMRC fleet data; Red/Yellow/Blue fully converted to 8-coach by 2024
  // Standard gauge lines (Phase II/III) physically limited to 6 coaches
  // Grey (Gr) and Aqua (Aq) are short lines with 4-coach trains
  const LINE_CFG = {
    Y:  { coaches:8, seated:50, standing:330, gauge:'broad',    name:'Yellow'  },
    B:  { coaches:8, seated:50, standing:330, gauge:'broad',    name:'Blue'    },
    R:  { coaches:8, seated:50, standing:330, gauge:'broad',    name:'Red'     },
    P:  { coaches:6, seated:50, standing:292, gauge:'standard', name:'Pink'    },
    M:  { coaches:6, seated:50, standing:292, gauge:'standard', name:'Magenta' },
    V:  { coaches:6, seated:50, standing:292, gauge:'standard', name:'Violet'  },
    G:  { coaches:6, seated:50, standing:292, gauge:'standard', name:'Green'   },
    A:  { coaches:6, seated:50, standing:292, gauge:'standard', name:'Airport' },
    Gr: { coaches:4, seated:50, standing:292, gauge:'standard', name:'Grey'    },
    Aq: { coaches:4, seated:50, standing:292, gauge:'standard', name:'Aqua'    },
  };

  // ── 2. PLATFORM TYPES ────────────────────────────────────────────────────
  // U = Underground  →  concourse stairs near CENTER of platform
  //                     Best coaches: middle (4-5 on 8C, 3-4 on 6C)
  // E = Elevated/At-grade → stairs at ENDS of platform
  //                     Best coaches: front or rear (1-2 or last 2)
  //
  // Source: DMRC station construction records + Wikipedia per-station articles
  // Yellow underground section: Vishwavidyalaya → Central Secretariat (confirmed)
  // Blue underground: Barakhamba/Mandi House area + Indraprastha/Pragati Maidan
  // Violet underground: Kashmere Gate → ITO section
  // Magenta underground: Hauz Khas (deepest at 29m), Kalkaji area
  // Pink underground: INA, Lajpat Nagar sections
  const PLT = {
    // ── YELLOW LINE underground (central section) ──
    GTN:'U',  // Guru Teg Bahadur Nagar
    VIV:'U',  // Vishwavidyalaya
    VDH:'U',  // Vidhan Sabha
    CVL:'U',  // Civil Lines
    KAG:'U',  // Kashmere Gate (Yellow + Violet platforms underground)
    CCK:'U',  // Chandni Chowk
    CBZ:'U',  // Chawri Bazar (2nd deepest, 25m)
    NWD:'U',  // New Delhi
    PCK:'U',  // Patel Chowk
    RJC:'U',  // Rajiv Chowk
    MDH:'U',  // Mandi House
    BRK:'U',  // Barakhamba Road
    CSC:'U',  // Central Secretariat
    UBW:'U',  // Udyog Bhawan
    LKM:'U',  // Lok Kalyan Marg

    // ── BLUE LINE underground section ──
    INP:'U',  // Indraprastha
    PMM:'U',  // Pragati Maidan
    JNP:'U',  // Janpath (Blue spur)

    // ── VIOLET LINE underground ──
    LQL:'U',  // Lal Quila
    JME:'U',  // Jama Masjid
    DLG:'U',  // Delhi Gate
    ITO:'U',  // ITO

    // ── MAGENTA LINE underground ──
    HZK:'U',  // Hauz Khas (deepest - 29m underground, confirmed)
    KLK:'U',  // Kalkaji Mandir
    NEE:'U',  // Nehru Enclave
    GVP:'U',  // Govind Puri

    // ── PINK LINE underground sections ──
    INA:'U',  // Dilli Haat INA
    LAJ:'U',  // Lajpat Nagar
    DKN:'U',  // Dhaula Kuan
    // All others default to 'E' (elevated / at-grade)
  };

  // ── 3. COACH CROWD WEIGHTS ───────────────────────────────────────────────
  // Observed Delhi Metro boarding patterns (field data + Reddit/Quora crowd reports)
  // Coach 1: Ladies only → moderate crowd (dedicated section)
  // Coaches 2-3: HIGHEST crowd (adjacent to ladies coach, most general passengers
  //              gravitate here because coach 1 is off-limits for men)
  // Coaches 4-5 (8C) / 3-4 (6C): HIGH crowd – platform center, most accessible
  // Coach 6-7: MEDIUM crowd
  // Last coach: LOWEST crowd (furthest from most station exits + sometimes
  //             becomes ladies at terminal stations, discouraging boarding)
  function coachCrowdIndex(coachNum, total) {
    // Returns 1 (least crowded) → 5 (most crowded)
    if (coachNum === 1) return 2.8;          // ladies: controlled crowd
    if (coachNum === total) return 1.9;      // last coach: least crowded
    if (coachNum === 2) return 4.4;          // adjacent to ladies: very crowded
    if (coachNum === total - 1) return 2.5;  // second-to-last: light
    // Middle coaches follow bell curve peaked at ~40% position
    const pos = (coachNum - 1) / (total - 1); // 0=front, 1=rear
    const peak = 0.40;
    const raw = 5.0 - 2.8 * Math.exp(-Math.pow((pos - peak) / 0.22, 2));
    return Math.round(raw * 10) / 10;
  }

  // ── 4. EXIT POSITION SCORING ─────────────────────────────────────────────
  // Which coaches are closest to station exit stairs/escalators
  // Underground: stairs in middle → middle coaches score best
  // Elevated: stairs at both ends → front and rear coaches score best
  function exitCoaches(stationId, total) {
    const type = PLT[stationId] || 'E';
    if (type === 'U') {
      // Underground: exits near center of platform
      const mid = Math.round(total / 2);
      const range = total >= 6 ? 2 : 1;
      const result = [];
      for (let d = -range; d <= range; d++) {
        const c = mid + d;
        if (c >= 1 && c <= total) result.push(c);
      }
      return result;
    } else {
      // Elevated: exits at both ends
      const front = [1, 2].filter(c => c <= total);
      const rear = [total - 1, total].filter(c => c >= 1);
      return [...new Set([...front, ...rear])];
    }
  }

  // ── 5. WOMEN'S RESERVED COACHES ─────────────────────────────────────────
  // Coach 1 is ALWAYS reserved for women on all Delhi Metro lines (DMRC rule)
  // At terminal stations (train reversal), the LAST coach is ALSO reserved
  // Source: DMRC official rules + Wikipedia "first coach reserved for women"
  const TERMINAL_STATIONS = new Set([
    'SAB','MCC','SST2','NEC','VSH','DW21','MJP','SVH','KLJ','RNS',
    'DHB','YBS','AQ51','AQGNW','HRS','BSS','RJC','KAG'
  ]);

  // ── 6. MAIN RECOMMENDATION ENGINE ───────────────────────────────────────
  // Returns ranked coach list with scores for a given station + line
  // crowdScore: 0-100 current station crowd level (from CROWD module)
  function recommend(stationId, lineCode, crowdScore) {
    const cfg = LINE_CFG[lineCode];
    if (!cfg) return null;
    const n = cfg.coaches;
    const exitSet = new Set(exitCoaches(stationId, n));
    const isTerminal = TERMINAL_STATIONS.has(stationId);
    const coaches = [];

    for (let i = 1; i <= n; i++) {
      const isLadies = (i === 1);
      const isLadiesLast = isTerminal && (i === n);
      const crowd = coachCrowdIndex(i, n);

      // Score (higher = better recommendation)
      // Exit bonus: +2 if near exit stairs
      // Crowd bonus: (5 - crowd) * 1.5  →  less crowded = higher score
      // Deduct for ladies if crowd is low (ladies coach may have spare seats)
      const exitBonus = exitSet.has(i) ? 2.0 : 0;
      const crowdBonus = (5 - crowd) * 1.5;
      // Factor in real-time crowd: busier station = bigger advantage to less crowded coaches
      const rushMultiplier = crowdScore > 70 ? 1.4 : crowdScore > 40 ? 1.1 : 1.0;
      const score = (exitBonus + crowdBonus) * rushMultiplier;

      coaches.push({
        num: i,
        isLadies,
        isLadiesLast,
        crowd,          // 1=empty → 5=packed
        exitFriendly: exitSet.has(i),
        score,
        seated: cfg.seated,
        standing: cfg.standing,
      });
    }

    coaches.sort((a, b) => b.score - a.score);
    return {
      coaches,
      cfg,
      platformType: PLT[stationId] || 'E',
      isTerminal,
      topCoaches: coaches.slice(0, 2).map(c => c.num),
      leastCrowded: coaches[0].num,
    };
  }

  // ── 7. RENDER FUNCTIONS ──────────────────────────────────────────────────

  // Crowd index → label + color
  function crowdLabel(idx) {
    if (idx <= 2.0) return { text: 'Empty',   color: 'var(--low)' };
    if (idx <= 2.8) return { text: 'Light',   color: '#69F0AE' };
    if (idx <= 3.4) return { text: 'Moderate',color: 'var(--med)' };
    if (idx <= 4.1) return { text: 'Busy',    color: 'var(--hi)' };
    return               { text: 'Packed',  color: 'var(--pk)' };
  }

  // Crowd index → dot fill string
  function crowdDots(idx) {
    const filled = Math.round(idx);
    return '●'.repeat(filled) + '○'.repeat(5 - filled);
  }

  // Render the full coach strip HTML (injected into station panel)
  function renderCoachStrip(stationId, lineCode, crowdScore) {
    const s = METRO.STATIONS[stationId];
    if (!s) return '';

    // Pick the most relevant line for this station
    // Priority: passed lineCode > first line of station
    const line = lineCode && LINE_CFG[lineCode] ? lineCode : s.l[0];
    const result = recommend(stationId, line, crowdScore || 0);
    if (!result) return '';

    const { coaches, cfg, platformType, isTerminal, topCoaches } = result;
    const n = cfg.coaches;
    const byNum = [...coaches].sort((a, b) => a.num - b.num);
    const capacity = n * (cfg.seated + cfg.standing);

    // Build coach pills
    const pills = byNum.map(c => {
      const isTop = topCoaches.includes(c.num);
      const cl = crowdLabel(c.crowd);

      let bg, border, numColor, label;
      if (c.isLadies || c.isLadiesLast) {
        bg = 'rgba(233,30,99,0.14)';
        border = '1.5px solid rgba(233,30,99,0.45)';
        numColor = '#F48FB1';
        label = '♀';
      } else if (isTop) {
        bg = 'rgba(0,230,118,0.12)';
        border = '1.5px solid rgba(0,230,118,0.45)';
        numColor = 'var(--low)';
        label = '★';
      } else {
        bg = 'var(--bg3)';
        border = '1px solid var(--border)';
        numColor = 'var(--text)';
        label = '';
      }

      const dotColor = (c.isLadies || c.isLadiesLast) ? '#F48FB1' : cl.color;

      return `<div class="coach-pill" style="
          display:flex;flex-direction:column;align-items:center;
          width:${n === 8 ? '34px' : '38px'};min-height:52px;
          padding:5px 3px 4px;border-radius:8px;
          background:${bg};border:${border};
          position:relative;cursor:default;
          transition:transform .15s,box-shadow .15s;
        " title="${(c.isLadies || c.isLadiesLast) ? 'Ladies reserved' : 'Coach ' + c.num + ' · ' + cl.text + (c.exitFriendly ? ' · Near exit' : '')}"
        onmouseover="this.style.transform='scale(1.06)';this.style.boxShadow='0 4px 14px rgba(0,0,0,.4)'"
        onmouseout="this.style.transform='';this.style.boxShadow=''">
        ${c.exitFriendly && !c.isLadies && !c.isLadiesLast ? `<div style="position:absolute;top:-8px;left:50%;transform:translateX(-50%);font-size:8px;white-space:nowrap;background:var(--bg2);color:var(--accent);border:1px solid rgba(255,107,0,.3);border-radius:4px;padding:0 3px">exit</div>` : ''}
        <span style="font-size:11px;font-weight:700;font-family:'Space Mono',monospace;color:${numColor};line-height:1">${c.num}</span>
        <span style="font-size:9px;color:${dotColor};line-height:1;margin-top:2px">${(c.isLadies || c.isLadiesLast) ? '♀' : label}</span>
        <span style="font-size:6px;color:${dotColor};letter-spacing:-1px;margin-top:3px">${(c.isLadies || c.isLadiesLast) ? '●●●○○' : crowdDots(c.crowd)}</span>
      </div>`;
    }).join('');

    // Direction indicator (coach 1 = front of train)
    const dirHtml = `
      <div style="display:flex;align-items:center;gap:2px;margin-bottom:3px">
        <div style="font-size:7px;color:var(--muted);font-family:'Space Mono',monospace;letter-spacing:.05em">← FRONT (Coach 1)</div>
        <div style="flex:1;height:1px;background:var(--border);margin:0 4px"></div>
        <div style="font-size:7px;color:var(--muted);font-family:'Space Mono',monospace;letter-spacing:.05em">REAR →</div>
      </div>`;

    // Best coach summary
    const best1 = result.coaches[0];
    const best2 = result.coaches[1];
    const ptype = platformType === 'U' ? '🔽 Underground · exits at center' : '🔼 Elevated · exits at ends';

    const summaryHtml = `
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:9px;padding:8px 10px;margin-top:6px;font-family:'Space Mono',monospace">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px">
          <div>
            <div style="font-size:9px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px">BEST BOARD</div>
            <div style="font-size:13px;font-weight:700;color:var(--low)">
              Coach ${best1.num}${best2 && best2.num !== best1.num ? ` <span style="color:var(--muted);font-size:10px">or ${best2.num}</span>` : ''}
            </div>
            <div style="font-size:8px;color:var(--muted);margin-top:2px">${crowdLabel(best1.crowd).text} crowd${best1.exitFriendly ? ' · Near exit stairs' : ''}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:9px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px">TRAIN</div>
            <div style="font-size:11px;font-weight:700;color:var(--text)">${n}-coach</div>
            <div style="font-size:8px;color:var(--muted);margin-top:2px">${capacity.toLocaleString()} cap</div>
          </div>
        </div>
        <div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border);font-size:8px;color:var(--muted)">${ptype}</div>
        ${isTerminal ? `<div style="margin-top:4px;font-size:8px;color:#F48FB1">♀ Coaches 1 &amp; ${n} reserved for ladies at this terminal</div>` : `<div style="margin-top:4px;font-size:8px;color:#F48FB1">♀ Coach 1 always reserved for ladies</div>`}
      </div>`;

    // Multi-line station → show line selector
    const lineSelector = s.l.length > 1 ? `
      <div style="display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap">
        ${s.l.map(l => {
          const lc = LINE_CFG[l];
          if (!lc) return '';
          const active = l === line;
          const col = METRO.LINE_COLORS[l] || '#fff';
          return `<button onclick="COACH.switchLine('${stationId}','${l}')" style="
              font-size:8px;font-family:'Space Mono',monospace;font-weight:700;
              padding:2px 8px;border-radius:12px;cursor:pointer;
              background:${active ? col+'22' : 'var(--bg3)'};
              border:1px solid ${active ? col+'66' : 'var(--border)'};
              color:${active ? col : 'var(--muted)'};
              letter-spacing:.05em;
            ">${lc.name} (${lc.coaches}C)</button>`;
        }).join('')}
      </div>` : '';

    return `
      <div id="coach-section" data-station="${stationId}" data-line="${line}">
        <div style="font-size:9px;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;
          margin:10px 0 6px;font-family:'Space Mono',monospace;display:flex;align-items:center;gap:6px">
          <span style="flex:1;height:1px;background:var(--border)"></span>
          COACH GUIDE
          <span style="flex:1;height:1px;background:var(--border)"></span>
        </div>
        ${lineSelector}
        ${dirHtml}
        <div style="display:flex;gap:3px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none">
          ${pills}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:5px;font-family:'Space Mono',monospace">
          <div style="display:flex;align-items:center;gap:3px;font-size:8px;color:var(--muted)"><span style="color:var(--low)">★</span> Recommended</div>
          <div style="display:flex;align-items:center;gap:3px;font-size:8px;color:var(--muted)"><span style="color:rgba(255,107,0,.8)">exit</span> Near stairs</div>
          <div style="display:flex;align-items:center;gap:3px;font-size:8px;color:var(--muted)"><span style="color:#F48FB1">♀</span> Ladies only</div>
        </div>
        ${summaryHtml}
      </div>`;
  }

  // Switch line for multi-line stations (called from button onclick)
  function switchLine(stationId, lineCode) {
    const s = METRO.STATIONS[stationId];
    if (!s) return;
    const crowd = window.CROWD?.state?.crowdMap?.[stationId] || 0;
    const el = document.getElementById('coach-section');
    if (el) {
      el.outerHTML = renderCoachStrip(stationId, lineCode, crowd);
    }
  }

  return {
    LINE_CFG,
    recommend,
    renderCoachStrip,
    switchLine,
    platformType: id => PLT[id] || 'E',
  };
})();
