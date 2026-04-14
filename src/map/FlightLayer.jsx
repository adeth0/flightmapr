import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { flightService } from '../services/flightService';

// ── Aircraft SVG icon ─────────────────────────────────────
const PLANE_PATH =
  'M12,1 L14,8 L22,10 L21,13 L14,11 L14,20 L18,22 L12,21 L6,22 L10,20 L10,11 L3,13 L2,10 L10,8 Z';

/**
 * Creates the Leaflet DivIcon for an aircraft marker.
 * The inner div carries data-plane-rot so the 60fps update loop
 * can rotate it via direct style mutation instead of recreating the icon.
 */
function createIcon(heading, selected = false, hovered = false) {
  const color = selected ? '#ffffff' : '#00ffcc';
  const glow  = selected
    ? 'drop-shadow(0 0 10px #00ffcc) drop-shadow(0 0 4px #fff)'
    : hovered
    ? 'drop-shadow(0 0 8px #00ffcc)'
    : 'drop-shadow(0 0 4px #00ffcc80)';
  const size = selected ? 30 : 24;

  return L.divIcon({
    html:
      `<div data-plane-rot style="width:${size}px;height:${size}px;` +
      `transform:rotate(${heading}deg);transition:transform 0.4s linear;">` +
      `<svg width="${size}" height="${size}" viewBox="0 0 24 24"` +
      ` fill="${color}" xmlns="http://www.w3.org/2000/svg"` +
      ` style="filter:${glow};">` +
      `<path d="${PLANE_PATH}"/></svg></div>`,
    className: 'aircraft-marker',
    iconSize:    [size, size],
    iconAnchor:  [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 4)],
  });
}

// ── Route / trail polylines ───────────────────────────────
function createRoutePolyline(flight, map) {
  const pts = flight.routePoints.map((p) => [p.lat, p.lng]);
  return L.polyline(pts, {
    color:       'rgba(0,255,204,0.18)',
    weight:      1.5,
    dashArray:   '5,7',
    interactive: false,
  }).addTo(map);
}

function createTrailPolyline(flight, map) {
  const pts = flight.trail.map((p) => [p.lat, p.lng]);
  return L.polyline(pts, {
    color:       'rgba(0,255,204,0.55)',
    weight:      2,
    lineCap:     'round',
    interactive: false,
  }).addTo(map);
}

// ── All-flight trail (subtle, shown for every aircraft) ───
function createDimTrail(map) {
  return L.polyline([], {
    color:       'rgba(0,255,204,0.18)',
    weight:      1.5,
    lineCap:     'round',
    interactive: false,
  }).addTo(map);
}

// ── Hover tooltip HTML ────────────────────────────────────
function tooltipContent(f) {
  return `
    <div style="font-family:'Inter',sans-serif;font-size:12px;color:#fff;min-width:140px;">
      <div style="font-weight:700;color:#00ffcc;font-size:14px;margin-bottom:2px;">${f.callsign}</div>
      <div style="color:rgba(255,255,255,0.7);margin-bottom:6px;font-size:11px;">${f.airline}</div>
      <div style="display:flex;align-items:center;gap:6px;font-size:12px;">
        <span style="font-weight:600">${f.origin.code}</span>
        <span style="color:#00ffcc;">→</span>
        <span style="font-weight:600">${f.destination.code}</span>
      </div>
      <div style="margin-top:4px;color:rgba(255,255,255,0.5);font-size:11px;">${f.aircraft}</div>
    </div>`;
}

// ── FlightLayer component ─────────────────────────────────
export function FlightLayer({ selectedFlightId, onFlightSelect }) {
  const map             = useMap();
  const markersRef      = useRef(new Map());
  const dimTrailsRef    = useRef(new Map());   // subtle trail for every flight
  const routeRef        = useRef(null);
  const trailRef        = useRef(null);
  const selectedIdRef   = useRef(selectedFlightId);
  const onSelectRef     = useRef(onFlightSelect);

  // Keep refs in sync without re-creating the subscription
  useEffect(() => { selectedIdRef.current = selectedFlightId; }, [selectedFlightId]);
  useEffect(() => { onSelectRef.current   = onFlightSelect;   }, [onFlightSelect]);

  // Update dedicated route & trail lines when selection changes
  useEffect(() => {
    if (routeRef.current) { routeRef.current.remove(); routeRef.current = null; }
    if (trailRef.current) { trailRef.current.remove(); trailRef.current = null; }

    if (!selectedFlightId) return;
    const flight = flightService.getFlight(selectedFlightId);
    if (!flight) return;

    if (flight.routePoints.length > 0) {
      routeRef.current = createRoutePolyline(flight, map);
    }
    trailRef.current = createTrailPolyline(flight, map);
  }, [selectedFlightId, map]);

  // Main effect: create markers once, subscribe to position updates
  useEffect(() => {
    const markers   = markersRef.current;
    const dimTrails = dimTrailsRef.current;

    // ── Create one marker + dim-trail per flight ─────────
    flightService.flights.forEach((flight) => {
      const isSelected = selectedIdRef.current === flight.id;
      const marker = L.marker([flight.lat, flight.lng], {
        icon:        createIcon(flight.heading, isSelected),
        zIndexOffset: isSelected ? 1000 : 0,
      }).addTo(map);

      // Tooltip — updated lazily on tooltipopen to avoid per-tick rebuilds
      marker.bindTooltip(tooltipContent(flight), {
        permanent:  false,
        direction:  'top',
        offset:     [0, -4],
        opacity:    1,
        className:  '',
      });
      marker.on('tooltipopen', () => {
        const e = markers.get(flight.id);
        if (e) marker.setTooltipContent(tooltipContent(e.flight));
      });

      // Click to select
      marker.on('click', () => onSelectRef.current(flight));

      // Hover — infrequent, safe to rebuild icon
      marker.on('mouseover', () => {
        const e = markers.get(flight.id);
        if (e && selectedIdRef.current !== flight.id) {
          e.rotEl = null;
          marker.setIcon(createIcon(e.flight.heading, false, true));
        }
      });
      marker.on('mouseout', () => {
        const e = markers.get(flight.id);
        if (e && selectedIdRef.current !== flight.id) {
          e.rotEl = null;
          marker.setIcon(createIcon(e.flight.heading, false, false));
        }
      });

      // entry.rotEl is acquired lazily — points to the [data-plane-rot] div
      markers.set(flight.id, { marker, flight, rotEl: null, lastSel: isSelected });

      // Dim trail for every aircraft
      const dimTrail = createDimTrail(map);
      if (flight.trail.length >= 2) {
        dimTrail.setLatLngs(flight.trail.map((p) => [p.lat, p.lng]));
      }
      dimTrails.set(flight.id, dimTrail);
    });

    // ── Subscribe to simulation ticks (60 fps) ───────────
    const unsub = flightService.subscribe((flights) => {
      const selId = selectedIdRef.current;

      flights.forEach((flight) => {
        const entry = markers.get(flight.id);
        if (!entry) return;

        const { marker } = entry;
        entry.flight = flight;

        // Position update (Leaflet handles this efficiently via CSS transform)
        marker.setLatLng([flight.lat, flight.lng]);

        const isSel = selId === flight.id;

        // ── Fast path: direct DOM rotation ───────────────
        // Acquire [data-plane-rot] element lazily; null it out after any setIcon.
        if (!entry.rotEl) {
          const el = marker.getElement();
          if (el) entry.rotEl = el.querySelector('[data-plane-rot]');
        }
        if (entry.rotEl) {
          entry.rotEl.style.transform = `rotate(${flight.heading}deg)`;
        }

        // ── Slow path: icon rebuild only on selection change ──
        if (isSel !== entry.lastSel) {
          entry.lastSel = isSel;
          entry.rotEl   = null;   // will be re-acquired next tick
          marker.setIcon(createIcon(flight.heading, isSel));
          marker.setZIndexOffset(isSel ? 1000 : 0);
        }

        // ── Selected flight: update high-visibility trail ─
        if (isSel && trailRef.current) {
          trailRef.current.setLatLngs(flight.trail.map((p) => [p.lat, p.lng]));
        }

        // ── All-flight dim trails ─────────────────────────
        const dimTrail = dimTrails.get(flight.id);
        if (dimTrail) {
          if (flight.trail.length >= 2) {
            // Hide for selected flight — its dedicated trail is more prominent
            if (isSel) {
              dimTrail.setStyle({ opacity: 0 });
            } else {
              dimTrail.setLatLngs(flight.trail.map((p) => [p.lat, p.lng]));
              dimTrail.setStyle({ opacity: 1 });
            }
          }
        }
      });
    });

    return () => {
      unsub();
      markers.forEach(({ marker }) => marker.remove());
      markers.clear();
      dimTrails.forEach((t) => t.remove());
      dimTrails.clear();
      if (routeRef.current) { routeRef.current.remove(); routeRef.current = null; }
      if (trailRef.current) { trailRef.current.remove(); trailRef.current = null; }
    };
  }, [map]); // run once after mount

  return null;
}
