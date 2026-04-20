import { useEffect, useRef, useCallback } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { flightService } from '../services/flightService';
import { notificationService } from '../services/notificationService';

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

function getIconState(selected, hovered, previewed) {
  if (selected) {
    return {
      body: '#f8fafc',
      accent: '#8bfff1',
      outline: 'rgba(255, 255, 255, 0.95)',
      glow: 'drop-shadow(0 0 12px rgba(255, 255, 255,0.9)) drop-shadow(0 0 4px rgba(255,255,255,0.95))',
      size: 34,
    };
  }

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

  return {
    body: '#f8d64e',
    accent: '#f59e0b',
    outline: 'rgba(15, 23, 42, 0.92)',
    glow: 'drop-shadow(0 0 4px rgba(15,23,42,0.9)) drop-shadow(0 0 6px rgba(251,191,36,0.38))',
    size: 26,
  };
}

function renderAircraftSvg(type, palette, size) {
  const stroke = 1.2;

  if (type === 'helicopter') {
    return (
      `<svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="filter:${palette.glow};overflow:visible;">` +
      `<g fill="none" stroke-linecap="round" stroke-linejoin="round">` +
      `<path d="M4 5.5 H20" stroke="${palette.outline}" stroke-width="${stroke + 1}" opacity="0.55"/>` +
      `<path d="M4 5.5 H20" stroke="${palette.body}" stroke-width="${stroke}"/>` +
      `<path d="M11.8 6.5 H13.1 L15.6 9.8 L13.9 13.4 H9.8 L8.2 10.6 Z" fill="${palette.body}" stroke="${palette.outline}" stroke-width="${stroke}"/>` +
      `<path d="M13.9 9.7 H18.2" stroke="${palette.accent}" stroke-width="${stroke}"/>` +
      `<path d="M9.7 13.4 L7.1 15.2" stroke="${palette.outline}" stroke-width="${stroke}"/>` +
      `<path d="M8.2 10.6 L4.8 10.6" stroke="${palette.accent}" stroke-width="${stroke}"/>` +
      `<path d="M10.6 14.4 L8.7 17.7" stroke="${palette.outline}" stroke-width="${stroke}"/>` +
      `<path d="M13.4 14.4 L15.2 17.7" stroke="${palette.outline}" stroke-width="${stroke}"/>` +
      `</g></svg>`
    );
  }

  if (type === 'small') {
    return (
      `<svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="filter:${palette.glow};overflow:visible;">` +
      `<g fill="none" stroke-linecap="round" stroke-linejoin="round">` +
      `<path d="M12 2.2 L13.5 6.5 L19.6 8.8 L19.1 10.3 L14.4 9.8 L15.2 20.6 L13.2 21.8 L12 14.5 L10.8 21.8 L8.8 20.6 L9.6 9.8 L4.9 10.3 L4.4 8.8 L10.5 6.5 Z" fill="${palette.body}" stroke="${palette.outline}" stroke-width="${stroke}"/>` +
      `<path d="M12 2.2 V0.8" stroke="${palette.accent}" stroke-width="${stroke}"/>` +
      `<path d="M10.1 1.6 L13.9 1.6" stroke="${palette.accent}" stroke-width="${stroke}"/>` +
      `</g></svg>`
    );
  }

  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="filter:${palette.glow};overflow:visible;">` +
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M12 1.8 C11.2 1.8 10.4 2.6 10.1 4 L9.4 8.6 L3.1 12.1 L3.1 14.4 L9.2 12.9 L9.8 18.8 L7.8 21.1 L9.4 21.3 L12 19.6 L14.6 21.3 L16.2 21.1 L14.2 18.8 L14.8 12.9 L20.9 14.4 L20.9 12.1 L14.6 8.6 L13.9 4 C13.6 2.6 12.8 1.8 12 1.8 Z" fill="${palette.body}" stroke="${palette.outline}" stroke-width="${stroke}"/>` +
    `<path d="M9.2 12.8 H14.8" stroke="${palette.accent}" stroke-width="${stroke}" opacity="0.95"/>` +
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

  return L.divIcon({
    html:
      `<div class="aircraft-icon-shell aircraft-icon-${type}" style="width:${size}px;height:${size}px;">` +
      ring +
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
  const altStr = f.altitude ? `${f.altitude.toLocaleString()} ft · ${f.speed} kts` : '';

  return (
    `<div style="font-family:'Inter',system-ui,sans-serif;min-width:155px;padding:2px 0;">` +
    `<div style="font-size:14px;font-weight:700;color:#E8E8E8;margin-bottom:5px;letter-spacing:-0.3px;">${f.callsign}</div>` +
    `<div style="font-size:12px;color:#fff;display:flex;align-items:center;gap:8px;font-weight:600;">` +
    `<span>${origin}</span><span style="color:#E8E8E8;font-size:13px;">?</span><span>${dest}</span>` +
    `</div>` +
    (altStr ? `<div style="font-size:10px;color:rgba(255,255,255,0.45);margin-top:3px;">${altStr}</div>` : '') +
    `<button data-action="select" style="margin-top:8px;width:100%;padding:6px 0;` +
    `background:rgba(255, 255, 255,0.13);border:1px solid rgba(255, 255, 255,0.35);` +
    `border-radius:7px;color:#E8E8E8;font-size:11px;font-weight:600;cursor:pointer;` +
    `font-family:'Inter',sans-serif;-webkit-tap-highlight-color:transparent;">` +
    `View Full Details ?</button></div>`
  );
}

function tooltipContent(f) {
  return (
    `<div style="font-family:'Inter',sans-serif;font-size:12px;color:#fff;min-width:130px;">` +
    `<div style="font-weight:700;color:#E8E8E8;font-size:13px;margin-bottom:2px;">${f.callsign}</div>` +
    `<div style="color:rgba(255,255,255,0.55);font-size:10px;">${f.airline}</div>` +
    `</div>`
  );
}

export function FlightLayer({ selectedFlightId, onFlightSelect }) {
  const map = useMap();
  const markersRef = useRef(new Map());
  const trailRef = useRef(null);
  const selectedIdRef = useRef(selectedFlightId);
  const onSelectRef = useRef(onFlightSelect);
  const pendingPreviewRef = useRef(null);
  const trackedIdsRef = useRef(new Set());
  const lastPaneTouchRef = useRef(0);

  useEffect(() => { selectedIdRef.current = selectedFlightId; }, [selectedFlightId]);
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

  useEffect(() => {
    if (trailRef.current) { trailRef.current.remove(); trailRef.current = null; }
    if (!selectedFlightId) return;
    const flight = flightService.getFlight(selectedFlightId);
    if (!flight) return;
    trailRef.current = L.polyline(
      flight.trail.map((p) => [p.lat, p.lng]),
      { color: 'rgba(255, 255, 255,0.6)', weight: 2.5, lineCap: 'round', interactive: false },
    ).addTo(map);
  }, [selectedFlightId, map]);

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
      const selId = selectedIdRef.current;
      const incomingIds = new Set(flights.map((f) => f.id));
      markers.forEach((_, id) => { if (!incomingIds.has(id)) removeMarker(id); });

      flights.forEach((flight) => {
        if (!markers.has(flight.id)) addMarker(flight);

        const entry = markers.get(flight.id);
        if (!entry) return;

        entry.flight = flight;
        entry.marker.setLatLng([flight.lat, flight.lng]);

        const isSel = selId === flight.id;

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

        if (isSel && trailRef.current) {
          trailRef.current.setLatLngs(flight.trail.map((p) => [p.lat, p.lng]));
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
      if (trailRef.current) { trailRef.current.remove(); trailRef.current = null; }
      safeRemovePopup(pendingPreviewRef.current?.popup);
      pendingPreviewRef.current = null;
    };
  }, [map, addMarker, removeMarker, updateDensity, dismissPreview]);

  return null;
}
