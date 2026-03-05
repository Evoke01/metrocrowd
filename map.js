window.MAP = (function () {
  const NS = 'http://www.w3.org/2000/svg';
  let svg, gAll, gNCR, gGrid, gLines, gRoute, gSt, gLbl;
  let markerEls = {}, lineEls = {};
  let px = 0, py = 0, sc = 1;
  let dragging = false, dx, dy, px0, py0, _md = false, pinch0 = 0;
  let filter = 'all';
  let onCk = null;
  let ready = false;

  function el(tag, attrs, par) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (par) par.appendChild(e); return e;
  }
  function grp(attrs, par) { return el('g', attrs, par) }
  function txt(x, y, content, attrs, par) {
    const t = el('text', { x, y, ...attrs }, par); t.textContent = content; return t;
  }

  function init(id, cb) {
    svg = document.getElementById(id); onCk = cb;
    svg.setAttribute('viewBox', '0 0 1100 820');
    resize();
    // ── Defs ────────────────────────────────────────────────────
    const defs = el('defs', {}, svg);
    const f1 = el('filter', { id: 'glow-soft', x: '-30%', y: '-30%', width: '160%', height: '160%' }, defs);
    el('feGaussianBlur', { stdDeviation: '2.5', result: 'b' }, f1);
    const m1 = el('feMerge', {}, f1); el('feMergeNode', { in: 'b' }, m1); el('feMergeNode', { in: 'SourceGraphic' }, m1);
    const f2 = el('filter', { id: 'glow-route', x: '-30%', y: '-30%', width: '160%', height: '160%' }, defs);
    el('feGaussianBlur', { stdDeviation: '4', result: 'b' }, f2);
    const m2 = el('feMerge', {}, f2); el('feMergeNode', { in: 'b' }, m2); el('feMergeNode', { in: 'SourceGraphic' }, m2);
    const f3 = el('filter', { id: 'glow-ncr', x: '-10%', y: '-10%', width: '120%', height: '120%' }, defs);
    el('feGaussianBlur', { stdDeviation: '6', result: 'b' }, f3);
    const m3 = el('feMerge', {}, f3); el('feMergeNode', { in: 'b' }, m3); el('feMergeNode', { in: 'SourceGraphic' }, m3);
    // Gradient for NCR fill
    const radGrad = el('radialGradient', { id: 'ncr-fill', cx: '50%', cy: '50%', r: '60%' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#0A2540', 'stop-opacity': '.35' }, radGrad);
    el('stop', { offset: '100%', 'stop-color': '#050E1A', 'stop-opacity': '.12' }, radGrad);

    gAll = grp({ id: 'g-all' }, svg);
    gNCR = grp({ id: 'g-ncr' }, gAll);
    gGrid = grp({ id: 'g-grid', opacity: '.22' }, gAll);
    gLines = grp({ id: 'g-lines' }, gAll);
    gRoute = grp({ id: 'g-route' }, gAll);
    gSt = grp({ id: 'g-st' }, gAll);
    gLbl = grp({ id: 'g-lbl', opacity: '0', 'pointer-events': 'none' }, gAll);

    buildNCROutline();
    buildGrid();
    buildLines();
    buildStations();
    buildLabels();
    setupInput();

    const wrap = svg.parentElement;
    const W = wrap.clientWidth || 360, H = wrap.clientHeight || 440;
    sc = Math.min(W / 1100, H / 820) * 1.35;
    px = (W - 1100 * sc) / 2 + 15; py = (H - 820 * sc) / 2 - 5;
    apply(); ready = true;
    console.log('[MAP] ready');
  }

  // ── Delhi NCR Boundary Outline ──────────────────────────────────
  function buildNCROutline() {
    // NCR outer region (Gurgaon, Noida, Ghaziabad, Faridabad extended)
    const ncrPath = `M 180,-70
      L 390,-90 L 560,-75 L 720,-50 L 840,20
      L 900,120 L 940,240 L 980,380 L 1060,560
      L 1060,700 L 980,820 L 860,870
      L 700,870 L 540,850 L 380,860
      L 200,830 L 60,760 L -30,650
      L -50,480 L -30,300 L 40,140
      L 120,40 Z`;
    el('path', { d: ncrPath, fill: 'url(#ncr-fill)', stroke: 'none', 'pointer-events': 'none' }, gNCR);

    // Delhi state boundary (inner, more precise)
    const delhiPath = `M 310,-10
      L 430,-32 L 540,-28 L 660,-8
      L 760,52 L 820,140 L 855,260
      L 862,390 L 820,500
      L 830,590 L 780,700 L 720,780
      L 640,820 L 530,820 L 420,810
      L 310,790 L 200,750 L 100,680
      L 20,580 L 0,460 L 10,330
      L 50,200 L 130,90 L 220,20 Z`;
    // Glow layer
    el('path', {
      d: delhiPath, fill: 'none', stroke: '#1B3D6B', 'stroke-width': '3',
      opacity: '.4', filter: 'url(#glow-ncr)', 'pointer-events': 'none'
    }, gNCR);
    // Main border line
    el('path', {
      d: delhiPath, fill: 'rgba(10,30,58,0.18)', stroke: '#2A5FA8',
      'stroke-width': '1.5', 'stroke-dasharray': '8,5', opacity: '.65', 'pointer-events': 'none'
    }, gNCR);

    // District/area subtle fill zones
    // Gurgaon zone (SW)
    el('path', {
      d: 'M 200,830 L 60,760 L -30,650 L -50,480 L 60,550 L 100,680 Z',
      fill: 'rgba(0,150,180,0.04)', stroke: 'rgba(0,190,212,0.2)', 'stroke-width': '1',
      'stroke-dasharray': '5,6', opacity: '.7', 'pointer-events': 'none'
    }, gNCR);
    // Noida zone (SE-E)
    el('path', {
      d: 'M 820,500 L 860,390 L 980,380 L 1060,560 L 1060,700 L 980,820 L 860,870 L 780,700 Z',
      fill: 'rgba(0,150,120,0.04)', stroke: 'rgba(0,200,150,0.2)', 'stroke-width': '1',
      'stroke-dasharray': '5,6', opacity: '.7', 'pointer-events': 'none'
    }, gNCR);
    // Ghaziabad zone (NE)
    el('path', {
      d: 'M 660,-8 L 840,20 L 900,120 L 820,140 L 760,52 Z',
      fill: 'rgba(180,100,0,0.03)', stroke: 'rgba(220,140,0,0.18)', 'stroke-width': '1',
      'stroke-dasharray': '5,6', opacity: '.7', 'pointer-events': 'none'
    }, gNCR);
    // Faridabad zone (S)
    el('path', {
      d: 'M 640,820 L 720,780 L 780,700 L 860,870 L 700,870 L 540,850 Z',
      fill: 'rgba(160,0,100,0.03)', stroke: 'rgba(200,0,130,0.18)', 'stroke-width': '1',
      'stroke-dasharray': '5,6', opacity: '.7', 'pointer-events': 'none'
    }, gNCR);

    // City/region labels
    const lblStyle = {
      'font-family': 'Space Mono,monospace', 'pointer-events': 'none',
      'text-anchor': 'middle', 'font-weight': '700'
    };
    txt(100, 790, 'GURUGRAM', { ...lblStyle, 'font-size': '10', fill: '#00BCD4', opacity: '.55', 'letter-spacing': '0.08em' }, gNCR);
    txt(980, 640, 'NOIDA / G. NOIDA', { ...lblStyle, 'font-size': '9', fill: '#00E676', opacity: '.5', 'letter-spacing': '0.06em' }, gNCR);
    txt(820, 60, 'GHAZIABAD', { ...lblStyle, 'font-size': '9', fill: '#FFD600', opacity: '.45', 'letter-spacing': '0.06em' }, gNCR);
    txt(740, 850, 'FARIDABAD', { ...lblStyle, 'font-size': '9', fill: '#AB47BC', opacity: '.5', 'letter-spacing': '0.06em' }, gNCR);
    txt(440, -60, 'DELHI NCR', { ...lblStyle, 'font-size': '11', fill: '#2A5FA8', opacity: '.55', 'letter-spacing': '0.14em' }, gNCR);

    // Compass rose (bottom-right corner of unzoomed view)
    const cg = grp({ 'transform': 'translate(1060,780)', 'pointer-events': 'none' }, gNCR);
    txt(0, -16, 'N', {
      'font-family': 'Space Mono,monospace', 'font-size': '7', fill: '#3E5272',
      'text-anchor': 'middle'
    }, cg);
    el('line', { x1: 0, y1: -12, x2: 0, y2: 12, stroke: '#1C2A3C', 'stroke-width': '1' }, cg);
    el('line', { x1: -12, y1: 0, x2: 12, y2: 0, stroke: '#1C2A3C', 'stroke-width': '1' }, cg);
    el('circle', { cx: 0, cy: 0, r: 3, fill: '#2A5FA8', opacity: '.5' }, cg);
    txt(16, 3, 'E', { 'font-family': 'Space Mono,monospace', 'font-size': '6', fill: '#3E5272' }, cg);
    txt(-16, 3, 'W', { 'font-family': 'Space Mono,monospace', 'font-size': '6', fill: '#3E5272' }, cg);
    txt(0, 22, 'S', {
      'font-family': 'Space Mono,monospace', 'font-size': '7', fill: '#3E5272',
      'text-anchor': 'middle'
    }, cg);
  }

  // ── Grid ─────────────────────────────────────────────────────────
  function buildGrid() {
    for (let x = -80; x <= 1200; x += 40)
      el('line', { x1: x, y1: -100, x2: x, y2: 900, stroke: '#1C2A3C', 'stroke-width': '.5' }, gGrid);
    for (let y = -100; y <= 900; y += 40)
      el('line', { x1: -80, y1: y, x2: 1200, y2: y, stroke: '#1C2A3C', 'stroke-width': '.5' }, gGrid);
  }

  // ── Lines ─────────────────────────────────────────────────────────
  function buildLines() {
    Object.entries(METRO.LINE_PATHS).forEach(([key, ids]) => {
      const lc = lineCode(key);
      const col = METRO.LINE_COLORS[lc] || '#888';
      const pts = ids.map(id => { const s = METRO.STATIONS[id]; return s ? `${s.x},${s.y}` : null }).filter(Boolean).join(' ');
      if (!pts) return;
      // Shadow/glow pass
      el('polyline', {
        points: pts, fill: 'none', stroke: col, 'stroke-width': '6', 'stroke-linecap': 'round',
        'stroke-linejoin': 'round', opacity: '.12', filter: 'url(#glow-soft)', 'data-line': lc
      }, gLines);
      // Main line
      const pl = el('polyline', {
        points: pts, fill: 'none', stroke: col, 'stroke-width': '3.5',
        'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: '.9', 'data-line': lc
      }, gLines);
      lineEls[key] = pl;
    });
  }

  function lineCode(key) {
    const map = {
      Y: 'Y', BW: 'B', BE: 'B', BNE: 'B', BSE: 'B', RW: 'R', RE: 'R', GA: 'G', GB: 'G', GC: 'G',
      PNW: 'P', PW: 'P', PE: 'P', PNE: 'P', PTR: 'P', PWEL: 'P', PAZ: 'P',
      M: 'M', VN: 'V', VITO: 'V', VS: 'V', A: 'A', Gr: 'Gr', Aq: 'Aq'
    };
    for (const [p, l] of Object.entries(map)) if (key.startsWith(p)) return l;
    return 'B';
  }

  // ── Stations ──────────────────────────────────────────────────────
  function buildStations() {
    Object.entries(METRO.STATIONS).forEach(([id, s]) => {
      const r = s.hot ? 7.5 : s.ix ? 6 : 4.5;
      const g = grp({ 'data-id': id, cursor: 'pointer' }, gSt);
      if (s.ix) el('circle', {
        cx: s.x, cy: s.y, r: r + 5, fill: 'none', stroke: '#fff',
        'stroke-width': '.7', opacity: '.15'
      }, g);
      if (s.hot) {
        // Pulse ring
        const pr = el('circle', {
          cx: s.x, cy: s.y, r: r + 10, fill: 'none', stroke: '#FF1744',
          'stroke-width': '1.5', opacity: '.0'
        }, g);
        pr.innerHTML = `<animate attributeName="r" from="${r + 4}" to="${r + 14}" dur="2s" repeatCount="indefinite"/>
          <animate attributeName="opacity" from=".5" to="0" dur="2s" repeatCount="indefinite"/>`;
      }
      const c = el('circle', {
        cx: s.x, cy: s.y, r, fill: '#00E676', stroke: '#080C12',
        'stroke-width': s.ix ? 1.8 : 1, 'data-cid': id
      }, g);
      markerEls[id] = c;
      g.addEventListener('click', e => { e.stopPropagation(); if (!dragging && onCk) onCk(id) });
    });
  }

  // ── Labels ────────────────────────────────────────────────────────
  function buildLabels() {
    Object.entries(METRO.STATIONS).forEach(([, s]) => {
      const words = s.n.split(' ').slice(0, 2).join(' ');
      const t = el('text', {
        x: s.x + 7, y: s.y + 3, 'font-size': '5.5', 'font-family': 'Space Mono,monospace',
        fill: '#7A9BBE', 'pointer-events': 'none'
      }, gLbl);
      t.textContent = words;
    });
  }

  // ── Input ─────────────────────────────────────────────────────────
  function setupInput() {
    const w = svg.parentElement;
    w.addEventListener('mousedown', e => {
      _md = true; dragging = false; dx = e.clientX; dy = e.clientY;
      px0 = px; py0 = py; svg.style.cursor = 'grabbing'
    });
    w.addEventListener('mousemove', e => {
      if (!_md) return;
      const ex = e.clientX - dx, ey = e.clientY - dy;
      if (Math.abs(ex) > 3 || Math.abs(ey) > 3) dragging = true;
      px = px0 + ex; py = py0 + ey; apply();
    });
    w.addEventListener('mouseup', () => { _md = false; svg.style.cursor = 'grab' });
    w.addEventListener('mouseleave', () => { _md = false; svg.style.cursor = 'grab' });
    w.addEventListener('wheel', e => {
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.13 : .87;
      const r = svg.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      px = mx - (mx - px) * f; py = my - (my - py) * f;
      sc = Math.max(.18, Math.min(12, sc * f)); apply();
    }, { passive: false });
    w.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        _md = true; dragging = false; dx = e.touches[0].clientX;
        dy = e.touches[0].clientY; px0 = px; py0 = py
      }
      else if (e.touches.length === 2)
        pinch0 = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY);
    }, { passive: false });
    w.addEventListener('touchmove', e => {
      e.preventDefault();
      if (e.touches.length === 1 && _md) {
        const ex = e.touches[0].clientX - dx, ey = e.touches[0].clientY - dy;
        if (Math.abs(ex) > 3 || Math.abs(ey) > 3) dragging = true;
        px = px0 + ex; py = py0 + ey; apply();
      } else if (e.touches.length === 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY);
        sc = Math.max(.18, Math.min(12, sc * d / pinch0)); pinch0 = d; apply();
      }
    }, { passive: false });
    w.addEventListener('touchend', () => { _md = false });
    w.addEventListener('click', () => { if (!dragging && onCk) onCk(null) });
  }

  function apply() {
    if (!gAll) return;
    gAll.setAttribute('transform', `translate(${px},${py}) scale(${sc})`);
    if (gLbl) gLbl.setAttribute('opacity', sc > 2.0 ? '.9' : '0');
  }

  function updateMarkers() {
    if (!ready) return;
    const cm = CROWD.state.crowdMap;
    Object.entries(METRO.STATIONS).forEach(([id, s]) => {
      const c = markerEls[id]; if (!c) return;
      const v = cm[id] || 50;
      const show = filter === 'all' || s.l.includes(filter);
      c.setAttribute('fill', CROWD.color(v));
      c.setAttribute('opacity', show ? '1' : '.06');
    });
    Object.entries(lineEls).forEach(([key, pl]) => {
      const lc = lineCode(key);
      const show = filter === 'all' || filter === lc;
      pl.setAttribute('opacity', show ? '.92' : '.05');
      pl.setAttribute('stroke-width', filter !== 'all' && filter === lc ? '5' : '3.5');
    });
  }

  function setLineFilter(l) { filter = l; updateMarkers() }

  function clearRoute() {
    if (!gRoute) return;
    while (gRoute.firstChild) gRoute.removeChild(gRoute.firstChild);
  }

  function flyTo(id, ts) {
    const s = METRO.STATIONS[id]; if (!s) return;
    const w = svg.parentElement;
    const W = w.clientWidth || 360, H = w.clientHeight || 440;
    const ns = ts || Math.max(sc, 1.9);
    px = W / 2 - s.x * ns; py = H / 2 - s.y * ns - 60; sc = ns; apply();
  }

  function resize() {
    const w = svg.parentElement; if (!w) return;
    svg.setAttribute('width', w.clientWidth || 360);
    svg.setAttribute('height', w.clientHeight || 440);
  }

  return { init, updateMarkers, setLineFilter, clearRoute, flyTo, resize };
})();