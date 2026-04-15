// ─────────────────────────────────────────────────────────
//  BusyRoutesLayer
//  Draws great-circle arcs between airports whose routes
//  appear in the enrichment cache (populated by sidebar
//  clicks and background enrichment in flightService).
//
//  Thicker / brighter lines = more aircraft on that route.
//  Updates every 30 s (throttled). Top 15 routes shown.
// ─────────────────────────────────────────────────────────

import { useEffect, useRef }    from 'react';
import { useMap }               from 'react-leaflet';
import L                        from 'leaflet';
import { flightService }        from '../services/flightService';
import { getCachedEnrichment }  from '../services/flightEnrichmentService';

const D2R        = Math.PI / 180;
const R2D        = 180 / Math.PI;
const MAX_ROUTES = 15;
const UPDATE_MS  = 30_000;
const ARC_STEPS  = 32;   // points per arc — smooth but lightweight

// ── Spherical linear interpolation (great-circle arc) ────
function buildArc(olat, olng, dlat, dlng) {
  const φ1 = olat * D2R, λ1 = olng * D2R;
  const φ2 = dlat * D2R, λ2 = dlng * D2R;

  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((φ2 - φ1) / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2
  ));

  if (d < 0.01) return [[olat, olng], [dlat, dlng]]; // airports too close

  const pts = [];
  for (let i = 0; i <= ARC_STEPS; i++) {
    const t = i / ARC_STEPS;
    const A = Math.sin((1 - t) * d) / Math.sin(d);
    const B = Math.sin(t * d)       / Math.sin(d);
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

// ── Component ─────────────────────────────────────────────
export function BusyRoutesLayer({ enabled }) {
  const map      = useMap();
  const linesRef = useRef([]);
  const unsubRef = useRef(null);

  useEffect(() => {
    linesRef.current.forEach((l) => l.remove());
    linesRef.current = [];
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
    if (!enabled) return;

    let lastDraw = 0;

    unsubRef.current = flightService.subscribe((flights) => {
      const now = Date.now();
      if (now - lastDraw < UPDATE_MS) return;
      lastDraw = now;

      // Build route frequency map from enrichment cache
      const routeMap = new Map();  // key → { count, origin, destination }
      flights.forEach((f) => {
        const en = getCachedEnrichment(f.callsign);
        if (!en?.origin?.lat || !en?.destination?.lat) return;
        if (en.origin.code === en.destination.code)    return;
        if (en.origin.code === '----')                 return;

        const key = `${en.origin.code}→${en.destination.code}`;
        if (!routeMap.has(key)) {
          routeMap.set(key, { count: 0, origin: en.origin, destination: en.destination });
        }
        routeMap.get(key).count++;
      });

      if (routeMap.size === 0) return; // nothing enriched yet — wait

      const topRoutes = [...routeMap.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, MAX_ROUTES);
      const maxCount = topRoutes[0].count;

      // Rebuild arcs
      linesRef.current.forEach((l) => l.remove());
      linesRef.current = [];

      topRoutes.forEach(({ count, origin, destination }) => {
        const norm    = count / maxCount;
        const weight  = 1 + norm * 3;          // 1 – 4 px
        const opacity = 0.12 + norm * 0.5;     // 0.12 – 0.62

        const pts  = buildArc(origin.lat, origin.lng, destination.lat, destination.lng);
        const line = L.polyline(pts, {
          color:       '#00ffcc',
          weight,
          opacity,
          interactive: false,
          smoothFactor: 1,
        }).addTo(map);
        linesRef.current.push(line);
      });
    });

    return () => {
      linesRef.current.forEach((l) => l.remove());
      linesRef.current = [];
      if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
    };
  }, [enabled, map]);

  return null;
}
