// ─────────────────────────────────────────────────────────────────────────────
//  ICONS.js — shared inline SVG icon library
//  Usage: ICONS.train, ICONS.pin, etc.
//  All icons are stroke-based, currentColor, 16x16 unless noted
// ─────────────────────────────────────────────────────────────────────────────
window.ICONS = (function(){
  function svg(body, size='16') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  }
  function svgC(body, size='16') {  // colored fill variant
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" stroke="none">${body}</svg>`;
  }

  return {
    // ── Transport ───────────────────────────────────────────────
    train:    (s='16') => svg(`<rect x="2" y="7" width="20" height="11" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/><line x1="7" y1="12" x2="17" y2="12"/><path d="M7 18l-2 3M17 18l2 3"/>`, s),
    metro:    (s='16') => svg(`<path d="M4 17V7a4 4 0 014-4h8a4 4 0 014 4v10"/><path d="M2 17h20"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M7 7h10v6H7z"/>`, s),

    // ── Location ────────────────────────────────────────────────
    pin:      (s='16') => svg(`<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>`, s),
    gps:      (s='16') => svg(`<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8" stroke-dasharray="2 3" opacity=".5"/>`, s),
    target:   (s='16') => svg(`<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>`, s),

    // ── Status ──────────────────────────────────────────────────
    check:    (s='16') => svg(`<polyline points="20 6 9 17 4 12"/>`, s),
    checkCircle:(s='16')=>svg(`<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>`, s),
    xmark:    (s='16') => svg(`<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`, s),
    warn:     (s='16') => svg(`<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>`, s),
    info:     (s='16') => svg(`<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>`, s),

    // ── Notifications ───────────────────────────────────────────
    bell:     (s='16') => svg(`<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>`, s),
    bellOff:  (s='16') => svg(`<path d="M13.73 21a2 2 0 01-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0118 8"/><path d="M6.26 6.26A5.86 5.86 0 006 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 00-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/>`, s),

    // ── UI ──────────────────────────────────────────────────────
    home:     (s='16') => svg(`<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>`, s),
    building: (s='16') => svg(`<rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22V12h6v10"/><rect x="8" y="6" width="2" height="2"/><rect x="14" y="6" width="2" height="2"/><rect x="8" y="11" width="2" height="2"/><rect x="14" y="11" width="2" height="2"/>`, s),
    chart:    (s='16') => svg(`<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>`, s),
    clock:    (s='16') => svg(`<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`, s),
    lightning:(s='16') => svg(`<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`, s),
    phone:    (s='16') => svg(`<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>`, s),
    refresh:  (s='16') => svg(`<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>`, s),
    star:     (s='16') => svg(`<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>`, s),
    user:     (s='16') => svg(`<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>`, s),
    mail:     (s='16') => svg(`<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>`, s),
    medal:    (s='16') => svg(`<circle cx="12" cy="15" r="7"/><path d="M8.56 2.9A7 7 0 004.13 8H2l3 6.5"/><path d="M15.44 2.9A7 7 0 0119.87 8H22l-3 6.5"/><line x1="12" y1="8" x2="12" y2="11"/><line x1="10.5" y1="10.5" x2="12" y2="11"/>`, s),
    news:     (s='16') => svg(`<path d="M4 22h16a2 2 0 002-2V4a2 2 0 00-2-2H8a2 2 0 00-2 2v16a2 2 0 01-2 2zm0 0a2 2 0 01-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6z"/>`, s),
    wrench:   (s='16') => svg(`<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>`, s),
    people:   (s='16') => svg(`<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>`, s),
    arrowDown:(s='16') => svg(`<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>`, s),
    arrowUp:  (s='16') => svg(`<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>`, s),
    flag:     (s='16') => svg(`<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>`, s),
    compass:  (s='16') => svg(`<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>`, s),
    female:   (s='16') => svg(`<circle cx="12" cy="8" r="5"/><path d="M12 13v8M9 18h6"/>`, s),
    access:   (s='16') => svg(`<circle cx="12" cy="4" r="2"/><path d="M6 8h12l-2 10H8L6 8z"/><path d="M9 8L7 20M15 8l2 12"/>`, s),
    // Dot indicators (filled circles)
    dotGreen: () => `<div style="width:8px;height:8px;border-radius:50%;background:#4ade80;flex-shrink:0"></div>`,
    dotYellow:() => `<div style="width:8px;height:8px;border-radius:50%;background:#fbbf24;flex-shrink:0"></div>`,
    dotRed:   () => `<div style="width:8px;height:8px;border-radius:50%;background:#ef4444;flex-shrink:0"></div>`,
  };
})();
