window.UI = (function () {
  let activeTab = 'map', panelId = null, selLevel = '';

  function init() {
    setupSlider(); setupFilters(); populateReportSelect();
  }

  function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.t === tab));
    document.querySelectorAll('.vw').forEach(v => v.classList.remove('on'));
    const el = document.getElementById(tab + '-vw'); if (el) el.classList.add('on');
    if (tab === 'stats') renderStats();
    if (tab === 'lines') renderLines();
    if (tab === 'events') renderEvents();
    if (tab === 'route') ROUTE.populateSelects();
    if (tab === 'report') populateReportSelect();
  }

  function refreshIfActive(tab) { if (activeTab === tab) switchTab(tab) }

  function updateHeader() {
    const ns = CROWD.networkStats();
    const a = document.getElementById('navg'); if (a) { a.textContent = ns.avg + '%'; a.style.color = CROWD.color(ns.avg) }
    ['sn0', 'sn1', 'sn2', 'sn3', 'sn4'].forEach((id, i) => { const e = document.getElementById(id); if (e) e.textContent = [ns.low, ns.med, ns.hi, ns.pk, ns.total][i] });
    const rc = Object.keys(CROWD.state.userReports).length;
    const rt = document.getElementById('rtxt'); if (rt) rt.textContent = rc + ' Report' + (rc !== 1 ? 's' : '');
    const ae = CROWD.state.newsEvents.filter(e => e.active).length;
    const et = document.getElementById('etxt'); const ed = document.getElementById('edot');
    if (et && ae > 0) { et.textContent = ae + ' Events Active'; if (ed) ed.style.background = '#FF6B00' }
  }

  function openPanel(id) {
    if (!id) { closePanel(); return }
    const s = METRO.STATIONS[id]; if (!s) return;
    panelId = id;
    const v = CROWD.state.crowdMap[id] || 0, c = CROWD.color(v);
    _s('spn', s.n); _s('spl', s.l.map(l => METRO.LINE_NAMES[l]).join(' · ') + (s.ix ? ' · Interchange' : ''));
    _sc('sc1', v + '%', c); _sc('sc2', CROWD.label(v), c); _s('sc3', CROWD.waitLabel(v));
    _st('spb', 'width', v + '%'); _st('spb', 'background', c);
    const ld = document.getElementById('sp-line-dots');
    if (ld) ld.innerHTML = s.l.map(l => `<span style="width:8px;height:8px;border-radius:50%;background:${METRO.LINE_COLORS[l]};display:inline-block;margin-right:3px"></span><span>${METRO.LINE_NAMES[l]}</span>`).join('<span style="color:var(--muted);margin:0 4px">·</span>');
    const sp = document.getElementById('spspk');
    if (sp) { const fc = CROWD.stationForecast(id); sp.innerHTML = fc.map((fv, h) => `<div class="spk" style="height:${Math.round(fv * .26)}px;background:${h === CROWD.state.hour ? c : CROWD.color(fv)};opacity:${h === CROWD.state.hour ? 1 : .5};flex:1;min-width:2px;border-radius:1px 1px 0 0"></div>`).join('') }
    document.getElementById('sp')?.classList.add('show');
    if (activeTab === 'map') MAP.flyTo(id);
  }

  function closePanel() { panelId = null; document.getElementById('sp')?.classList.remove('show') }
  function refreshPanel() { if (panelId) openPanel(panelId) }

  function setupSlider() {
    const sl = document.getElementById('ts'); if (!sl) return;
    sl.value = CROWD.state.hour;
    _s('tl', CROWD.hourLabel(CROWD.state.hour));
    sl.addEventListener('input', () => {
      CROWD.state.hour = +sl.value; CROWD.state.isLive = false;
      _s('tl', CROWD.hourLabel(CROWD.state.hour)); _s('tm', '⏱ SIMULATE');
      triggerUpdate(); if (activeTab === 'stats') renderTimeline();
    });
  }

  function setupFilters() {
    document.querySelectorAll('.lfb').forEach(b => {
      b.addEventListener('click', () => {
        const l = b.dataset.l;
        document.querySelectorAll('.lfb').forEach(x => {
          x.classList.remove('on'); x.style.background = '';
          x.style.color = x.dataset.l === 'all' ? '' : (METRO.LINE_COLORS[x.dataset.l] || '');
          x.style.borderColor = '';
        });
        b.classList.add('on');
        b.style.background = l === 'all' ? 'var(--accent)' : (METRO.LINE_COLORS[l] || 'var(--accent)');
        b.style.color = '#000'; b.style.borderColor = 'transparent';
        MAP.setLineFilter(l);
      });
    });
  }

  // STATS
  function renderStats() { renderSummary(); renderTimeline(); renderIX() }

  function renderSummary() {
    const ns = CROWD.networkStats(); const bs = METRO.STATIONS[ns.maxId];
    document.getElementById('sg').innerHTML = `
      <div class="sg-card"><div class="sg-val" style="color:${CROWD.color(ns.avg)}">${ns.avg}%</div><div class="sg-lbl">Network Avg</div></div>
      <div class="sg-card"><div class="sg-val" style="color:${CROWD.color(ns.max)}">${ns.max}%</div><div class="sg-lbl">Peak Crowd</div></div>
      <div class="sg-card"><div class="sg-val" style="color:var(--low)">${ns.low}</div><div class="sg-lbl">Low Stations</div></div>
      <div class="sg-card"><div class="sg-val" style="color:var(--pk)">${ns.pk}</div><div class="sg-lbl">Packed Now</div></div>
      <div class="sg-card sg-clickable" onclick="UI.openStationFromStats('${ns.maxId}')">
        <div class="sg-val" style="font-size:10px;color:#fff;line-height:1.3">${bs?.n || '—'}</div>
        <div class="sg-lbl">Busiest ↗</div></div>
      <div class="sg-card"><div class="sg-val">${CROWD.hourLabel(CROWD.state.hour)}</div><div class="sg-lbl">Sim Time</div></div>
      <div class="sg-card"><div class="sg-val">${ns.total}</div><div class="sg-lbl">Total Stations</div></div>
      <div class="sg-card"><div class="sg-val" style="color:var(--med)">${CROWD.state.newsEvents.filter(e => e.active).length}</div><div class="sg-lbl">Active Events</div></div>`;
  }

  function renderTimeline() {
    const svg2 = document.getElementById('tlsvg'); if (!svg2) return;
    const td = CROWD.networkTimeline(); const W = 360, H = 80;
    const pts = td.map((v, h) => `${(h / 23) * (W - 20) + 10},${H - 10 - (v / 100) * (H - 24)}`).join(' ');
    const ap = `10,${H - 10} ` + td.map((v, h) => `${(h / 23) * (W - 20) + 10},${H - 10 - (v / 100) * (H - 24)}`).join(' ') + ` ${W - 10},${H - 10}`;
    const cx = (CROWD.state.hour / 23) * (W - 20) + 10, cy = H - 10 - (td[CROWD.state.hour] / 100) * (H - 24);
    const rush = [[6, 10], [16, 21]].map(([a, b]) => `<rect x="${(a / 23) * (W - 20) + 10}" y="4" width="${((b - a) / 23) * (W - 20)}" height="${H - 16}" fill="#FF6B00" opacity=".07" rx="2"/>`).join('');
    const ticks = [0, 3, 6, 9, 12, 15, 18, 21].map(h => { const x = (h / 23) * (W - 20) + 10; const l = h === 0 ? '12A' : h === 12 ? '12P' : h < 12 ? h + 'A' : (h - 12) + 'P'; return `<text x="${x}" y="${H}" fill="#3E5272" font-size="6.5" font-family="Space Mono,monospace" text-anchor="middle">${l}</text>` }).join('');
    svg2.innerHTML = `<defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FF6B00" stop-opacity=".35"/><stop offset="100%" stop-color="#FF6B00" stop-opacity="0"/></linearGradient></defs>${rush}<polygon points="${ap}" fill="url(#tg)"/><polyline points="${pts}" fill="none" stroke="#FF6B00" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>${ticks}<line x1="${cx}" y1="4" x2="${cx}" y2="${H - 10}" stroke="#FF6B00" stroke-width="1.2" stroke-dasharray="3,2" opacity=".8"/><circle cx="${cx}" cy="${cy}" r="3.5" fill="#FF6B00" stroke="#080C12" stroke-width="1.5"/><rect x="${cx - 12}" y="${cy - 14}" width="24" height="12" rx="3" fill="#FF6B00"/><text x="${cx}" y="${cy - 5}" fill="#000" font-size="7" font-family="Space Mono,monospace" text-anchor="middle" font-weight="700">${td[CROWD.state.hour]}%</text>`;
  }

  function renderIX() {
    const data = CROWD.interchangePressure(10);
    document.getElementById('ixlist').innerHTML = data.map(({ id, n, v }, i) => `
      <div class="ixr" onclick="UI.openStationFromStats('${id}')">
        <div class="ixrk">${i + 1}</div><div class="ixnm">${n}</div>
        <div class="ixbw"><div class="ixbar" style="width:${v}%;background:${CROWD.color(v)}"></div></div>
        <div class="ixpct" style="color:${CROWD.color(v)}">${v}%</div></div>`).join('');
  }

  // LINES
  function renderLines() {
    document.getElementById('lclist').innerHTML = CROWD.lineAverages().map(({ l, avg, name, color, count }) => `
      <div class="lr"><div class="ldot" style="background:${color}"></div>
      <div class="lnm">${name} <span style="color:var(--muted);font-size:8px">(${count})</span></div>
      <div class="lbw"><div class="lbar" style="width:${avg}%;background:${color};opacity:.85"></div></div>
      <div class="lpct" style="color:${CROWD.color(avg)}">${avg}%</div></div>`).join('');
    const top = CROWD.topStations(12);
    document.getElementById('toplist').innerHTML = top.map(({ id, v, s }, i) => s ? `
      <div class="ixr" onclick="UI.openStationFromStats('${id}')">
        <div class="ixrk">#${i + 1}</div><div class="ixnm">${s.n}</div>
        <div style="font-size:8px;font-family:'Space Mono',monospace;flex-shrink:0;margin-right:3px;color:${METRO.LINE_COLORS[s.l[0]]}">${s.l[0]}</div>
        <div class="ixbw"><div class="ixbar" style="width:${v}%;background:${CROWD.color(v)}"></div></div>
        <div class="ixpct" style="color:${CROWD.color(v)}">${v}%</div></div>` : '').join('');
  }

  // EVENTS — news-only
  function renderEvents() {
    const all = CROWD.state.newsEvents;
    const nsEl = document.getElementById('news-status');
    if (nsEl) {
      const act = all.filter(e => e.active).length;
      nsEl.textContent = all.length ? `${all.length} articles · ${act} boosting crowd model · refreshes every 30s` : 'Fetching from GNews API…';
    }
    if (!all.length) {
      document.getElementById('evlist').innerHTML = '<div style="font-size:9px;color:var(--muted);font-family:Space Mono,monospace;padding:14px;text-align:center;line-height:1.8">📡 Scanning GNews for Delhi Metro alerts…<br>Results appear within 30 seconds.</div>';
      return;
    }
    document.getElementById('evlist').innerHTML = all.map(ev => {
      const aff = (ev.affected || []).slice(0, 4).map(id => METRO.STATIONS[id]?.n || id).join(', ') + ((ev.affected?.length || 0) > 4 ? ' +more' : '');
      const pills = ev.active ? (ev.affected || []).slice(0, 5).map(id => {
        const v = CROWD.state.crowdMap[id] || 0, c = CROWD.color(v);
        return `<span style="background:${c}22;color:${c};border:1px solid ${c}44;border-radius:6px;padding:1px 5px;font-size:8px;font-family:'Space Mono',monospace">${(METRO.STATIONS[id]?.n || id).split(' ')[0]} ${v}%</span>`;
      }).join(' ') : '';
      const sevCol = ev.sev === 'emergency' ? 'var(--pk)' : ev.sev === 'security' ? 'var(--pk)' : ev.sev === 'protest' ? 'var(--hi)' : ev.sev === 'delay' ? 'var(--med)' : ev.sev === 'event' ? 'var(--a2)' : 'var(--muted)';
      return `<div class="nec ${ev.active ? 'aev' : ''}" id="ec-${ev.id}">
        <div class="neh"><div style="flex:1;min-width:0">
          <div class="nen">${ev.icon} ${ev.name}</div>
          <div class="nem" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:3px">
            <span style="color:${sevCol};font-weight:700">${ev.active ? '● ACTIVE' : '○ Monitoring'}</span>
            <span>+${Math.round((ev.boost - 1) * 100)}% crowd surge</span>
            ${ev.time ? `<span>${ev.date} ${ev.time}</span>` : ''}
          </div>
          <div class="ned">${ev.detail || ''}</div>
          <div class="ned" style="color:var(--a2);margin-top:2px">📍 ${aff}</div>
          ${ev.active && pills ? `<div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:3px">${pills}</div>` : ''}
          ${ev.url ? `<div class="news-src"><a href="${ev.url}" target="_blank" style="color:var(--muted);text-decoration:none;font-size:8px">↗ ${ev.source || 'Source'}</a></div>` : ''}
        </div>
        <button class="tgb ${ev.active ? 'on' : ''}" onclick="UI.toggleEvent('${ev.id}',true)">${ev.active ? 'On' : 'Off'}</button>
        </div></div>`;
    }).join('');
  }

  function toggleEvent(id, isN) {
    const arr = CROWD.state.newsEvents;
    const ev = arr.find(e => e.id === id);
    if (ev) { ev.active = !ev.active; triggerUpdate(); renderEvents() }
  }

  // REPORT
  function populateReportSelect() {
    const sel = document.getElementById('rpst'); if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— Select your station —</option>' + Object.entries(METRO.STATIONS).sort((a, b) => a[1].n.localeCompare(b[1].n)).map(([id, s]) => `<option value="${id}">${s.n} (${s.l.join('/')})</option>`).join('');
    if (prev) sel.value = prev;
  }

  function pickLevel(lv) {
    selLevel = lv;
    document.querySelectorAll('.clb').forEach(b => { b.className = 'clb'; if (b.dataset.lv === lv) b.classList.add(lv === 'empty' ? 'se' : lv === 'moderate' ? 'sm' : 'sp') });
  }

  function submitReport() {
    const id = document.getElementById('rpst').value; if (!id || !selLevel) return;
    CROWD.state.userReports[id] = selLevel; triggerUpdate();
    const msg = document.getElementById('sucmsg'); if (msg) { msg.style.display = 'block'; setTimeout(() => msg.style.display = 'none', 3000) }
    renderReportList();
    document.getElementById('rpst').value = '';
    document.querySelectorAll('.clb').forEach(b => b.className = 'clb'); selLevel = '';
  }

  function renderReportList() {
    const entries = Object.entries(CROWD.state.userReports);
    const el = document.getElementById('rplist'); if (!el) return;
    if (!entries.length) { el.innerHTML = '<div style="font-size:9px;color:var(--muted);font-family:Space Mono,monospace;text-align:center;padding:6px">No reports yet.</div>'; return }
    el.innerHTML = entries.map(([id, lv]) => {
      const s = METRO.STATIONS[id]; const c = lv === 'empty' ? 'var(--low)' : lv === 'moderate' ? 'var(--med)' : 'var(--pk)'; const bg = lv === 'empty' ? 'rgba(0,230,118,.1)' : lv === 'moderate' ? 'rgba(255,214,0,.1)' : 'rgba(255,23,68,.1)';
      return `<div class="rpit"><div><div class="rpnm">${s?.n || id}</div><div style="font-size:8px;color:var(--muted);font-family:'Space Mono',monospace">${s?.l?.map(l => METRO.LINE_NAMES[l]).join(' · ') || ''}</div></div><span class="rplv" style="color:${c};background:${bg}">${lv.toUpperCase()}</span></div>`
    }).join('');
  }

  function triggerUpdate() {
    CROWD.recomputeAll(); MAP.updateMarkers(); updateHeader();
    if (panelId) refreshPanel();
    if (activeTab === 'stats') renderStats();
    if (activeTab === 'lines') renderLines();
    if (activeTab === 'events') renderEvents();
  }

  function openStationFromStats(id) { switchTab('map'); setTimeout(() => openPanel(id), 80) }

  // Helpers
  function _s(id, v) { const e = document.getElementById(id); if (e) e.textContent = v }
  function _sc(id, v, c) { const e = document.getElementById(id); if (e) { e.textContent = v; e.style.color = c } }
  function _st(id, p, v) { const e = document.getElementById(id); if (e) e.style[p] = v }

  return {
    init, switchTab, refreshIfActive, updateHeader, openPanel, closePanel, refreshPanel,
    renderStats, renderLines, renderEvents, renderTimeline, toggleEvent, pickLevel, submitReport,
    openStationFromStats, triggerUpdate, get activeTab() { return activeTab }
  };
})();