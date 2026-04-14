// ─────────────────────────────────────────────────────────
//  AirportLayer — renders airport diamond markers on map.
//  Visible at zoom >= 4, IATA labels at zoom >= 6.
//  Click → popup with live arrival/departure stats.
// ─────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { AIRPORTS } from '../services/flightService.js';
import { airportService } from '../services/airportService.js';

const SHOW_ZOOM  = 4;   // first appear
const LABEL_ZOOM = 6;   // add IATA text label

// ── Icon builders ─────────────────────────────────────────
function buildIcon(code, showLabel) {
  const diamond =
    `<div style="width:7px;height:7px;background:rgba(0,255,204,0.65);` +
    `border:1.5px solid #00ffcc;border-radius:1px;transform:rotate(45deg);` +
    `box-shadow:0 0 6px rgba(0,255,204,0.4);"></div>`;
  const label = showLabel
    ? `<div style="position:absolute;top:10px;left:50%;transform:translateX(-50%);` +
      `white-space:nowrap;font-family:'Inter',sans-serif;font-size:8px;font-weight:700;` +
      `color:#00ffcc;text-shadow:0 0 6px #000,0 0 3px #000,0 0 2px rgba(0,0,0,0.9);">${code}</div>`
    : '';
  return L.divIcon({
    html: `<div style="position:relative;">${diamond}${label}</div>`,
    className: '',
    iconSize:   [7, 7],
    iconAnchor: [3, 3],
  });
}

// ── Popup content ─────────────────────────────────────────
function buildPopup(airport) {
  const dep = airportService.getDepartures(airport.code);
  const arr = airportService.getArrivals(airport.code);

  const flightRow = (f, dir) =>
    `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:10px;">
      <span style="color:${dir === '↑' ? '#00ffcc' : '#10b981'};font-size:9px;">${dir}</span>
      <span style="font-weight:600;color:#fff;">${f.callsign}</span>
      <span style="color:rgba(255,255,255,0.35);">
        ${dir === '↑' ? '→ ' + f.destination.code : '← ' + f.origin.code}
      </span>
      ${!f.isLive ? `<span style="color:rgba(255,255,255,0.2);margin-left:auto;">${f.airline.split(' ')[0]}</span>` : ''}
    </div>`;

  const depRows = dep.slice(0, 5).map((f) => flightRow(f, '↑')).join('');
  const arrRows = arr.slice(0, 5).map((f) => flightRow(f, '↓')).join('');
  const noFlights = dep.length + arr.length === 0;

  return `
    <div style="font-family:'Inter',sans-serif;color:#fff;min-width:185px;max-width:230px;">
      <div style="font-weight:800;color:#00ffcc;font-size:13px;letter-spacing:-0.3px;">${airport.code}</div>
      <div style="color:rgba(255,255,255,0.75);font-size:11px;margin-bottom:2px;">${airport.name}</div>
      <div style="color:rgba(255,255,255,0.38);font-size:10px;margin-bottom:8px;">${airport.city}, ${airport.country}</div>

      <div style="display:flex;gap:14px;margin-bottom:8px;padding:5px 0;
                  border-top:1px solid rgba(255,255,255,0.07);
                  border-bottom:1px solid rgba(255,255,255,0.07);">
        <div style="font-size:10px;">
          <span style="color:#00ffcc;">↑</span>
          <strong style="color:#fff;">${dep.length}</strong>
          <span style="color:rgba(255,255,255,0.35);"> dep</span>
        </div>
        <div style="font-size:10px;">
          <span style="color:#10b981;">↓</span>
          <strong style="color:#fff;">${arr.length}</strong>
          <span style="color:rgba(255,255,255,0.35);"> arr</span>
        </div>
        <div style="font-size:10px;color:rgba(255,255,255,0.3);">
          ${dep.length + arr.length} tracked
        </div>
      </div>

      ${noFlights
        ? '<div style="color:rgba(255,255,255,0.25);font-size:10px;padding:2px 0;">No tracked flights at this time</div>'
        : depRows + arrRows
      }
    </div>`;
}

// ── AirportLayer component ────────────────────────────────
export function AirportLayer({ enabled }) {
  const map     = useMap();
  const stateRef = useRef({ markers: [], onZoom: null });

  useEffect(() => {
    const { markers } = stateRef.current;

    // Teardown helper
    function teardown() {
      markers.forEach((m) => m.remove());
      markers.length = 0;
      if (stateRef.current.onZoom) {
        map.off('zoomend', stateRef.current.onZoom);
        stateRef.current.onZoom = null;
      }
    }

    teardown();
    if (!enabled) return;

    const airports = Object.values(AIRPORTS);
    const zoom     = map.getZoom();

    airports.forEach((airport) => {
      const marker = L.marker([airport.lat, airport.lng], {
        icon:        buildIcon(airport.code, zoom >= LABEL_ZOOM),
        zIndexOffset: -500,
        interactive: true,
        keyboard:    false,
        opacity:     zoom >= SHOW_ZOOM ? 1 : 0,
      }).addTo(map);

      // Hover tooltip
      marker.bindTooltip(
        `<div style="font-family:'Inter',sans-serif;font-size:11px;color:#fff;min-width:120px;">
          <div style="font-weight:700;color:#00ffcc;font-size:12px;">${airport.code}</div>
          <div style="color:rgba(255,255,255,0.65);">${airport.city}</div>
          <div style="color:rgba(255,255,255,0.35);font-size:10px;">${airport.name}</div>
        </div>`,
        { direction: 'top', offset: [0, -6], opacity: 1 }
      );

      // Click → popup with live stats (re-computed on click so data is fresh)
      marker.on('click', () => {
        L.popup({ maxWidth: 250, className: '' })
          .setLatLng([airport.lat, airport.lng])
          .setContent(buildPopup(airport))
          .openOn(map);
      });

      markers.push(marker);
    });

    // Re-style on zoom change
    function onZoom() {
      const z        = map.getZoom();
      const visible  = z >= SHOW_ZOOM;
      const showLbl  = z >= LABEL_ZOOM;
      markers.forEach((m, i) => {
        m.setOpacity(visible ? 1 : 0);
        if (visible) m.setIcon(buildIcon(airports[i].code, showLbl));
      });
    }

    map.on('zoomend', onZoom);
    stateRef.current.onZoom = onZoom;

    return teardown;
  }, [enabled, map]);

  return null;
}
