// ══════════════════════════════════════════════════════════════════
//  GPS MODULE — Stable nearest-station detection
//
//  Problems solved:
//  ① Raw degree Pythagoras gives wrong distances (±15% distortion)
//     → Replaced with Haversine in real metres
//  ② No smoothing: a single noisy fix jumps to wrong station
//     → Rolling buffer of last 5 high-accuracy fixes, averaged
//  ③ No lock: stations 116–186m apart switch on every update
//     → Hysteresis lock: stay on current station if user is
//       within LOCK_RADIUS (150m). Only switch if a rival station
//       is within SWITCH_RADIUS (120m) AND beats current by
//       MIN_ADVANTAGE (40m).
//  ④ One-shot getCurrentPosition, low accuracy
//     → watchPosition with enableHighAccuracy:true + timeout 12s
//  ⑤ Data bug: IND (Inderlok) had same coord as KNY (Kanhaiya Nagar)
//     → Patched in METRO.GPS at module init time
// ══════════════════════════════════════════════════════════════════
window.GPS = (function(){

  // ── Constants ──────────────────────────────────────────────────
  const BUFFER_SIZE    = 5;    // readings to average
  const LOCK_RADIUS    = 150;  // m — keep station if user still within this
  const SWITCH_RADIUS  = 120;  // m — candidate must be within this to qualify
  const MIN_ADVANTAGE  = 40;   // m — candidate must beat locked station by this much
  const MAX_ACCURACY   = 80;   // m — discard fixes worse than this (high noise)
  const WATCH_INTERVAL = 3000; // ms between watch updates (browser hint only)

  // ── State ──────────────────────────────────────────────────────
  let watchId       = null;
  let lockedStation = null;    // currently confirmed station id
  let buffer        = [];      // rolling [{lat,lng,acc}]
  let targetSelect  = null;    // DOM element id to auto-fill
  let onStation     = null;    // optional callback(stationId, stationName, distM)

  // ── Coordinate patches ─────────────────────────────────────────
  // Applied once at init() to correct known data bugs in METRO.GPS
  const COORD_PATCHES = {
    // DHK (Dhaula Kuan, Airport Express) — GPS corrected in data.js
    // VDS (Vidhan Sabha) — GPS corrected in data.js
    // IND, TGL — corrected in data.js (no longer need patches here)
  };

  // ── Haversine distance in metres ──────────────────────────────
  function haversine(lat1, lng1, lat2, lng2){
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) ** 2
            + Math.cos(lat1 * Math.PI/180)
            * Math.cos(lat2 * Math.PI/180)
            * Math.sin(dLng/2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  // ── Smooth a buffer of positions → single averaged fix ─────────
  function average(buf){
    const n = buf.length;
    return{
      lat: buf.reduce((s,p) => s + p.lat, 0) / n,
      lng: buf.reduce((s,p) => s + p.lng, 0) / n,
    };
  }

  // ── Nearest station (raw, no lock) using Haversine ─────────────
  function nearestRaw(lat, lng){
    let best = null, bestDist = Infinity;
    Object.entries(METRO.GPS || {}).forEach(([id, [slat, slng]]) => {
      const d = haversine(lat, lng, slat, slng);
      if(d < bestDist){ bestDist = d; best = id; }
    });
    return { id: best, dist: bestDist };
  }

  // ── Core: update lock state from a smoothed position ───────────
  function evaluate(lat, lng){
    const { id: candidate, dist: candidateDist } = nearestRaw(lat, lng);
    if(!candidate) return null;

    // No lock yet → set immediately if candidate is close enough
    if(!lockedStation){
      if(candidateDist <= SWITCH_RADIUS){
        lockedStation = candidate;
        return { id: candidate, dist: candidateDist, reason: 'initial' };
      }
      // Too far from any station — report nearest but don't lock
      return { id: candidate, dist: candidateDist, reason: 'far', locked: false };
    }

    // Already locked — compute distance to current locked station
    const lockedCoord = METRO.GPS[lockedStation];
    const lockedDist  = lockedCoord
      ? haversine(lat, lng, lockedCoord[0], lockedCoord[1])
      : Infinity;

    // Stay locked if still within hysteresis radius
    if(lockedDist <= LOCK_RADIUS){
      return { id: lockedStation, dist: lockedDist, reason: 'locked' };
    }

    // Left lock radius — consider switching
    // Candidate must be: (a) within SWITCH_RADIUS AND (b) MIN_ADVANTAGE closer
    const shouldSwitch = candidateDist <= SWITCH_RADIUS
                      && candidateDist < (lockedDist - MIN_ADVANTAGE);

    if(shouldSwitch){
      lockedStation = candidate;
      return { id: candidate, dist: candidateDist, reason: 'switched' };
    }

    // Neither close enough to old nor qualifying new — hold last lock
    return { id: lockedStation, dist: lockedDist, reason: 'holding' };
  }

  // ── Handle a raw position fix ───────────────────────────────────
  function onFix(pos){
    const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords;

    // Drop fixes that are too imprecise
    if(acc > MAX_ACCURACY){
      setStatus(`📡 Improving accuracy… (±${Math.round(acc)}m)`, 'var(--muted)');
      return;
    }

    // Add to rolling buffer
    buffer.push({ lat, lng, acc });
    if(buffer.length > BUFFER_SIZE) buffer.shift();

    // Wait until we have at least 2 readings before evaluating
    if(buffer.length < 2){
      setStatus(`📡 Collecting readings… (${buffer.length}/${BUFFER_SIZE})`, 'var(--muted)');
      return;
    }

    const smoothed = average(buffer);
    const result   = evaluate(smoothed.lat, smoothed.lng);
    if(!result) return;

    const s = METRO.STATIONS[result.id];
    if(!s) return;

    const distLabel = result.dist < 1000
      ? `${Math.round(result.dist)}m away`
      : `${(result.dist/1000).toFixed(1)}km away`;

    // Show status
    const locked = (result.reason !== 'far');
    const statusIcon = result.reason === 'switched' ? '🔄'
                     : result.reason === 'initial'  ? '📍'
                     : result.reason === 'far'       ? '📡'
                     : '📍';
    setStatus(`${statusIcon} ${s.n} · ${distLabel}`, locked ? 'var(--low)' : 'var(--muted)');

    // Fill target select if this is a one-shot request
    if(targetSelect && locked){
      const sel = document.getElementById(targetSelect);
      if(sel){ sel.value = result.id; sel.dispatchEvent(new Event('change')); }
      targetSelect = null; // clear after one fill
    }

    // Fire callback if registered
    if(onStation && locked) onStation(result.id, s.n, result.dist);

    updateBtn(false);
  }

  function onError(err){
    const msg = err.code === 1 ? 'Location access denied — please allow in browser settings.'
              : err.code === 2 ? 'Location unavailable. Try moving outdoors.'
              : 'Location request timed out.';
    setStatus(msg, 'var(--pk)');
    updateBtn(false);
  }

  // ── Public: one-shot request (fills a select, then watches) ────
  function requestLocation(selectId){
    if(!navigator.geolocation){
      setStatus('Geolocation not supported by your browser.', 'var(--pk)');
      return;
    }
    targetSelect  = selectId;
    buffer        = [];      // reset buffer for fresh reading
    lockedStation = null;    // allow re-lock
    updateBtn(true);
    startWatch();
  }

  // ── Public: start continuous watching ──────────────────────────
  function startWatch(){
    if(!navigator.geolocation) return;
    stopWatch();
    watchId = navigator.geolocation.watchPosition(
      onFix,
      onError,
      {
        enableHighAccuracy: true,
        timeout:            12000,
        maximumAge:         0,      // always fresh, never cached
      }
    );
  }

  // ── Public: stop watching ───────────────────────────────────────
  function stopWatch(){
    if(watchId !== null){
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  // ── Public: set a callback for station changes ──────────────────
  // callback(stationId, stationName, distanceMetres)
  function setOnStation(cb){ onStation = cb; }

  // ── Public: raw Haversine (used by route.js fare calc) ─────────
  function distanceM(lat1, lng1, lat2, lng2){
    return haversine(lat1, lng1, lat2, lng2);
  }

  // ── Public: nearest station (no lock, pure distance) ───────────
  // Used by route.js as a drop-in for GPS one-shots that don't need lock
  function nearestStation(lat, lng){
    return nearestRaw(lat, lng).id;
  }

  // ── UI helpers ─────────────────────────────────────────────────
  function setStatus(msg, color){
    const el = document.getElementById('geo-msg');
    if(!el) return;
    el.textContent = msg;
    el.style.color   = color || 'var(--text)';
    el.style.display = 'block';
  }

  function updateBtn(loading){
    const b = document.getElementById('geo-btn');
    if(!b) return;
    b.textContent  = loading ? '📡 Locating…' : '📍 Use My Location';
    b.disabled     = loading;
    b.style.opacity = loading ? '.6' : '1';
  }

  // ── Init — apply coordinate patches, then expose ───────────────
  function init(){
    if(!window.METRO?.GPS) return;
    Object.entries(COORD_PATCHES).forEach(([id, coord]) => {
      if(METRO.GPS[id]){
        console.log(`[GPS] Patching ${id}: ${JSON.stringify(METRO.GPS[id])} → ${JSON.stringify(coord)}`);
        METRO.GPS[id] = coord;
      }
    });
    console.log('[GPS] Coordinate patches applied. Total stations:', Object.keys(METRO.GPS).length);
  }

  // ── Debug helper (call from console) ───────────────────────────
  function debugNearest(lat, lng){
    const items = Object.entries(METRO.GPS || {}).map(([id, [slat, slng]]) => ({
      id, name: METRO.STATIONS[id]?.n || id,
      dist: Math.round(haversine(lat, lng, slat, slng))
    })).sort((a,b) => a.dist - b.dist).slice(0, 8);
    console.table(items);
    return items;
  }

  return { init, requestLocation, startWatch, stopWatch, setOnStation,
           nearestStation, distanceM, debugNearest,
           get locked(){ return lockedStation; },
           get buffer(){ return [...buffer]; } };
})();
