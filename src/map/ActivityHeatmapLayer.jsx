// ─────────────────────────────────────────────────────────
//  ActivityHeatmapLayer
//  Draws soft glowing circles over airports sized by the
//  number of aircraft currently within 80 km.
//  Updates every 30 s (throttled) — mobile GPU friendly.
// ─────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { useMap }            from 'react-leaflet';
import L                     from 'leaflet';
import { AIRPORTS, flightService } from '../services/flightService';

const D2R          = Math.PI / 180;
const NEARBY_KM    = 80;    // aircraft within this radius count toward airport activity
const UPDATE_MS    = 30_000;
const BASE_RADIUS  = 22_000; // metres — minimum circle size

function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * D2R;
  const dLng = (lng2 - lng1) * D2R;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

function activityColor(count) {
  if (count >= 25) return '#ff4400';
  if (count >= 12) return '#ffaa00';
  if (count >= 4)  return '#80ff88';
  return '#00ffcc';
}

function activityRadius(count) {
  // sqrt scaling keeps large airports from dominating
  return Math.min(BASE_RADIUS + Math.sqrt(Math.max(count, 0)) * 20_000, 140_000);
}

function activityFillOpacity(count) {
  return Math.min(0.03 + count * 0.014, 0.30);
}

// ── Component ─────────────────────────────────────────────
export function ActivityHeatmapLayer({ enabled }) {
  const map        = useMap();
  const circlesRef = useRef([]);
  const unsubRef   = useRef(null);

  useEffect(() => {
    // Teardown
    circlesRef.current.forEach((c) => c.remove());
    circlesRef.current = [];
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
    if (!enabled) return;

    const airports = Object.values(AIRPORTS);

    // Pre-create one circle per airport at minimal size/opacity
    airports.forEach((ap) => {
      const circle = L.circle([ap.lat, ap.lng], {
        radius:      BASE_RADIUS,
        color:       'transparent',   // no stroke
        fillColor:   '#00ffcc',
        fillOpacity: 0.03,
        interactive: false,
      }).addTo(map);
      circlesRef.current.push(circle);
    });

    // Throttled update: recalculate activity every 30 s
    let lastUpdate = 0;
    unsubRef.current = flightService.subscribe((flights) => {
      const now = Date.now();
      if (now - lastUpdate < UPDATE_MS) return;
      lastUpdate = now;

      airports.forEach((ap, i) => {
        const circle = circlesRef.current[i];
        if (!circle) return;

        const count = flights.reduce(
          (n, f) => haversineKm(f.lat, f.lng, ap.lat, ap.lng) <= NEARBY_KM ? n + 1 : n,
          0
        );

        circle.setStyle({
          fillColor:   activityColor(count),
          fillOpacity: activityFillOpacity(count),
        });
        circle.setRadius(activityRadius(count));
      });
    });

    return () => {
      circlesRef.current.forEach((c) => c.remove());
      circlesRef.current = [];
      if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
    };
  }, [enabled, map]);

  return null;
}
