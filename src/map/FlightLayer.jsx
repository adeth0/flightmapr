import { useEffect, useRef, useCallback } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { flightService } from '../services/flightService';
import { notificationService } from '../services/notificationService';
import { getCachedEnrichment, enrichFlight } from '../services/flightEnrichmentService';

// Cap the tracking polyline at this many points. The flightService may
// accumulate longer histories for analytics, but the on-screen path is
// throttled here so that very long-haul flights don't gradually degrade
// paint performance on mobile (Leaflet rebuilds the SVG path on every
// setLatLngs). 100 samples ≈ 5-8 minutes of live track at typical poll
// intervals, which is the sweet spot for visibility + cheap repaint.
const TRAIL_MAX_POINTS = 100;

// Number of intermediate samples used when rasterising a great-circle
// path. 64 reads as a smooth curve at intercontinental distances and
// degrades gracefully (visual + perf) at short hops. Cheap — runs once
// per route refresh, not per tick.
const GREAT_CIRCLE_SAMPLES = 64;

// ─────────────────────────────────────────────────────────
//  Great-circle interpolator — slerp on a unit sphere.
//  Used to render the "exact" planned route from origin to
//  destination as a smooth curve (rather than a flat rhumb
//  line that misrepresents the path on a Mercator map).
//  Returns an array of [lat, lng] pairs from a→b inclusive.
// ─────────────────────────────────────────────────────────
function greatCirclePath(lat1, lng1, lat2, lng2, n = GREAT_CIRCLE_SAMPLES) {
  if (!Number.isFinite(lat1) || !Number.isFinite(lng1)) return [];
  if (!Number.isFinite(lat2) || !Number.isFinite(lng2)) return [];

  const toRad = Math.PI / 180;
  const φ1 = lat1 * toRad, λ1 = lng1 * toRad;
  const φ2 = lat2 * toRad, λ2 = lng2 * toRad;

  // Angular distance via haversine.
  const dφ = φ2 - φ1;
  const dλ = λ2 - λ1;
  const sin1 = Math.sin(dφ / 2);
  const sin2 = Math.sin(dλ / 2);
  const h = sin1 * sin1 + Math.cos(φ1) * Math.cos(φ2) * sin2 * sin2;
  const d = 2 * Math.asin(Math.min(1, Math.sqrt(h)));

  // Same point — nothing to interpolate.
  if (d < 1e-9) return [[lat1, lng1], [lat2, lng2]];

  const sind = Math.sin(d);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / sind;
    const B = Math.sin(f * d)       / sind;
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1)               + B * Math.sin(φ2);
    const φ = Math.atan2(z, Math.sqrt(x * x + y * y));
    const λ = Math.atan2(y, x);
    out.push([φ / toRad, λ / toRad]);
  }
  return out;
}

// Cheap "are these airport coords plausibly real" gate. enrichFlight
// stamps origin/destination as { code, lat:0, lng:0 } when the route
// isn't known yet — we don't want to paint a route to (0, 0) Atlantic.
function hasValidAirport(ap) {
  if (!ap) return false;
  if (!ap.code || ap.code === '----') return false;
  if (!Number.isFinite(ap.lat) || !Number.isFinite(ap.lng)) return false;
  if (ap.lat === 0 && ap.lng === 0) return false;
  return true;
}

// De-duped on-demand enrichment — when the user selects a flight whose
// adsbdb route hasn't been fetched yet, we kick one off here so the
// route polylines appear within ~1 second instead of waiting on the
// lazy background batch. Module-scoped so multiple components (this
// layer + BusyRoutesLayer) share a single in-flight set.
const _routeEnrichInFlight = new Set();
function ensureRouteEnrichment(callsign) {
  if (!callsign) return;
  if (_routeEnrichInFlight.has(callsign)) return;
  if (getCachedEnrichment(callsign)) return;
  _routeEnrichInFlight.add(callsign);
  enrichFlight(callsign)
    .catch(() => { /* swallow — resolveRoute will simply return null */ })
    .finally(() => _routeEnrichInFlight.delete(callsign));
}

// Resolve a flight's origin/destination airports. The live flight
// object holds default `{code:'----', lat:0, lng:0}` placeholders
// until adsbdb enrichment lands; the *real* airport metadata only
// ever lives in flightEnrichmentService's cache, keyed by callsign.
// This helper picks the most-complete pair available so the route
// polylines stay live as soon as enrichment resolves, regardless of
// whether anyone has opened the sidebar yet. If the cache is empty
// for the callsign we proactively trigger an enrichment fetch.
function resolveRoute(flight) {
  if (!flight) return { origin: null, destination: null };
  const en = flight.callsign ? getCachedEnrichment(flight.callsign) : null;
  const origin      = hasValidAirport(en?.origin)      ? en.origin
                    : hasValidAirport(flight.origin)   ? flight.origin
                    : null;
  const destination = hasValidAirport(en?.destination) ? en.destination
                    : hasValidAirport(flight.destination) ? flight.destination
                    : null;
  // Trigger an on-demand enrichment if either endpoint is still
  // unresolved AND we haven't already kicked one off for this callsign.
  if ((!origin || !destination) && flight.callsign) {
    ensureRouteEnrichment(flight.callsign);
  }
  return { origin, destination };
}

function classifyAircraft(flight) {
  const text = `${flight?.aircraft ?? ''} ${flight?.category ?? ''}`.toLowerCase();

  if (/(heli|helicopter|rotor|robinson|bell\s?\d|sikorsky|airbus h|ec\d{2,3}|aw\d{2,3}|uh-)/.test(text)) {
    return 'helicopter';
  }

  if (/(cessna|piper|beech|cirrus|bonanza|king air|turboprop|pilatus|pc-12|tbm|sr22|diamond|mooney|light|prop|learjet|citation|phenom)/.test(text)) {
    return 'small';
  }

  return 'commercial';
}

// ─────────────────────────────────────────────────────────
//  Selection no longer forces a white body / mint accent — the
//  old override made selected aircraft blend into the map tiles.
//  The base palette is now preserved on selection; the premium
//  silver halo, pulsing ring and scale-up are layered on in CSS
//  via `.aircraft-icon-shell.is-selected` + `.aircraft-selected-ring`.
// ─────────────────────────────────────────────────────────
function getIconState(selected, hovered, previewed) {
  if (previewed) {
    return {
      body: '#fef3c7',
      accent: '#fde68a',
      outline: 'rgba(251, 191, 36, 0.95)',
      glow: 'drop-shadow(0 0 10px rgba(251,191,36,0.9)) drop-shadow(0 0 3px rgba(15,23,42,0.85))',
      size: 30,
    };
  }

  if (hovered) {
    return {
      body: '#fde68a',
      accent: '#f59e0b',
      outline: 'rgba(251, 191, 36, 0.85)',
      glow: 'drop-shadow(0 0 8px rgba(251,191,36,0.75)) drop-shadow(0 0 3px rgba(15,23,42,0.8))',
      size: 26,
    };
  }

  // Default (and selected) — yellow/amber with dark outline so the
  // aircraft stays visible against light *and* dark map tiles. When
  // `selected` is true we DON'T change colours; the CSS class adds
  // a silver glow + subtle ring pulse around the same glyph.
  return {
    body: '#f8d64e',
    accent: '#f59e0b',
    outline: 'rgba(15, 23, 42, 0.92)',
    glow: selected
      ? 'drop-shadow(0 0 4px rgba(15,23,42,0.9)) drop-shadow(0 0 8px rgba(251,191,36,0.55))'
      : 'drop-shadow(0 0 4px rgba(15,23,42,0.9)) drop-shadow(0 0 6px rgba(251,191,36,0.38))',
    size: 26,
  };
}

// ─────────────────────────────────────────────────────────
//  Aircraft glyphs — top-down silhouettes with anatomy that
//  reads at marker size on both light + dark tiles. Each type
//  gets its own SVG geometry; helicopters and small props add
//  a `.aircraft-rotor` / `.aircraft-prop` group whose CSS
//  animation spins around the rotor hub. Heading rotation is
//  applied by the parent `.aircraft-icon-rotator` div, so the
//  spin and heading compose naturally without re-rendering
//  the SVG every frame.
// ─────────────────────────────────────────────────────────
function renderAircraftSvg(type, palette, size) {
  const sw = 0.75;            // hairline outline weight
  const swMain = 1.0;         // main fuselage outline weight
  const o = palette.outline;
  const b = palette.body;
  const a = palette.accent;
  const glow = palette.glow;

  if (type === 'helicopter') {
    // Top-down helicopter: cabin + tail boom + tail fin + skids
    // + main rotor (4 blades + soft motion-blur disc) + tail rotor.
    return (
      `<svg width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="filter:${glow};overflow:visible;">` +
      `<g fill="none" stroke-linecap="round" stroke-linejoin="round">` +
      // Skids (under body) — drawn first so they sit beneath the cabin
      `<line x1="8.5" y1="13" x2="8.5" y2="22" stroke="${o}" stroke-width="${sw}" opacity="0.65"/>` +
      `<line x1="23.5" y1="13" x2="23.5" y2="22" stroke="${o}" stroke-width="${sw}" opacity="0.65"/>` +
      `<line x1="11" y1="14" x2="9" y2="14" stroke="${o}" stroke-width="${sw}" opacity="0.55"/>` +
      `<line x1="11" y1="20" x2="9" y2="20" stroke="${o}" stroke-width="${sw}" opacity="0.55"/>` +
      `<line x1="21" y1="14" x2="23" y2="14" stroke="${o}" stroke-width="${sw}" opacity="0.55"/>` +
      `<line x1="21" y1="20" x2="23" y2="20" stroke="${o}" stroke-width="${sw}" opacity="0.55"/>` +
      // Tail boom (rear)
      `<path d="M14.5 19 L14.8 27 L17.2 27 L17.5 19 Z" fill="${b}" stroke="${o}" stroke-width="${sw}"/>` +
      // Vertical stabilizer / fin at tail
      `<path d="M14.4 26.5 L13 30 L19 30 L17.6 26.5 Z" fill="${a}" stroke="${o}" stroke-width="${sw}" opacity="0.95"/>` +
      // Tail rotor hub + fast-spinning blades
      `<circle cx="16" cy="29.4" r="0.8" fill="${o}"/>` +
      `<g class="aircraft-tail-rotor" style="transform-box:fill-box;transform-origin:center;">` +
        `<line x1="13.6" y1="29.4" x2="18.4" y2="29.4" stroke="${o}" stroke-width="${sw}" opacity="0.85"/>` +
      `</g>` +
      // Cabin / fuselage — rounded teardrop, narrower at the front
      `<path d="M16 6 C12.4 6 10.5 9.5 10.5 13.5 C10.5 17.5 12.5 19.5 16 19.5 C19.5 19.5 21.5 17.5 21.5 13.5 C21.5 9.5 19.6 6 16 6 Z" fill="${b}" stroke="${o}" stroke-width="${swMain}"/>` +
      // Cockpit / windshield highlight (front)
      `<path d="M13.2 8 Q16 6.6 18.8 8 Q18 10.5 16 11 Q14 10.5 13.2 8 Z" fill="${a}" opacity="0.7"/>` +
      // Door seam detail
      `<line x1="11.7" y1="14.5" x2="20.3" y2="14.5" stroke="${o}" stroke-width="${sw}" opacity="0.45"/>` +
      // Rotor hub
      `<circle cx="16" cy="13" r="1.2" fill="${o}"/>` +
      // Main rotor — 4 blades + soft disc for motion blur
      `<g class="aircraft-rotor" style="transform-box:fill-box;transform-origin:center;">` +
        `<circle cx="16" cy="13" r="13" fill="${o}" opacity="0.05"/>` +
        `<line x1="2.5" y1="13" x2="29.5" y2="13" stroke="${o}" stroke-width="${sw + 0.1}" opacity="0.85"/>` +
        `<line x1="16" y1="-0.5" x2="16" y2="26.5" stroke="${o}" stroke-width="${sw + 0.1}" opacity="0.85"/>` +
        `<line x1="6" y1="3" x2="26" y2="23" stroke="${o}" stroke-width="${sw - 0.1}" opacity="0.55"/>` +
        `<line x1="6" y1="23" x2="26" y2="3" stroke="${o}" stroke-width="${sw - 0.1}" opacity="0.55"/>` +
      `</g>` +
      `</g></svg>`
    );
  }

  if (type === 'small') {
    // Top-down Cessna-style: high single wing, fuselage, tail
    // empennage, and a fast-spinning two-blade propeller at the
    // nose. Slightly wider wings than commercial since light
    // aircraft visually have proportionally bigger wing span.
    return (
      `<svg width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="filter:${glow};overflow:visible;">` +
      `<g fill="none" stroke-linecap="round" stroke-linejoin="round">` +
      // Horizontal stabilizer (rear empennage) — drawn under fuselage
      `<path d="M10 25 L10 27 L22 27 L22 25 L19 24.5 L13 24.5 Z" fill="${b}" stroke="${o}" stroke-width="${sw}"/>` +
      // Vertical fin (top-down: tiny rectangle on tail)
      `<path d="M15.2 26 L15.2 28.5 L16.8 28.5 L16.8 26 Z" fill="${a}" stroke="${o}" stroke-width="${sw}"/>` +
      // High wings — single straight span across, slightly wider than commercial
      `<path d="M2 12 Q1.5 11 3 10.6 L29 10.6 Q30.5 11 30 12 L29 13.6 Q28 14 16 14 Q4 14 3 13.6 Z" fill="${b}" stroke="${o}" stroke-width="${sw}"/>` +
      // Wing struts (visual cue this is a high-wing prop)
      `<line x1="8" y1="13.5" x2="13.5" y2="17" stroke="${o}" stroke-width="${sw - 0.1}" opacity="0.55"/>` +
      `<line x1="24" y1="13.5" x2="18.5" y2="17" stroke="${o}" stroke-width="${sw - 0.1}" opacity="0.55"/>` +
      // Fuselage
      `<path d="M16 6.5 C14.6 6.5 13.5 7.4 13.5 9 L13.5 23 L14.2 25 L17.8 25 L18.5 23 L18.5 9 C18.5 7.4 17.4 6.5 16 6.5 Z" fill="${b}" stroke="${o}" stroke-width="${swMain}"/>` +
      // Cockpit windshield
      `<ellipse cx="16" cy="9.5" rx="1.6" ry="1.4" fill="${a}" opacity="0.7"/>` +
      // Spinner cone at nose
      `<circle cx="16" cy="6.2" r="1.0" fill="${a}" stroke="${o}" stroke-width="${sw - 0.1}"/>` +
      // Animated propeller — two-blade horizontal, spinning fast
      `<g class="aircraft-prop" style="transform-box:fill-box;transform-origin:center;">` +
        `<circle cx="16" cy="6.2" r="5.5" fill="${o}" opacity="0.05"/>` +
        `<line x1="10.5" y1="6.2" x2="21.5" y2="6.2" stroke="${o}" stroke-width="${sw + 0.1}" opacity="0.9"/>` +
        `<line x1="16" y1="1" x2="16" y2="11.4" stroke="${o}" stroke-width="${sw - 0.2}" opacity="0.45"/>` +
      `</g>` +
      `</g></svg>`
    );
  }

  // Commercial airliner — top-down with swept wings, two engines,
  // tail empennage, and cockpit windshield. Cleaner silhouette
  // than small/light aircraft, no animated prop.
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="filter:${glow};overflow:visible;">` +
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    // Swept-back wings (delta-ish)
    `<path d="M16 14 L2.5 22 L3.5 23.5 L16 18 L28.5 23.5 L29.5 22 Z" fill="${b}" stroke="${o}" stroke-width="${sw}"/>` +
    // Engine pods on wings
    `<ellipse cx="9" cy="19.5" rx="1.5" ry="2.4" fill="${o}" opacity="0.85"/>` +
    `<ellipse cx="23" cy="19.5" rx="1.5" ry="2.4" fill="${o}" opacity="0.85"/>` +
    `<ellipse cx="9" cy="19.5" rx="0.7" ry="1.4" fill="${a}" opacity="0.55"/>` +
    `<ellipse cx="23" cy="19.5" rx="0.7" ry="1.4" fill="${a}" opacity="0.55"/>` +
    // Fuselage — long tapered tube from nose to tail
    `<path d="M16 3 C14.6 3 13.7 4.2 13.4 6.5 L12.9 24.5 L13.7 27 L18.3 27 L19.1 24.5 L18.6 6.5 C18.3 4.2 17.4 3 16 3 Z" fill="${b}" stroke="${o}" stroke-width="${swMain}"/>` +
    // Cockpit windshield
    `<path d="M14.4 5 Q16 3.6 17.6 5 Q17.2 7.5 16 8 Q14.8 7.5 14.4 5 Z" fill="${a}" opacity="0.7"/>` +
    // Horizontal stabilizer (tail wings)
    `<path d="M16 25 L9.5 28.5 L10.7 29 L16 27 L21.3 29 L22.5 28.5 Z" fill="${b}" stroke="${o}" stroke-width="${sw}"/>` +
    // Vertical fin (top-down: small rectangle along centreline)
    `<path d="M15.3 25 L15.5 28.7 L16.5 28.7 L16.7 25 Z" fill="${a}" stroke="${o}" stroke-width="${sw}"/>` +
    // Wing root highlight (visual interest)
    `<line x1="13.5" y1="16" x2="18.5" y2="16" stroke="${a}" stroke-width="${sw}" opacity="0.7"/>` +
    `</g></svg>`
  );
}

function createIcon(flight, selected = false, hovered = false, previewed = false, tracked = false) {
  const type = classifyAircraft(flight);
  const palette = getIconState(selected, hovered, previewed);
  const size = palette.size + (type === 'helicopter' ? 2 : 0);

  const ring = (tracked && !selected)
    ? '<div class="aircraft-track-ring"></div>'
    : '';

  // Premium silver halo + pulsing ring for the selected aircraft.
  // Layered as DOM overlays inside the shell so we can animate them
  // with plain CSS without re-rendering the SVG glyph every frame.
  const selectedRing = selected
    ? '<div class="aircraft-selected-ring" aria-hidden="true"></div>' +
      '<div class="aircraft-selected-halo" aria-hidden="true"></div>'
    : '';

  const shellClasses = [
    'aircraft-icon-shell',
    `aircraft-icon-${type}`,
    selected ? 'is-selected' : '',
  ].filter(Boolean).join(' ');

  return L.divIcon({
    html:
      `<div class="${shellClasses}" style="width:${size}px;height:${size}px;">` +
      ring +
      selectedRing +
      `<div data-plane-rot class="aircraft-icon-rotator" style="transform:rotate(${flight.heading}deg);">` +
      renderAircraftSvg(type, palette, size) +
      '</div></div>',
    className: 'aircraft-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 4)],
  });
}

function miniPopupContent(f) {
  const origin = f.origin?.code && f.origin.code !== '----' ? f.origin.code : '---';
  const dest = f.destination?.code && f.destination.code !== '----' ? f.destination.code : '---';
  const altStr = f.altitude ? `${f.altitude.toLocaleString()} ft � ${f.speed} kts` : '';

  return (
    `<div style="font-family:'Inter',system-ui,sans-serif;min-width:155px;padding:2px 0;">` +
    `<div style="font-size:14px;font-weight:700;color:#38BDF8;margin-bottom:5px;letter-spacing:-0.3px;">${f.callsign}</div>` +
    `<div style="font-size:12px;color:#fff;display:flex;align-items:center;gap:8px;font-weight:600;">` +
    `<span>${origin}</span><span style="color:#38BDF8;font-size:13px;">?</span><span>${dest}</span>` +
    `</div>` +
    (altStr ? `<div style="font-size:10px;color:rgba(255,255,255,0.45);margin-top:3px;">${altStr}</div>` : '') +
    `<button data-action="select" style="margin-top:8px;width:100%;padding:6px 0;` +
    `background:rgba(255, 255, 255,0.13);border:1px solid rgba(255, 255, 255,0.35);` +
    `border-radius:7px;color:#38BDF8;font-size:11px;font-weight:600;cursor:pointer;` +
    `font-family:'Inter',sans-serif;-webkit-tap-highlight-color:transparent;">` +
    `View Full Details ?</button></div>`
  );
}

function tooltipContent(f) {
  return (
    `<div style="font-family:'Inter',sans-serif;font-size:12px;color:#fff;min-width:130px;">` +
    `<div style="font-weight:700;color:#38BDF8;font-size:13px;margin-bottom:2px;">${f.callsign}</div>` +
    `<div style="color:rgba(255,255,255,0.55);font-size:10px;">${f.airline}</div>` +
    `</div>`
  );
}

export function FlightLayer({ selectedFlightId, followFlightId, onFlightSelect }) {
  // The "flight of interest" for the route/trail polylines is the
  // selected one if it exists, otherwise the followed one. This lets
  // the "Flight Route" button close the card while keeping the route
  // visible — the user follows the plane along its actual path.
  const routeFlightId = selectedFlightId ?? followFlightId ?? null;
  const map = useMap();
  const markersRef = useRef(new Map());
  const trailRef = useRef(null);
  // Forward-leg polyline: aircraft current position → destination, drawn
  // as a great-circle dashed line so the user can see the exact remaining
  // route end-to-end.
  const forwardRef = useRef(null);
  // Actual flown route: origin → current aircraft position, drawn as a
  // SOLID azure great-circle. This is the "Flight Route" the user sees
  // on the detail card — visualises where the plane has come from since
  // departure. Updated each tick so it tracks the aircraft as it moves.
  const flownRef = useRef(null);
  const selectedIdRef = useRef(selectedFlightId);
  // Separate ref for "the flight whose routes we should be drawing".
  // Defaults to selectedFlightId, but falls back to followFlightId so
  // closing the card while following keeps the route visible.
  const routeIdRef = useRef(routeFlightId);
  const onSelectRef = useRef(onFlightSelect);
  const pendingPreviewRef = useRef(null);
  const trackedIdsRef = useRef(new Set());
  const lastPaneTouchRef = useRef(0);

  useEffect(() => { selectedIdRef.current = selectedFlightId; }, [selectedFlightId]);
  useEffect(() => { routeIdRef.current    = routeFlightId;    }, [routeFlightId]);
  useEffect(() => { onSelectRef.current = onFlightSelect; }, [onFlightSelect]);

  useEffect(() => {
    return notificationService.subscribeToChanges((list) => {
      const newSet = new Set(list.map((t) => t.id));
      trackedIdsRef.current = newSet;
      markersRef.current.forEach((entry, id) => {
        const wasTracked = entry.tracked ?? false;
        const isNowTracked = newSet.has(id);
        if (wasTracked !== isNowTracked) {
          entry.tracked = isNowTracked;
          entry.rotEl = null;
          const isSel = selectedIdRef.current === id;
          entry.marker.setIcon(
            createIcon(entry.flight, isSel, false, entry.previewed ?? false, isNowTracked),
          );
        }
      });
    });
  }, []);

  useEffect(() => {
    if (selectedFlightId && pendingPreviewRef.current?.id === selectedFlightId) {
      safeRemovePopup(pendingPreviewRef.current.popup);
      pendingPreviewRef.current = null;
    }
  }, [selectedFlightId]);

  // ── Flight Route visualisation — three layered polylines ─
  // Drawn behind the selected aircraft, in z-order:
  //
  //   1. flownRef   — SOLID azure great-circle ORIGIN → CURRENT
  //                   position. This is the "Flight Route" the
  //                   user sees on the detail card: where the
  //                   plane has come from since departure.
  //   2. trailRef   — solid silver / white precision trail of
  //                   the last TRAIL_MAX_POINTS GPS samples,
  //                   sitting on top of flownRef so the user
  //                   sees a high-resolution tail near the
  //                   aircraft.
  //   3. forwardRef — dashed azure great-circle from CURRENT
  //                   position to DESTINATION (remaining route)
  //                   with marching-ants animation.
  //
  // Both great-circle polylines use spherical slerp so inter-
  // continental routes bow correctly on Mercator. The trail is
  // capped + smoothed for cheap repaints on mobile.
  useEffect(() => {
    // Tear down any previous polylines first so a selection
    // change never leaves stale geometry on screen.
    if (trailRef.current)   { trailRef.current.remove();   trailRef.current = null; }
    if (forwardRef.current) { forwardRef.current.remove(); forwardRef.current = null; }
    if (flownRef.current)   { flownRef.current.remove();   flownRef.current = null; }

    if (!routeFlightId) return;
    const flight = flightService.getFlight(routeFlightId);
    if (!flight) return;

    const { origin: o, destination: d } = resolveRoute(flight);

    // 1. Actual flown route — ORIGIN → CURRENT position. Solid
    //    azure great-circle. Endpoints come from the enrichment
    //    cache (real airport lat/lng) rather than flight.origin
    //    which carries a 0,0 placeholder until adsbdb resolves.
    if (o) {
      const flown = greatCirclePath(o.lat, o.lng, flight.lat, flight.lng);
      if (flown.length > 1) {
        flownRef.current = L.polyline(flown, {
          color: '#38BDF8',
          weight: 3.5,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
          smoothFactor: 1.0,
          className: 'flight-flown-path',
        }).addTo(map);
      }
    }

    // 2. High-precision live trail — last N ADS-B samples.
    const trailPts = (flight.trail || [])
      .slice(-TRAIL_MAX_POINTS)
      .map((p) => [p.lat, p.lng]);
    trailRef.current = L.polyline(trailPts, {
      color: 'rgba(255, 255, 255, 0.55)',
      weight: 2.6,
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false,
      smoothFactor: 1.2,
      className: 'flight-trail-path',
    }).addTo(map);

    // 3. Forward leg — current position → destination great-circle,
    //    dashed azure with marching-ants animation in CSS.
    if (d) {
      const fwd = greatCirclePath(flight.lat, flight.lng, d.lat, d.lng);
      if (fwd.length > 1) {
        forwardRef.current = L.polyline(fwd, {
          color: '#38BDF8',
          weight: 3,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
          dashArray: '8 8',
          smoothFactor: 1.0,
          className: 'flight-forward-path',
        }).addTo(map);
      }
    }
  }, [routeFlightId, map]);

  function safeRemovePopup(popup) {
    try { if (popup) popup.remove(); } catch { /* ignore */ }
  }

  const clearMarkerPreview = useCallback((flightId) => {
    const entry = markersRef.current.get(flightId);
    if (entry?.previewed) {
      entry.previewed = false;
      entry.rotEl = null;
      const isTracked = trackedIdsRef.current.has(flightId);
      entry.marker.setIcon(createIcon(entry.flight, false, false, false, isTracked));
      entry.marker.setZIndexOffset(0);
    }
  }, []);

  const dismissPreview = useCallback(() => {
    if (!pendingPreviewRef.current) return;
    const { id, popup } = pendingPreviewRef.current;
    safeRemovePopup(popup);
    clearMarkerPreview(id);
    pendingPreviewRef.current = null;
  }, [clearMarkerPreview]);

  const openMiniPopup = useCallback((flight) => {
    if (pendingPreviewRef.current) {
      safeRemovePopup(pendingPreviewRef.current.popup);
      clearMarkerPreview(pendingPreviewRef.current.id);
    }

    const popup = L.popup({
      closeButton: true,
      autoClose: false,
      closeOnClick: false,
      className: 'flight-mini-popup',
      offset: [0, -20],
      maxWidth: 220,
    })
      .setLatLng([flight.lat, flight.lng])
      .setContent(miniPopupContent(flight))
      .openOn(map);

    const setupBtn = () => {
      const el = popup.getElement?.()?.querySelector('[data-action="select"]');
      if (!el) return;
      const activate = (e) => {
        e.stopPropagation();
        e.preventDefault();
        safeRemovePopup(popup);
        clearMarkerPreview(flight.id);
        pendingPreviewRef.current = null;
        onSelectRef.current(flight);
      };
      el.addEventListener('click', activate, { passive: false });
      el.addEventListener('touchend', activate, { passive: false });
    };
    setTimeout(setupBtn, 60);

    const entry = markersRef.current.get(flight.id);
    if (entry) {
      entry.previewed = true;
      entry.rotEl = null;
      const isTracked = trackedIdsRef.current.has(flight.id);
      entry.marker.setIcon(createIcon(entry.flight, false, false, true, isTracked));
      entry.marker.setZIndexOffset(500);
    }

    pendingPreviewRef.current = { id: flight.id, popup };
  }, [map, clearMarkerPreview]);

  const addMarker = useCallback((flight) => {
    const markers = markersRef.current;
    if (markers.has(flight.id)) return;

    const isSelected = selectedIdRef.current === flight.id;
    const isTracked = trackedIdsRef.current.has(flight.id);
    const marker = L.marker([flight.lat, flight.lng], {
      icon: createIcon(flight, isSelected, false, false, isTracked),
      zIndexOffset: isSelected ? 1000 : 0,
    }).addTo(map);

    marker.bindTooltip(tooltipContent(flight), {
      permanent: false, direction: 'top', offset: [0, -4], opacity: 1, className: '',
    });
    marker.on('tooltipopen', () => {
      const entry = markers.get(flight.id);
      if (entry) marker.setTooltipContent(tooltipContent(entry.flight));
    });

    marker.on('click', () => {
      if (Date.now() - lastPaneTouchRef.current < 600) return;
      onSelectRef.current(flight);
    });

    marker.on('mouseover', () => {
      const entry = markers.get(flight.id);
      if (entry && selectedIdRef.current !== flight.id && !entry.previewed) {
        entry.rotEl = null;
        const isNowTracked = trackedIdsRef.current.has(flight.id);
        marker.setIcon(createIcon(entry.flight, false, true, false, isNowTracked));
      }
    });
    marker.on('mouseout', () => {
      const entry = markers.get(flight.id);
      if (entry && selectedIdRef.current !== flight.id && !entry.previewed) {
        entry.rotEl = null;
        const isNowTracked = trackedIdsRef.current.has(flight.id);
        marker.setIcon(createIcon(entry.flight, false, false, false, isNowTracked));
      }
    });

    markers.set(flight.id, {
      marker,
      flight,
      rotEl: null,
      lastSel: isSelected,
      previewed: false,
      tracked: isTracked,
    });
  }, [map]);

  const removeMarker = useCallback((id) => {
    const entry = markersRef.current.get(id);
    if (entry) { entry.marker.remove(); markersRef.current.delete(id); }
    if (pendingPreviewRef.current?.id === id) {
      safeRemovePopup(pendingPreviewRef.current.popup);
      pendingPreviewRef.current = null;
    }
  }, []);

  const updateDensity = useCallback(() => {
    const zoom = map.getZoom();
    let idx = 0;
    markersRef.current.forEach((entry, id) => {
      idx += 1;
      if (id === selectedIdRef.current) { entry.marker.setOpacity(1); return; }
      let visible = true;
      if (zoom < 3) visible = idx % 4 === 0;
      else if (zoom < 5) visible = idx % 2 === 0;
      entry.marker.setOpacity(visible ? 1 : 0);
    });
  }, [map]);

  useEffect(() => {
    map.on('zoomend', updateDensity);

    const markerPane = map.getPanes()?.markerPane;
    let startTs = 0;
    let startX = 0;
    let startY = 0;

    const onPaneTouchStart = (e) => {
      if (!e.target.closest?.('.aircraft-marker')) return;
      if (e.touches.length !== 1) return;
      startTs = Date.now();
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      e.stopPropagation();
    };

    const onPaneTouchEnd = (e) => {
      const t = e.changedTouches?.[0];
      if (!t) return;
      const markerEl = e.target.closest?.('.aircraft-marker');
      if (!markerEl) return;
      const dt = Date.now() - startTs;
      const dx = Math.abs(t.clientX - startX);
      const dy = Math.abs(t.clientY - startY);
      if (dt > 500 || dx > 20 || dy > 20) return;
      e.stopPropagation();
      e.preventDefault();
      let tappedFlight = null;
      markersRef.current.forEach((entry) => {
        if (entry.marker.getElement() === markerEl) tappedFlight = entry.flight;
      });
      if (tappedFlight) {
        lastPaneTouchRef.current = Date.now();
        onSelectRef.current(tappedFlight);
      }
    };

    if (markerPane) {
      markerPane.addEventListener('touchstart', onPaneTouchStart, { passive: false });
      markerPane.addEventListener('touchend', onPaneTouchEnd, { passive: false });
    }

    map.on('click', (e) => {
      if (e.originalEvent?.target?.closest?.('.aircraft-marker')) return;
      dismissPreview();
    });

    const unsub = flightService.subscribe((flights) => {
      const markers = markersRef.current;
      const selId   = selectedIdRef.current;
      const routeId = routeIdRef.current;
      const incomingIds = new Set(flights.map((f) => f.id));
      markers.forEach((_, id) => { if (!incomingIds.has(id)) removeMarker(id); });

      flights.forEach((flight) => {
        if (!markers.has(flight.id)) addMarker(flight);

        const entry = markers.get(flight.id);
        if (!entry) return;

        entry.flight = flight;
        entry.marker.setLatLng([flight.lat, flight.lng]);

        const isSel   = selId   === flight.id;
        // "Is this the flight whose routes we draw?" — selection OR
        // follow. Used to drive the trail + flown + forward polyline
        // updates; the visual "selected" highlight stays gated on
        // selectedIdRef so closing the card removes the halo.
        const isRoute = routeId === flight.id;

        if (!entry.rotEl) {
          const el = entry.marker.getElement();
          if (el) entry.rotEl = el.querySelector('[data-plane-rot]');
        }
        if (entry.rotEl) entry.rotEl.style.transform = `rotate(${flight.heading}deg)`;

        if (isSel !== entry.lastSel) {
          entry.lastSel = isSel;
          entry.rotEl = null;
          entry.previewed = false;
          const isTracked = trackedIdsRef.current.has(flight.id);
          entry.marker.setIcon(createIcon(flight, isSel, false, false, isTracked));
          entry.marker.setZIndexOffset(isSel ? 1000 : 0);
        }

        if (isRoute && trailRef.current) {
          // Incremental update — Leaflet diffs the path internally so
          // this is cheap enough to fire every tick. Still cap it here
          // as a belt-and-braces guard against a runaway trail.
          const trailPts = (flight.trail || [])
            .slice(-TRAIL_MAX_POINTS)
            .map((p) => [p.lat, p.lng]);
          trailRef.current.setLatLngs(trailPts);
        }

        // Forward leg + flown-route lazy creation/update. Enrichment
        // is async, so when a flight is first selected we may not
        // yet have origin coords. Each tick we re-resolve the route
        // and either update the existing polylines or create them on
        // first availability — this is what makes the Flight Route
        // "appear" within ~1s of selection (we eagerly trigger
        // enrichFlight() inside resolveRoute) without blocking the
        // selection itself.
        if (isRoute) {
          const { origin: liveOrigin, destination: liveDest } = resolveRoute(flight);

          // Actual flown route — origin → CURRENT position. Recomputed
          // each tick so it grows with the aircraft.
          if (liveOrigin) {
            const flown = greatCirclePath(
              liveOrigin.lat, liveOrigin.lng,
              flight.lat, flight.lng,
            );
            if (flown.length > 1) {
              if (flownRef.current) {
                flownRef.current.setLatLngs(flown);
              } else {
                flownRef.current = L.polyline(flown, {
                  color: '#38BDF8',
                  weight: 3.5,
                  opacity: 0.95,
                  lineCap: 'round',
                  lineJoin: 'round',
                  interactive: false,
                  smoothFactor: 1.0,
                  className: 'flight-flown-path',
                }).addTo(map);
              }
            }
          }

          // Forward leg — CURRENT position → destination.
          if (liveDest) {
            const fwd = greatCirclePath(
              flight.lat, flight.lng,
              liveDest.lat, liveDest.lng,
            );
            if (fwd.length > 1) {
              if (forwardRef.current) {
                forwardRef.current.setLatLngs(fwd);
              } else {
                forwardRef.current = L.polyline(fwd, {
                  color: '#38BDF8',
                  weight: 3,
                  opacity: 0.95,
                  lineCap: 'round',
                  lineJoin: 'round',
                  interactive: false,
                  dashArray: '8 8',
                  smoothFactor: 1.0,
                  className: 'flight-forward-path',
                }).addTo(map);
              }
            }
          }
        }

        if (pendingPreviewRef.current?.id === flight.id) {
          try { pendingPreviewRef.current.popup.setLatLng([flight.lat, flight.lng]); } catch { /* ignore */ }
        }
      });
    });

    return () => {
      unsub();
      map.off('zoomend', updateDensity);
      map.off('click');
      if (markerPane) {
        markerPane.removeEventListener('touchstart', onPaneTouchStart);
        markerPane.removeEventListener('touchend', onPaneTouchEnd);
      }
      markersRef.current.forEach(({ marker }) => marker.remove());
      markersRef.current.clear();
      if (trailRef.current)   { trailRef.current.remove();   trailRef.current = null; }
      if (forwardRef.current) { forwardRef.current.remove(); forwardRef.current = null; }
      if (flownRef.current)   { flownRef.current.remove();   flownRef.current = null; }
      safeRemovePopup(pendingPreviewRef.current?.popup);
      pendingPreviewRef.current = null;
    };
  }, [map, addMarker, removeMarker, updateDensity, dismissPreview]);

  return null;
}
