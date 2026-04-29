// ─────────────────────────────────────────────────────────
//  BusyRoutesLayer
//  Renders great-circle route arcs in azure blue for ONLY
//  the aircraft the user actually cares about right now:
//    • the currently selected aircraft, and
//    • every aircraft they've tagged in the Alerts panel
//      (via notificationService.trackFlight).
//
//  The legacy "top 15 busiest routes globally" behaviour was
//  too noisy — it drew faint silver arcs all over the map and
//  blended into the basemap. By scoping to selected + tracked
//  flights (and re-rendering when either set changes), the
//  arcs read as actionable, route-specific guidance.
//
//  Updates are cheap: the route geometry only changes when
//  • the selection or tracked set changes,
//  • a flight just had its enrichment (origin/destination)
//    fetched and we now know lat/lng for the route endpoints.
//  We therefore subscribe to BOTH flightService and
//  notificationService and rebuild the arc set on either tick,
//  but throttle internal redraws to RENDER_THROTTLE_MS so
//  fast-moving live data doesn't churn Leaflet's SVG paths.
// ─────────────────────────────────────────────────────────

import { useEffect, useRef }    from 'react';
import { useMap }               from 'react-leaflet';
import L                        from 'leaflet';
import { flightService }        from '../services/flightService';
import { notificationService }  from '../services/notificationService';
import { getCachedEnrichment }  from '../services/flightEnrichmentService';

const D2R       = Math.PI / 180;
const R2D       = 180 / Math.PI;
const ARC_STEPS = 64;            // smoother arcs since there are now far fewer
const RENDER_THROTTLE_MS = 1_500;

// ── Spherical linear interpolation (great-circle arc) ────
// Returns N+1 points along the great-circle between two
// (lat, lng) endpoints. Bows correctly on Mercator so a
// transatlantic route looks like a real flight path, not a
// flat rhumb line.
function buildArc(olat, olng, dlat, dlng) {
  const φ1 = olat * D2R, λ1 = olng * D2R;
  const φ2 = dlat * D2R, λ2 = dlng * D2R;

  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((φ2 - φ1) / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2
  ));

  if (d < 0.005) return [[olat, olng], [dlat, dlng]]; // airports too close

  const sind = Math.sin(d);
  const pts = [];
  for (let i = 0; i <= ARC_STEPS; i++) {
    const t = i / ARC_STEPS;
    const A = Math.sin((1 - t) * d) / sind;
    const B = Math.sin(t * d)       / sind;
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1)                 + B * Math.sin(φ2);
    pts.push([
      Math.atan2(z, Math.sqrt(x * x + y * y)) * R2D,
      Math.atan2(y, x) * R2D,
    ]);
  }
  return pts;
}

// Pull origin/destination + a stable route key off whatever
// shape we have (live flight from flightService OR a tracked
// snapshot from notificationService). Returns null when the
// endpoints aren't usable yet.
function extractRoute(source) {
  const o = source?.origin;
  const d = source?.destination;
  if (!o || !d) return null;
  if (!o.code || o.code === '----') return null;
  if (!d.code || d.code === '----') return null;
  if (o.code === d.code) return null;
  if (!Number.isFinite(o.lat) || !Number.isFinite(o.lng)) return null;
  if (!Number.isFinite(d.lat) || !Number.isFinite(d.lng)) return null;
  if ((o.lat === 0 && o.lng === 0) || (d.lat === 0 && d.lng === 0)) return null;
  return {
    key: `${o.code}→${d.code}`,
    origin: o,
    destination: d,
  };
}

// ── Component ─────────────────────────────────────────────
export function BusyRoutesLayer({ enabled, selectedFlightId }) {
  const map         = useMap();
  const linesRef    = useRef(new Map()); // key → Leaflet polyline
  const trackedRef  = useRef([]);         // last tracked-list snapshot
  const flightsRef  = useRef([]);         // last flightService snapshot
  const selIdRef    = useRef(selectedFlightId);
  const renderTimer = useRef(null);
  // Holds the latest render() closure so the selection-change effect
  // below can repaint immediately without waiting on a flightService
  // tick or duplicating the subscribe logic.
  const renderRef   = useRef(() => {});

  useEffect(() => {
    // Tear down any previous arcs / subscriptions on every enabled toggle.
    function teardown() {
      linesRef.current.forEach((l) => l.remove());
      linesRef.current.clear();
      if (renderTimer.current) {
        clearTimeout(renderTimer.current);
        renderTimer.current = null;
      }
    }

    teardown();
    if (!enabled) return;

    // Build the desired arc set for the *current* selection + tracked
    // snapshot. Reconciles against the existing polylines so we only
    // add/remove what changed (cheap repaints during pan / zoom).
    function render() {
      renderTimer.current = null;

      const wanted = new Map(); // key → { origin, destination, isPrimary }
      const selId  = selIdRef.current;

      // 1. Selected aircraft — try the live record first, then fall
      //    back to the enrichment cache by callsign so we can still
      //    render a route the moment it's resolved off-viewport.
      if (selId) {
        const f = flightsRef.current.find((x) => x.id === selId)
               || flightService.getFlight(selId);
        let route = extractRoute(f);
        if (!route && f?.callsign) {
          const en = getCachedEnrichment(f.callsign);
          if (en) route = extractRoute(en);
        }
        if (route) {
          wanted.set(route.key, { ...route, isPrimary: true });
        }
      }

      // 2. Tracked aircraft — every item the user has pinned via the
      //    Alerts panel. Each carries an enrichment snapshot with
      //    origin/destination, so we can draw their route even when
      //    the aircraft itself is outside the current viewport.
      for (const item of trackedRef.current) {
        const en = item.enrichment;
        const route = extractRoute(en);
        if (!route) continue;
        // Don't overwrite a primary entry with a secondary one.
        if (!wanted.has(route.key)) {
          wanted.set(route.key, { ...route, isPrimary: false });
        }
      }

      // Remove arcs no longer wanted.
      for (const [key, line] of linesRef.current) {
        if (!wanted.has(key)) {
          line.remove();
          linesRef.current.delete(key);
        }
      }

      // Add new arcs (or update style if primary-state flipped).
      for (const [key, route] of wanted) {
        const existing = linesRef.current.get(key);
        const styleOpts = route.isPrimary
          ? {
              // Selected aircraft — brighter, thicker, fully opaque.
              color:        '#38BDF8',
              weight:       3,
              opacity:      0.95,
              dashArray:    null,
            }
          : {
              // Tracked aircraft — slightly slimmer, dashed so the
              // user can still distinguish "I'm tracking this" from
              // "this is the one I'm watching right now".
              color:        '#38BDF8',
              weight:       2.4,
              opacity:      0.85,
              dashArray:    '5 5',
            };

        if (existing) {
          existing.setStyle(styleOpts);
          continue;
        }

        const pts = buildArc(
          route.origin.lat, route.origin.lng,
          route.destination.lat, route.destination.lng,
        );
        const line = L.polyline(pts, {
          ...styleOpts,
          interactive:  false,
          smoothFactor: 1,
          lineCap:      'round',
          lineJoin:     'round',
          className:    route.isPrimary
            ? 'flight-busy-route-arc is-primary'
            : 'flight-busy-route-arc',
        }).addTo(map);
        linesRef.current.set(key, line);
      }
    }

    // Coalesce multiple rapid-fire subscribe ticks into a single render.
    function scheduleRender() {
      if (renderTimer.current) return;
      renderTimer.current = setTimeout(render, RENDER_THROTTLE_MS);
    }

    // Expose the render closure so the selection-change effect below
    // can repaint immediately, bypassing the throttle.
    renderRef.current = render;

    const unsubFlights = flightService.subscribe((flights) => {
      flightsRef.current = flights;
      scheduleRender();
    });
    const unsubTracked = notificationService.subscribeToChanges((list) => {
      trackedRef.current = list;
      scheduleRender();
    });

    // Initial paint with whatever's already in memory.
    flightsRef.current = flightService.flights;
    trackedRef.current = notificationService.getTrackedList();
    render();

    return () => {
      teardown();
      unsubFlights();
      unsubTracked();
    };
  }, [enabled, map]);

  // Re-render immediately when the selected flight changes (or when
  // the layer is first turned on with a selection already active).
  // This bypasses the throttle so selection feels instant rather than
  // 1.5 s late.
  useEffect(() => {
    if (!enabled) return;
    // Microtask delay — let the parent's render commit and the live
    // flightService snapshot settle before we redraw.
    const id = setTimeout(() => renderRef.current?.(), 0);
    return () => clearTimeout(id);
  }, [selectedFlightId, enabled]);

  return null;
}
