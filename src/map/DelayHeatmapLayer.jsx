// ─────────────────────────────────────────────────────────
//  DelayHeatmapLayer
//  Lightweight overlay that tints airport regions by their
//  current average delay:
//    green  — on time (< 10 min avg)
//    amber  — minor delays (10–25 min)
//    red    — major delays (> 25 min)
//
//  Only airports that currently have live movements get a
//  tint, so the map stays clean when the feed is sparse.
//  Re-evaluated every 30 s (throttled) so we never thrash
//  the GPU during pans.
//
//  Intentionally mirrors ActivityHeatmapLayer's pattern so
//  the two overlays can coexist.
// ─────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { useMap }            from 'react-leaflet';
import L                     from 'leaflet';
import { flightService }     from '../services/flightService';
import { delayByAirport }    from '../services/insightsService';

const UPDATE_MS = 30_000;
const BASE_RADIUS = 28_000;  // metres
const MAX_RADIUS  = 130_000; // metres

function delayColor(avgDelay) {
  if (avgDelay >= 25) return '#ef4444'; // red
  if (avgDelay >= 10) return '#f59e0b'; // amber
  return '#BFC1C2';                     // green
}

function delayFillOpacity(count) {
  return Math.min(0.06 + count * 0.012, 0.28);
}

function delayRadius(count) {
  return Math.min(BASE_RADIUS + Math.sqrt(Math.max(count, 0)) * 18_000, MAX_RADIUS);
}

export function DelayHeatmapLayer({ enabled }) {
  const map        = useMap();
  const circlesRef = useRef(new Map()); // code → circle
  const unsubRef   = useRef(null);

  useEffect(() => {
    function teardown() {
      circlesRef.current.forEach((c) => c.remove());
      circlesRef.current.clear();
      if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
    }

    teardown();
    if (!enabled) return;

    let lastUpdate = 0;

    function repaint() {
      const rows = delayByAirport();
      const seen = new Set();

      for (const row of rows) {
        if (!row.count) continue;
        seen.add(row.airport.code);

        const color = delayColor(row.avgDelay);
        const fill  = delayFillOpacity(row.count);
        const rad   = delayRadius(row.count);

        let circle = circlesRef.current.get(row.airport.code);
        if (!circle) {
          circle = L.circle([row.airport.lat, row.airport.lng], {
            radius:       rad,
            color:        'transparent',
            fillColor:    color,
            fillOpacity:  fill,
            interactive:  false,
          }).addTo(map);
          circlesRef.current.set(row.airport.code, circle);
        } else {
          circle.setStyle({ fillColor: color, fillOpacity: fill });
          circle.setRadius(rad);
        }
      }

      // Drop circles for airports that no longer have movements.
      for (const [code, circle] of circlesRef.current) {
        if (!seen.has(code)) {
          circle.remove();
          circlesRef.current.delete(code);
        }
      }
    }

    // Initial paint + throttled updates on every flight tick.
    repaint();
    unsubRef.current = flightService.subscribe(() => {
      const now = Date.now();
      if (now - lastUpdate < UPDATE_MS) return;
      lastUpdate = now;
      repaint();
    });

    return teardown;
  }, [enabled, map]);

  return null;
}
