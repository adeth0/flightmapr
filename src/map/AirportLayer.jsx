// ─────────────────────────────────────────────────────────
//  AirportLayer — renders airport diamond markers on map.
//
//  Viewport-aware: only markers that fall inside the current
//  map bounds (plus a small buffer) are ever added to the DOM.
//  This keeps the layer smooth even with a much larger global
//  airport dataset. A "tier" filter additionally skips regional
//  airports when the map is zoomed out — global hubs first,
//  regional names appear as the user zooms in.
//
//  Zoom rules:
//   • zoom <  3            → layer hidden
//   • zoom 3–4             → tier 1 hubs only, no label
//   • zoom 5               → tier 1 + 2, no label
//   • zoom 6–7             → tier 1 + 2 + 3, IATA label
//   • zoom 8+              → everything, IATA label
//
//  Click → popup with live arrival/departure stats (unchanged).
// ─────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { AIRPORTS } from '../services/flightService.js';
import { airportService } from '../services/airportService.js';

const MIN_ZOOM         = 3;    // hide entirely below this
const LABEL_ZOOM       = 6;    // show IATA text label at/above this zoom
const HUB_ONLY_ZOOM    = 4;    // at/below this zoom, show tier-1 only
const TIER2_ZOOM       = 5;    // at/below this zoom, show tier-1 + tier-2
// Safety cap — prevents accidental regressions if dataset grows big.
const MAX_MARKERS      = 500;

// Buffer around the viewport (in degrees) so markers on the edge pop in
// slightly before they enter the visible area, avoiding visible flicker
// during pan. Small enough not to hurt performance.
const VIEWPORT_BUFFER  = 4;

// ── Tier filter ──────────────────────────────────────────
function tierVisibleAtZoom(tier, zoom) {
  if (zoom < MIN_ZOOM) return false;
  if (zoom <= HUB_ONLY_ZOOM) return tier === 1;
  if (zoom <= TIER2_ZOOM)    return tier === 1 || tier === 2;
  return true;
}

// ── Icon builders ─────────────────────────────────────────
// Graphite-black diamond with a soft white hairline border and a
// low-opacity glow. Deliberately dark so the marker stays visible
// on EVERY tile set (light streets, dark night, satellite, etc.)
// and doesn't read as "an aircraft" — aircraft stay silver.
//
// Hover / click handling lives in CSS via `.airport-marker`:
//   • hover → scale(1.05) + slightly stronger glow
//   • active → scale(0.96) briefly for a tactile tap
// The fill and stroke colors never change — only scale + glow —
// per the visibility spec.
function buildIcon(code, showLabel) {
  const diamond =
    `<div class="airport-marker-dot" style="` +
      `width:8px;height:8px;` +
      `background:#0B0D10;` +
      `border:1px solid rgba(255,255,255,0.15);` +
      `border-radius:1.5px;` +
      `transform:rotate(45deg);` +
      `box-shadow:0 0 8px rgba(255,255,255,0.25),0 0 2px rgba(0,0,0,0.6);` +
      `transition:transform 140ms ease, box-shadow 140ms ease;` +
      `"></div>`;
  const label = showLabel
    ? `<div class="airport-marker-label" style="` +
        `position:absolute;top:12px;left:50%;transform:translateX(-50%);` +
        `white-space:nowrap;font-family:'Inter',sans-serif;font-size:8px;font-weight:700;` +
        `color:#E8E8E8;letter-spacing:0.04em;` +
        `text-shadow:0 0 6px #000,0 0 3px #000,0 0 2px rgba(0,0,0,0.9);` +
        `">${code}</div>`
    : '';
  return L.divIcon({
    html: `<div class="airport-marker" style="position:relative;">${diamond}${label}</div>`,
    className: 'airport-marker-wrap',
    iconSize:   [8, 8],
    iconAnchor: [4, 4],
  });
}

// ── Popup content ─────────────────────────────────────────
function buildPopup(airport) {
  const dep = airportService.getDepartures(airport.code);
  const arr = airportService.getArrivals(airport.code);

  const flightRow = (f, dir) =>
    `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:10px;">
      <span style="color:${dir === '↑' ? '#E8E8E8' : '#BFC1C2'};font-size:9px;">${dir}</span>
      <span style="font-weight:600;color:#fff;">${f.callsign}</span>
      <span style="color:rgba(255,255,255,0.35);">
        ${dir === '↑' ? '→ ' + f.destination.code : '← ' + f.origin.code}
      </span>
      ${!f.isLive ? `<span style="color:rgba(255,255,255,0.2);margin-left:auto;">${f.airline.split(' ')[0]}</span>` : ''}
    </div>`;

  const depRows = dep.slice(0, 5).map((f) => flightRow(f, '↑')).join('');
  const arrRows = arr.slice(0, 5).map((f) => flightRow(f, '↓')).join('');
  const noFlights = dep.length + arr.length === 0;

  const icaoBadge = airport.icao && airport.icao !== '----'
    ? `<span style="color:rgba(255,255,255,0.35);font-size:9px;font-weight:600;letter-spacing:0.08em;margin-left:6px;">ICAO ${airport.icao}</span>`
    : '';

  return `
    <div style="font-family:'Inter',sans-serif;color:#fff;min-width:185px;max-width:230px;">
      <div style="display:flex;align-items:baseline;">
        <div style="font-weight:800;color:#E8E8E8;font-size:13px;letter-spacing:-0.3px;">${airport.code}</div>
        ${icaoBadge}
      </div>
      <div style="color:rgba(255,255,255,0.75);font-size:11px;margin-bottom:2px;">${airport.name}</div>
      <div style="color:rgba(255,255,255,0.38);font-size:10px;margin-bottom:8px;">${airport.city}, ${airport.country}</div>

      <div style="display:flex;gap:14px;margin-bottom:8px;padding:5px 0;
                  border-top:1px solid rgba(255,255,255,0.07);
                  border-bottom:1px solid rgba(255,255,255,0.07);">
        <div style="font-size:10px;">
          <span style="color:#E8E8E8;">↑</span>
          <strong style="color:#fff;">${dep.length}</strong>
          <span style="color:rgba(255,255,255,0.35);"> dep</span>
        </div>
        <div style="font-size:10px;">
          <span style="color:#BFC1C2;">↓</span>
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
  const map = useMap();
  // Track markers by IATA code so we can update / remove selectively on
  // moveend without rebuilding the entire layer (smoother pans).
  const stateRef = useRef({
    markersByCode: new Map(),
    handleMove: null,
    handleZoom: null,
    rafId: null,
  });

  useEffect(() => {
    const state = stateRef.current;

    function teardown() {
      state.markersByCode.forEach((m) => m.remove());
      state.markersByCode.clear();
      if (state.handleMove) map.off('moveend', state.handleMove);
      if (state.handleZoom) map.off('zoomend', state.handleZoom);
      if (state.rafId) cancelAnimationFrame(state.rafId);
      state.handleMove = null;
      state.handleZoom = null;
      state.rafId = null;
    }

    teardown();
    if (!enabled) return;

    const airports = Object.values(AIRPORTS);

    // Fast viewport + tier filter. Accepts the current zoom + bounds and
    // returns the subset of airports that should be visible right now.
    function computeVisible(zoom, bounds) {
      if (zoom < MIN_ZOOM) return [];

      const south = bounds.getSouth() - VIEWPORT_BUFFER;
      const north = bounds.getNorth() + VIEWPORT_BUFFER;
      const west  = bounds.getWest()  - VIEWPORT_BUFFER;
      const east  = bounds.getEast()  + VIEWPORT_BUFFER;
      // Handle antimeridian-crossing viewports by skipping the lng check
      // when the buffered window spans more than a full world width.
      const crossesDateline = east - west > 360;

      const out = [];
      for (const airport of airports) {
        const tier = airport.tier ?? 3;
        if (!tierVisibleAtZoom(tier, zoom)) continue;
        if (airport.lat < south || airport.lat > north) continue;
        if (!crossesDateline) {
          if (airport.lng < west || airport.lng > east) continue;
        }
        out.push(airport);
        if (out.length >= MAX_MARKERS) break;
      }
      return out;
    }

    // Reconcile the live markers with the desired visible set. Reused by
    // both moveend and zoomend handlers.
    function render() {
      const zoom    = map.getZoom();
      const bounds  = map.getBounds();
      const visible = computeVisible(zoom, bounds);
      const showLbl = zoom >= LABEL_ZOOM;

      const wanted = new Set(visible.map((a) => a.code));

      // Remove markers that fell out of the visible set
      for (const [code, marker] of state.markersByCode) {
        if (!wanted.has(code)) {
          marker.remove();
          state.markersByCode.delete(code);
        }
      }

      // Add / update markers that are in the visible set
      for (const airport of visible) {
        const existing = state.markersByCode.get(airport.code);
        if (existing) {
          // Only swap the icon if the label-visibility state changed.
          const hasLabel = existing.options?._labelShown === true;
          if (hasLabel !== showLbl) {
            existing.setIcon(buildIcon(airport.code, showLbl));
            existing.options._labelShown = showLbl;
          }
          continue;
        }

        const marker = L.marker([airport.lat, airport.lng], {
          icon:         buildIcon(airport.code, showLbl),
          zIndexOffset: -500,
          interactive:  true,
          keyboard:     false,
        });
        marker.options._labelShown = showLbl;

        marker.bindTooltip(
          `<div style="font-family:'Inter',sans-serif;font-size:11px;color:#fff;min-width:120px;">
            <div style="font-weight:700;color:#E8E8E8;font-size:12px;">${airport.code}</div>
            <div style="color:rgba(255,255,255,0.65);">${airport.city}</div>
            <div style="color:rgba(255,255,255,0.35);font-size:10px;">${airport.name}</div>
            ${airport.icao && airport.icao !== '----'
              ? `<div style="color:rgba(255,255,255,0.25);font-size:9px;margin-top:2px;">ICAO ${airport.icao}</div>`
              : ''}
          </div>`,
          { direction: 'top', offset: [0, -6], opacity: 1 }
        );

        marker.on('click', () => {
          L.popup({ maxWidth: 250, className: '' })
            .setLatLng([airport.lat, airport.lng])
            .setContent(buildPopup(airport))
            .openOn(map);
        });

        marker.addTo(map);
        state.markersByCode.set(airport.code, marker);
      }
    }

    // Debounce via rAF — moveend fires rapidly during momentum pans on
    // iOS and we only need one reconcile per animation frame.
    function scheduleRender() {
      if (state.rafId) return;
      state.rafId = requestAnimationFrame(() => {
        state.rafId = null;
        render();
      });
    }

    state.handleMove = scheduleRender;
    state.handleZoom = scheduleRender;
    map.on('moveend', state.handleMove);
    map.on('zoomend', state.handleZoom);

    // Initial paint
    render();

    return teardown;
  }, [enabled, map]);

  return null;
}
