// ══════════════════════════════════════════════════════════════════
//  guide.js — Platform & Exit Gate Guide
//
//  GUIDE.showForRoute(result)  — called from route.js after route computed
//  GUIDE.showForStation(id)    — standalone station gate lookup
//
//  Shows: which platform to board → which gate to exit at destination
// ══════════════════════════════════════════════════════════════════
window.GUIDE = (function () {
  'use strict';

  const API = 'https://metrocrowd.onrender.com';

  // Direction compass → readable
  const DIR_LABEL = { N:'North',S:'South',E:'East',W:'West',
    NE:'North-East',NW:'North-West',SE:'South-East',SW:'South-West' };

  // Line colours matching app theme
  const LINE_COLOR = {
    Y:'#FFD700', B:'#005DAA', R:'#E8312A', G:'#87C547',
    V:'#7B2D8B', O:'#F37021', M:'#EC268F', P:'#E74C8C',
    Gr:'#9B9B9B', Aq:'#00B4D8'
  };

  async function _fetch(path) {
    try {
      const r = await fetch(API + path);
      return r.json();
    } catch { return null; }
  }

  // ── Called from route.js with a computed route result ────────
  async function showForRoute(result) {
    if (!result?.ok || !result.hops?.length) return;

    const hops  = result.hops;
    const from  = hops[0];
    const to    = hops[hops.length - 1];
    const lines = result.lines || [];

    // Find first line and any transfer
    const line1  = lines[0]?.code || from.lines?.[0];
    const hasTransfer = lines.length > 1;
    const viaAt  = hasTransfer ? result.interchange_at : null;
    const line2  = hasTransfer ? lines[1]?.code : null;

    let url = `/guide/journey?from=${from.id}&to=${to.id}&line=${line1}`;
    if (viaAt)  url += `&via_at=${viaAt}`;
    if (line2)  url += `&via_line=${line2}`;

    _showLoading(from, to);
    const data = await _fetch(url);
    _renderPanel(data, from, to, line1, line2);
  }

  // ── Called from Station tab ───────────────────────────────────
  async function showForStation(stationId) {
    _showLoading({id: stationId, n: METRO.STATIONS[stationId]?.n || stationId}, null, null);
    const data = await _fetch(`/guide/station/${stationId}`);
    _renderStationOnly(data, stationId);
  }

  // ── Loading state injected into route result area ─────────────
  function _showLoading(from, to) {
    let el = document.getElementById('guide-panel');
    if (!el) {
      el = document.createElement('div');
      el.id = 'guide-panel';
      // Insert after route result card in #route-result
      const parent = document.getElementById('route-result') ||
                     document.getElementById('rcard') ||
                     document.querySelector('.route-result-wrap');
      if (parent) parent.appendChild(el);
      else document.getElementById('tab-route')?.appendChild(el);
    }
    el.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--brd);border-radius:16px;
        padding:14px 16px;margin-top:10px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:16px">🚉</span>
          <span style="font-family:'DM Serif Display',sans-serif;font-size:12px;font-weight:800;
            color:var(--txt)">Platform & Gate Guide</span>
          <div style="width:6px;height:6px;border-radius:50%;background:var(--y);
            animation:tnavPulse 1s infinite;margin-left:auto"></div>
        </div>
        <div style="font-size:11px;color:var(--sub)">Loading guide…</div>
      </div>`;
  }

  // ── Full journey guide panel ──────────────────────────────────
  function _renderPanel(data, from, to, line1, line2) {
    const el = document.getElementById('guide-panel');
    if (!el) return;

    if (!data?.ok) {
      el.innerHTML = _noDataCard(from, to);
      return;
    }

    const bp   = data.board_platform;
    const bt   = data.board_toward;
    const tp   = data.transfer_platform;
    const gates = data.destination_gates || [];
    const recs  = data.gate_recommendations || [];
    const fromName = METRO.STATIONS[from.id]?.n || from.id;
    const toName   = METRO.STATIONS[to.id]?.n   || to.id;
    const lc1  = LINE_COLOR[line1] || 'var(--y)';
    const lc2  = line2 ? (LINE_COLOR[line2] || '#888') : null;

    // ── Board section ─────────────────────────────────────────
    const boardSection = bp ? `
      <div style="background:rgba(255,208,0,.06);border:1px solid rgba(255,208,0,.15);
        border-radius:14px;padding:14px;margin-bottom:10px">
        <div style="font-size:10px;font-weight:700;color:var(--sub);letter-spacing:.07em;
          text-transform:uppercase;margin-bottom:8px">📍 At ${fromName}</div>

        <div style="display:flex;align-items:center;gap:12px">
          <!-- Platform number badge -->
          <div style="width:48px;height:48px;border-radius:12px;flex-shrink:0;
            background:${lc1};display:flex;flex-direction:column;
            align-items:center;justify-content:center">
            <div style="font-size:8px;font-weight:700;color:rgba(0,0,0,.6);
              letter-spacing:.05em">PLAT</div>
            <div style="font-family:'DM Serif Display',sans-serif;font-size:22px;font-weight:900;
              color:#000;line-height:1">${bp.platform_no}</div>
          </div>
          <!-- Direction info -->
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--txt)">
              Platform ${bp.platform_no}
              ${bp.side ? `<span style="font-size:10px;color:var(--sub);font-weight:400">
                · ${bp.side === 'left' ? '← Left side' : '→ Right side'}</span>` : ''}
            </div>
            <div style="font-size:11px;color:var(--sub);margin-top:2px">
              Toward <span style="color:var(--txt);font-weight:600">${bt || '—'}</span>
            </div>
            <div style="display:flex;align-items:center;gap:5px;margin-top:4px">
              <div style="width:10px;height:10px;border-radius:2px;background:${lc1}"></div>
              <span style="font-size:10px;color:var(--sub)">${line1} Line</span>
            </div>
          </div>
        </div>
      </div>` : `
      <div style="background:var(--card2);border:1px solid var(--brd);border-radius:14px;
        padding:12px;margin-bottom:10px;font-size:11px;color:var(--sub)">
        📍 <strong style="color:var(--txt)">${fromName}</strong> — 
        Platform data not yet available. Check the station board on arrival.
      </div>`;

    // ── Transfer section ──────────────────────────────────────
    const transferSection = tp ? `
      <div style="background:rgba(99,102,241,.06);border:1px solid rgba(99,102,241,.2);
        border-radius:14px;padding:14px;margin-bottom:10px">
        <div style="font-size:10px;font-weight:700;color:#6366f1;letter-spacing:.07em;
          text-transform:uppercase;margin-bottom:8px">⇄ Transfer</div>
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:48px;height:48px;border-radius:12px;flex-shrink:0;
            background:${lc2};display:flex;flex-direction:column;
            align-items:center;justify-content:center">
            <div style="font-size:8px;font-weight:700;color:rgba(0,0,0,.6)">PLAT</div>
            <div style="font-family:'DM Serif Display',sans-serif;font-size:22px;font-weight:900;
              color:#000;line-height:1">${tp.platform_no}</div>
          </div>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--txt)">
              Change to Platform ${tp.platform_no}</div>
            <div style="font-size:11px;color:var(--sub);margin-top:2px">
              ${tp.toward ? `Toward <span style="color:var(--txt);font-weight:600">${tp.toward}</span>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:5px;margin-top:4px">
              <div style="width:10px;height:10px;border-radius:2px;background:${lc2}"></div>
              <span style="font-size:10px;color:var(--sub)">${tp.line} Line</span>
            </div>
          </div>
        </div>
      </div>` : '';

    // ── Exit gates at destination ─────────────────────────────
    const exitSection = gates.length ? `
      <div style="background:rgba(74,222,128,.06);border:1px solid rgba(74,222,128,.2);
        border-radius:14px;padding:14px">
        <div style="font-size:10px;font-weight:700;color:#4ade80;letter-spacing:.07em;
          text-transform:uppercase;margin-bottom:10px">🚪 Exit at ${toName}</div>

        ${recs.length ? `
        <div style="background:rgba(74,222,128,.1);border-radius:10px;padding:10px 12px;
          margin-bottom:10px">
          <div style="font-size:10px;color:#4ade80;font-weight:700;margin-bottom:4px">
            ⭐ Recommended exits
          </div>
          ${recs.map(r => `
            <div style="display:flex;align-items:baseline;gap:6px;margin-top:4px">
              <span style="font-family:'DM Serif Display',sans-serif;font-size:13px;font-weight:900;
                color:var(--y)">Gate ${r.recommended_gate}</span>
              <span style="font-size:11px;color:var(--txt)">→ ${r.destination}</span>
              ${r.walk_minutes ? `<span style="font-size:10px;color:var(--sub);margin-left:auto">
                ${r.walk_minutes} min walk</span>` : ''}
            </div>
            ${r.notes ? `<div style="font-size:10px;color:var(--sub);margin-top:2px;
              padding-left:2px">${r.notes}</div>` : ''}
          `).join('')}
        </div>` : ''}

        <div style="font-size:10px;font-weight:700;color:var(--sub);margin-bottom:8px">
          All exits
        </div>
        ${gates.map(g => `
          <div style="display:flex;gap:10px;align-items:flex-start;
            padding:8px 0;border-bottom:1px solid var(--brd)">
            <!-- Gate badge -->
            <div style="width:32px;height:32px;border-radius:8px;flex-shrink:0;
              background:var(--card2);border:1px solid var(--brd2);
              display:flex;align-items:center;justify-content:center;
              font-family:'DM Serif Display',sans-serif;font-size:11px;font-weight:800;color:var(--txt)">
              ${g.gate_no}
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;font-weight:700;color:var(--txt)">
                ${g.gate_label || `Gate ${g.gate_no}`}
                ${g.is_lift ? '<span style="font-size:9px;color:#4ade80;margin-left:4px">♿ Lift</span>' : ''}
                ${g.direction ? `<span style="font-size:9px;color:var(--sub);margin-left:4px">
                  ${DIR_LABEL[g.direction] || g.direction} exit</span>` : ''}
              </div>
              ${g.landmarks?.length ? `<div style="font-size:10px;color:var(--sub);margin-top:2px">
                ${g.landmarks.slice(0,3).join(' · ')}</div>` : ''}
            </div>
          </div>`).join('')}
      </div>` : `
      <div style="background:var(--card2);border:1px solid var(--brd);border-radius:14px;
        padding:12px;font-size:11px;color:var(--sub)">
        🚪 <strong style="color:var(--txt)">${toName}</strong> — 
        Gate data not yet available. Follow signs inside the station.
      </div>`;

    el.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--brd);border-radius:16px;
        padding:14px 16px;margin-top:10px">
        <!-- Header -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
          <span style="font-size:18px">🚉</span>
          <div>
            <div style="font-family:'DM Serif Display',sans-serif;font-size:13px;font-weight:900;
              color:var(--txt)">Platform & Gate Guide</div>
            <div style="font-size:10px;color:var(--sub)">
              ${fromName} → ${toName}
            </div>
          </div>
        </div>

        ${boardSection}
        ${transferSection}
        ${exitSection}
      </div>
    `;
  }

  // ── Station-only view (no journey context) ────────────────────
  function _renderStationOnly(data, stationId) {
    const el = document.getElementById('guide-panel');
    if (!el || !data?.ok) return;

    const name  = METRO.STATIONS[stationId]?.n || stationId;
    const gates = data.gates || [];
    const plats = data.platforms || [];
    const recs  = data.recommendations || [];

    // Group platforms by line
    const byLine = {};
    plats.forEach(p => {
      if (!byLine[p.line_code]) byLine[p.line_code] = [];
      byLine[p.line_code].push(p);
    });

    const platRows = Object.entries(byLine).map(([lc, rows]) => {
      const lcolor = LINE_COLOR[lc] || '#888';
      return `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <div style="width:8px;height:8px;border-radius:2px;background:${lcolor};flex-shrink:0"></div>
          <span style="font-size:11px;font-weight:700;color:var(--txt)">${lc} Line</span>
          <div style="display:flex;gap:6px;margin-left:auto">
            ${rows.map(r => `
              <div style="background:${lcolor};border-radius:6px;padding:2px 8px;
                font-family:'DM Serif Display',sans-serif;font-size:11px;font-weight:800;color:#000">
                P${r.platform_no}
                <span style="font-size:9px;font-weight:400;opacity:.7">→ ${r.toward}</span>
              </div>`).join('')}
          </div>
        </div>`;
    }).join('');

    const gateRows = gates.map(g => `
      <div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--brd)">
        <div style="width:28px;height:28px;border-radius:6px;flex-shrink:0;
          background:var(--card2);border:1px solid var(--brd2);
          display:flex;align-items:center;justify-content:center;
          font-size:10px;font-weight:800;color:var(--txt)">${g.gate_no}</div>
        <div style="flex:1">
          <div style="font-size:11px;font-weight:700;color:var(--txt)">
            ${g.gate_label || `Gate ${g.gate_no}`}
            ${g.is_lift ? '<span style="color:#4ade80;font-size:9px;margin-left:4px">♿</span>' : ''}
          </div>
          ${g.landmarks?.length ? `<div style="font-size:10px;color:var(--sub)">
            ${g.landmarks.slice(0,3).join(' · ')}</div>` : ''}
        </div>
      </div>`).join('');

    el.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--brd);border-radius:16px;
        padding:14px 16px;margin-top:10px">
        <div style="font-family:'DM Serif Display',sans-serif;font-size:13px;font-weight:900;
          color:var(--txt);margin-bottom:12px">🚉 ${name} — Platform & Gates</div>
        ${platRows ? `<div style="margin-bottom:12px">${platRows}</div>` : ''}
        ${gateRows  ? `<div>${gateRows}</div>` : 
          '<div style="font-size:11px;color:var(--sub)">No gate data yet for this station.</div>'}
      </div>`;
  }

  function _noDataCard(from, to) {
    const fromName = METRO.STATIONS[from?.id]?.n || from?.id || '';
    const toName   = to ? (METRO.STATIONS[to?.id]?.n || to?.id || '') : '';
    return `
      <div style="background:var(--card);border:1px solid var(--brd);border-radius:16px;
        padding:14px 16px;margin-top:10px">
        <div style="font-size:13px;font-weight:700;color:var(--txt);margin-bottom:4px">
          🚉 Platform & Gate Guide</div>
        <div style="font-size:11px;color:var(--sub)">
          Guide data not available for this route yet.<br>
          Check the station info boards on arrival.
        </div>
      </div>`;
  }

  return { showForRoute, showForStation };
})();
