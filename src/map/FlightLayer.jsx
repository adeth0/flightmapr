import { useEffect, useRef, useCallback } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { flightService } from '../services/flightService';

// ── Aircraft SVG icon ─────────────────────────────────────
const PLANE_PATH =
  'M12,1 L14,8 L22,10 L21,13 L14,11 L14,20 L18,22 L12,21 L6,22 L10,20 L10,11 L3,13 L2,10 L10,8 Z';

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
function createTrailPolyline(flight, map) {
  const pts = flight.trail.map((p) => [p.lat, p.lng]);
  return L.polyline(pts, {
    color:       'rgba(0,255,204,0.55)',
    weight:      2,
    lineCap:     'round',
    interactive: false,
  }).addTo(map);
}

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
    </div>`;
}

// ── FlightLayer component ─────────────────────────────────
export function FlightLayer({ selectedFlightId, onFlightSelect }) {
  const map           = useMap();
  const markersRef    = useRef(new Map());
  const dimTrailsRef  = useRef(new Map());
  const trailRef      = useRef(null);
  const selectedIdRef = useRef(selectedFlightId);
  const onSelectRef   = useRef(onFlightSelect);

  useEffect(() => { selectedIdRef.current = selectedFlightId; }, [selectedFlightId]);
  useEffect(() => { onSelectRef.current   = onFlightSelect;   }, [onFlightSelect]);

  // Update dedicated trail line when selection changes
  useEffect(() => {
    if (trailRef.current) { trailRef.current.remove(); trailRef.current = null; }
    if (!selectedFlightId) return;
    const flight = flightService.getFlight(selectedFlightId);
    if (!flight) return;
    trailRef.current = createTrailPolyline(flight, map);
  }, [selectedFlightId, map]);

  // ── Helper: add a single marker + dim-trail to the map ──
  const addMarker = useCallback((flight) => {
    const markers   = markersRef.current;
    const dimTrails = dimTrailsRef.current;
    if (markers.has(flight.id)) return;   // already tracked

    const isSelected = selectedIdRef.current === flight.id;
    const marker = L.marker([flight.lat, flight.lng], {
      icon:        createIcon(flight.heading, isSelected),
      zIndexOffset: isSelected ? 1000 : 0,
    }).addTo(map);

    marker.bindTooltip(tooltipContent(flight), {
      permanent: false, direction: 'top', offset: [0, -4], opacity: 1, className: '',
    });
    marker.on('tooltipopen', () => {
      const e = markers.get(flight.id);
      if (e) marker.setTooltipContent(tooltipContent(e.flight));
    });
    marker.on('click', () => onSelectRef.current(flight));
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

    markers.set(flight.id, { marker, flight, rotEl: null, lastSel: isSelected });

    const dimTrail = createDimTrail(map);
    if (flight.trail.length >= 2) {
      dimTrail.setLatLngs(flight.trail.map((p) => [p.lat, p.lng]));
    }
    dimTrails.set(flight.id, dimTrail);
  }, [map]);

  // ── Helper: remove a single marker + trail ───────────────
  const removeMarker = useCallback((id) => {
    const markers   = markersRef.current;
    const dimTrails = dimTrailsRef.current;
    const entry = markers.get(id);
    if (entry) { entry.marker.remove(); markers.delete(id); }
    const dt = dimTrails.get(id);
    if (dt) { dt.remove(); dimTrails.delete(id); }
  }, []);

  // ── Zoom-based density culling ────────────────────────────
  const updateDensity = useCallback(() => {
    const markers = markersRef.current;
    const zoom = map.getZoom();
    let idx = 0;
    markers.forEach((entry, id) => {
      idx++;
      if (id === selectedIdRef.current) { entry.marker.setOpacity(1); return; }
      let visible = true;
      if      (zoom < 3) visible = idx % 4 === 0;
      else if (zoom < 5) visible = idx % 2 === 0;
      entry.marker.setOpacity(visible ? 1 : 0);
      const dt = dimTrailsRef.current.get(id);
      if (dt) dt.setStyle({ opacity: visible ? 1 : 0 });
    });
  }, [map]);

  // ── Main effect: subscribe to live updates ─────────────
  useEffect(() => {
    map.on('zoomend', updateDensity);

    const unsub = flightService.subscribe((flights) => {
      const markers   = markersRef.current;
      const dimTrails = dimTrailsRef.current;
      const selId     = selectedIdRef.current;

      // 1. Remove markers for aircraft no longer in the feed
      const incomingIds = new Set(flights.map((f) => f.id));
      markers.forEach((_, id) => {
        if (!incomingIds.has(id)) removeMarker(id);
      });

      // 2. Update or create a marker for every current aircraft
      flights.forEach((flight) => {
        // Create marker if this aircraft wasn't tracked yet
        if (!markers.has(flight.id)) {
          addMarker(flight);
        }

        const entry = markers.get(flight.id);
        if (!entry) return;

        const { marker } = entry;
        entry.flight = flight;

        // Position update
        marker.setLatLng([flight.lat, flight.lng]);

        const isSel = selId === flight.id;

        // Fast path: direct DOM rotation (avoids icon rebuild every frame)
        if (!entry.rotEl) {
          const el = marker.getElement();
          if (el) entry.rotEl = el.querySelector('[data-plane-rot]');
        }
        if (entry.rotEl) {
          entry.rotEl.style.transform = `rotate(${flight.heading}deg)`;
        }

        // Slow path: icon rebuild only on selection change
        if (isSel !== entry.lastSel) {
          entry.lastSel = isSel;
          entry.rotEl   = null;
          marker.setIcon(createIcon(flight.heading, isSel));
          marker.setZIndexOffset(isSel ? 1000 : 0);
        }

        // Selected flight: update high-visibility trail
        if (isSel && trailRef.current) {
          trailRef.current.setLatLngs(flight.trail.map((p) => [p.lat, p.lng]));
        }

        // Dim trail for every aircraft
        const dimTrail = dimTrails.get(flight.id);
        if (dimTrail && flight.trail.length >= 2) {
          if (isSel) {
            dimTrail.setStyle({ opacity: 0 });
          } else {
            dimTrail.setLatLngs(flight.trail.map((p) => [p.lat, p.lng]));
            dimTrail.setStyle({ opacity: 1 });
          }
        }
      });
    });

    return () => {
      unsub();
      map.off('zoomend', updateDensity);
      markersRef.current.forEach(({ marker }) => marker.remove());
      markersRef.current.clear();
      dimTrailsRef.current.forEach((t) => t.remove());
      dimTrailsRef.current.clear();
      if (trailRef.current) { trailRef.current.remove(); trailRef.current = null; }
    };
  }, [map, addMarker, removeMarker, updateDensity]);

  return null;
}
