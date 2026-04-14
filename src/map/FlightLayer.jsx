import { useEffect, useRef, useCallback } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { flightService } from '../services/flightService';

// ── Aircraft SVG icon ─────────────────────────────────────
// Top-down silhouette; nose points UP (0° = north).
const PLANE_PATH =
  'M12,1 L14,8 L22,10 L21,13 L14,11 L14,20 L18,22 L12,21 L6,22 L10,20 L10,11 L3,13 L2,10 L10,8 Z';

function createIcon(heading, selected = false, hovered = false) {
  const color = selected ? '#ffffff' : '#00ffcc';
  const glow = selected
    ? 'drop-shadow(0 0 10px #00ffcc) drop-shadow(0 0 4px #fff)'
    : hovered
    ? 'drop-shadow(0 0 8px #00ffcc)'
    : 'drop-shadow(0 0 4px #00ffcc80)';
  const size = selected ? 30 : 24;

  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;transform:rotate(${heading}deg);transition:transform 0.25s linear;">
      <svg width="${size}" height="${size}" viewBox="0 0 24 24"
        fill="${color}" xmlns="http://www.w3.org/2000/svg"
        style="filter:${glow};transition:filter 0.2s;">
        <path d="${PLANE_PATH}"/>
      </svg>
    </div>`,
    className: 'aircraft-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 4)],
  });
}

// ── Route / trail polylines ───────────────────────────────
function createRoutePolyline(flight, map) {
  const pts = flight.routePoints.map((p) => [p.lat, p.lng]);
  return L.polyline(pts, {
    color: 'rgba(0,255,204,0.18)',
    weight: 1.5,
    dashArray: '5,7',
    interactive: false,
  }).addTo(map);
}

function createTrailPolyline(flight, map) {
  const pts = flight.trail.map((p) => [p.lat, p.lng]);
  return L.polyline(pts, {
    color: 'rgba(0,255,204,0.55)',
    weight: 2,
    lineCap: 'round',
    interactive: false,
  }).addTo(map);
}

// ── Hover tooltip ─────────────────────────────────────────
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
  const map = useMap();
  const markersRef = useRef(new Map());
  const routeRef = useRef(null);
  const trailRef = useRef(null);
  const selectedIdRef = useRef(selectedFlightId);
  const onSelectRef = useRef(onFlightSelect);

  // Keep refs in sync without re-creating subscription
  useEffect(() => { selectedIdRef.current = selectedFlightId; }, [selectedFlightId]);
  useEffect(() => { onSelectRef.current = onFlightSelect; }, [onFlightSelect]);

  // Update route & trail lines when selection changes
  useEffect(() => {
    if (routeRef.current) { routeRef.current.remove(); routeRef.current = null; }
    if (trailRef.current) { trailRef.current.remove(); trailRef.current = null; }

    if (!selectedFlightId) return;
    const flight = flightService.getFlight(selectedFlightId);
    if (!flight) return;

    routeRef.current = createRoutePolyline(flight, map);
    trailRef.current = createTrailPolyline(flight, map);
  }, [selectedFlightId, map]);

  // Main effect: create markers once, subscribe to position updates
  useEffect(() => {
    const markers = markersRef.current;

    // Create a marker per flight
    flightService.flights.forEach((flight) => {
      const isSelected = selectedIdRef.current === flight.id;
      const marker = L.marker([flight.lat, flight.lng], {
        icon: createIcon(flight.heading, isSelected),
        zIndexOffset: isSelected ? 1000 : 0,
      }).addTo(map);

      // Tooltip on hover
      marker.bindTooltip(tooltipContent(flight), {
        permanent: false,
        direction: 'top',
        offset: [0, -4],
        opacity: 1,
        className: '',
      });

      // Click to select
      marker.on('click', () => onSelectRef.current(flight));

      // Hover highlight
      marker.on('mouseover', () => {
        if (selectedIdRef.current !== flight.id) {
          marker.setIcon(createIcon(flight.heading, false, true));
        }
      });
      marker.on('mouseout', () => {
        if (selectedIdRef.current !== flight.id) {
          marker.setIcon(createIcon(flight.heading, false, false));
        }
      });

      markers.set(flight.id, { marker, flight });
    });

    // Subscribe to simulation ticks — update positions imperatively
    const unsub = flightService.subscribe((flights) => {
      const selId = selectedIdRef.current;

      flights.forEach((flight) => {
        const entry = markersRef.current.get(flight.id);
        if (!entry) return;
        const { marker } = entry;
        entry.flight = flight;

        marker.setLatLng([flight.lat, flight.lng]);
        const isSel = selId === flight.id;
        marker.setIcon(createIcon(flight.heading, isSel));
        marker.setZIndexOffset(isSel ? 1000 : 0);

        // Update tooltip
        marker.setTooltipContent(tooltipContent(flight));

        // Update trail polyline for selected flight
        if (isSel && trailRef.current) {
          const pts = flight.trail.map((p) => [p.lat, p.lng]);
          trailRef.current.setLatLngs(pts);
        }
      });
    });

    return () => {
      unsub();
      markers.forEach(({ marker }) => marker.remove());
      markers.clear();
      if (routeRef.current) { routeRef.current.remove(); routeRef.current = null; }
      if (trailRef.current) { trailRef.current.remove(); trailRef.current = null; }
    };
  }, [map]); // run once after mount

  return null;
}
