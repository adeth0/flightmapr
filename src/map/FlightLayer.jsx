import { useEffect, useRef, useCallback } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { flightService }        from '../services/flightService';
import { notificationService }  from '../services/notificationService';

// ── Aircraft SVG path ─────────────────────────────────────
const PLANE_PATH =
  'M12 2 C11 2 10 3 9.5 5 L9 9 ' +
  'L2 13 L2 15.5 L9 13 ' +
  'L9.5 19.5 L7 22.5 L9.5 21.5 ' +
  'L12 22.5 L14.5 21.5 L17 22.5 L14.5 19.5 ' +
  'L15 13 L22 15.5 L22 13 ' +
  'L15 9 L14.5 5 C14 3 13 2 12 2Z';

// ── Icon factory ──────────────────────────────────────────
/**
 * States (in priority order):
 *   selected  – white plane, cyan glow, 30 px
 *   previewed – yellow plane, bright glow, 28 px
 *   hovered   – yellow plane, soft glow, 24 px
 *   tracked   – yellow plane + amber ring, 24 px
 *   default   – yellow plane, dark-outline glow, 24 px
 *
 * Yellow (#FFD700) reads on both the colourful Voyager tiles and the dark
 * CartoDB tiles. A dark drop-shadow ensures contrast on pale map areas.
 *
 * Tracked aircraft get an overflow:visible amber ring (CSS animation) so
 * the ring doesn't shift the icon anchor point.
 */
function createIcon(heading, selected = false, hovered = false, previewed = false, tracked = false) {
  let color, glow, size;

  if (selected) {
    color = '#ffffff';
    glow  = 'drop-shadow(0 0 10px #00ffcc) drop-shadow(0 0 4px #fff)';
    size  = 30;
  } else if (previewed) {
    color = '#FFD700';
    glow  = 'drop-shadow(0 0 8px rgba(255,215,0,0.95)) drop-shadow(0 0 2px rgba(0,0,0,0.9))';
    size  = 28;
  } else if (hovered) {
    color = '#FFD700';
    glow  = 'drop-shadow(0 0 6px rgba(255,215,0,0.85)) drop-shadow(0 0 2px rgba(0,0,0,0.7))';
    size  = 24;
  } else {
    color = '#FFD700';
    glow  = 'drop-shadow(0 0 2px rgba(0,0,0,0.85)) drop-shadow(0 0 4px rgba(255,215,0,0.55))';
    size  = 24;
  }

  // Amber pulse ring for tracked aircraft (overflows icon bounds, doesn't affect anchor)
  const ring = (tracked && !selected)
    ? `<div style="position:absolute;inset:-10px;border-radius:50%;` +
      `border:2px solid rgba(251,191,36,0.7);pointer-events:none;` +
      `animation:tracked-ring 1.8s ease-in-out infinite;"></div>`
    : '';

  return L.divIcon({
    html:
      `<div style="position:relative;width:${size}px;height:${size}px;overflow:visible;">` +
      ring +
      `<div data-plane-rot style="width:${size}px;height:${size}px;` +
      `transform:rotate(${heading}deg);transition:transform 0.4s linear;">` +
      `<svg width="${size}" height="${size}" viewBox="0 0 24 24"` +
      ` fill="${color}" xmlns="http://www.w3.org/2000/svg"` +
      ` style="filter:${glow};">` +
      `<path d="${PLANE_PATH}"/></svg></div></div>`,
    className: 'aircraft-marker',
    iconSize:    [size, size],
    iconAnchor:  [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 4)],
  });
}

// ── Mini preview popup (first tap) ───────────────────────
function miniPopupContent(f) {
  const origin = f.origin?.code && f.origin.code !== '----' ? f.origin.code : '---';
  const dest   = f.destination?.code && f.destination.code !== '----' ? f.destination.code : '---';
  const altStr = f.altitude ? `${f.altitude.toLocaleString()} ft · ${f.speed} kts` : '';

  return (
    `<div style="font-family:'Inter',system-ui,sans-serif;min-width:155px;padding:2px 0;">` +
    `<div style="font-size:14px;font-weight:700;color:#00ffcc;margin-bottom:5px;letter-spacing:-0.3px;">${f.callsign}</div>` +
    `<div style="font-size:12px;color:#fff;display:flex;align-items:center;gap:8px;font-weight:600;">` +
    `<span>${origin}</span><span style="color:#00ffcc;font-size:13px;">→</span><span>${dest}</span>` +
    `</div>` +
    (altStr ? `<div style="font-size:10px;color:rgba(255,255,255,0.45);margin-top:3px;">${altStr}</div>` : '') +
    `<button data-action="select" style="margin-top:8px;width:100%;padding:6px 0;` +
    `background:rgba(0,255,204,0.13);border:1px solid rgba(0,255,204,0.35);` +
    `border-radius:7px;color:#00ffcc;font-size:11px;font-weight:600;cursor:pointer;` +
    `font-family:'Inter',sans-serif;-webkit-tap-highlight-color:transparent;">` +
    `View Full Details →</button></div>`
  );
}

// ── Hover tooltip ─────────────────────────────────────────
function tooltipContent(f) {
  return (
    `<div style="font-family:'Inter',sans-serif;font-size:12px;color:#fff;min-width:130px;">` +
    `<div style="font-weight:700;color:#00ffcc;font-size:13px;margin-bottom:2px;">${f.callsign}</div>` +
    `<div style="color:rgba(255,255,255,0.55);font-size:10px;">${f.airline}</div>` +
    `</div>`
  );
}

// ── FlightLayer ───────────────────────────────────────────
export function FlightLayer({ selectedFlightId, onFlightSelect }) {
  const map              = useMap();
  const markersRef       = useRef(new Map());
  const trailRef         = useRef(null);
  const selectedIdRef    = useRef(selectedFlightId);
  const onSelectRef      = useRef(onFlightSelect);
  const pendingPreviewRef = useRef(null); // { id, popup }
  const trackedIdsRef    = useRef(new Set()); // ids currently tracked for notifications

  useEffect(() => { selectedIdRef.current = selectedFlightId; }, [selectedFlightId]);
  useEffect(() => { onSelectRef.current   = onFlightSelect;   }, [onFlightSelect]);

  // ── Track notification state → update amber rings ────
  useEffect(() => {
    return notificationService.subscribeToChanges((list) => {
      const newSet = new Set(list.map((t) => t.id));
      trackedIdsRef.current = newSet;
      // Refresh icons for markers whose tracked status changed
      markersRef.current.forEach((entry, id) => {
        const wasTracked = entry.tracked ?? false;
        const isNowTracked = newSet.has(id);
        if (wasTracked !== isNowTracked) {
          entry.tracked = isNowTracked;
          entry.rotEl   = null;
          const isSel = selectedIdRef.current === id;
          entry.marker.setIcon(
            createIcon(entry.flight.heading, isSel, false, entry.previewed ?? false, isNowTracked)
          );
        }
      });
    });
  }, []);

  // Clear preview when the flight becomes fully selected
  useEffect(() => {
    if (selectedFlightId && pendingPreviewRef.current?.id === selectedFlightId) {
      _safeRemovePopup(pendingPreviewRef.current.popup);
      pendingPreviewRef.current = null;
    }
  }, [selectedFlightId]);

  // Rebuild trail whenever the selected flight changes
  useEffect(() => {
    if (trailRef.current) { trailRef.current.remove(); trailRef.current = null; }
    if (!selectedFlightId) return;
    const flight = flightService.getFlight(selectedFlightId);
    if (!flight) return;
    trailRef.current = L.polyline(
      flight.trail.map((p) => [p.lat, p.lng]),
      { color: 'rgba(0,255,204,0.6)', weight: 2.5, lineCap: 'round', interactive: false }
    ).addTo(map);
  }, [selectedFlightId, map]);

  // ── Utilities ─────────────────────────────────────────────
  function _safeRemovePopup(popup) {
    try { if (popup) popup.remove(); } catch { /* ignore */ }
  }

  const clearMarkerPreview = useCallback((flightId) => {
    const entry = markersRef.current.get(flightId);
    if (entry?.previewed) {
      entry.previewed = false;
      entry.rotEl     = null;
      const isTracked = trackedIdsRef.current.has(flightId);
      entry.marker.setIcon(createIcon(entry.flight.heading, false, false, false, isTracked));
      entry.marker.setZIndexOffset(0);
    }
  }, []);

  const dismissPreview = useCallback(() => {
    if (!pendingPreviewRef.current) return;
    const { id, popup } = pendingPreviewRef.current;
    _safeRemovePopup(popup);
    clearMarkerPreview(id);
    pendingPreviewRef.current = null;
  }, [clearMarkerPreview]);

  const openMiniPopup = useCallback((flight) => {
    if (pendingPreviewRef.current) {
      _safeRemovePopup(pendingPreviewRef.current.popup);
      clearMarkerPreview(pendingPreviewRef.current.id);
    }

    const popup = L.popup({
      closeButton:  true,
      autoClose:    false,
      closeOnClick: false,
      className:    'flight-mini-popup',
      offset:       [0, -20],
      maxWidth:     220,
    })
      .setLatLng([flight.lat, flight.lng])
      .setContent(miniPopupContent(flight))
      .openOn(map);

    // Wire the "View Full Details" button
    const setupBtn = () => {
      const el = popup.getElement?.()?.querySelector('[data-action="select"]');
      if (!el) return;
      const activate = (e) => {
        e.stopPropagation();
        e.preventDefault();
        _safeRemovePopup(popup);
        clearMarkerPreview(flight.id);
        pendingPreviewRef.current = null;
        onSelectRef.current(flight);
      };
      el.addEventListener('click',    activate, { passive: false });
      el.addEventListener('touchend', activate, { passive: false });
    };
    setTimeout(setupBtn, 60);

    // Elevate the marker visually
    const entry = markersRef.current.get(flight.id);
    if (entry) {
      entry.previewed = true;
      entry.rotEl     = null;
      const isTracked = trackedIdsRef.current.has(flight.id);
      entry.marker.setIcon(createIcon(entry.flight.heading, false, false, true, isTracked));
      entry.marker.setZIndexOffset(500);
    }

    pendingPreviewRef.current = { id: flight.id, popup };
  }, [map, clearMarkerPreview]);

  // ── Marker lifecycle ──────────────────────────────────────
  const addMarker = useCallback((flight) => {
    const markers = markersRef.current;
    if (markers.has(flight.id)) return;

    const isSelected = selectedIdRef.current === flight.id;
    const isTracked  = trackedIdsRef.current.has(flight.id);
    const marker = L.marker([flight.lat, flight.lng], {
      icon:         createIcon(flight.heading, isSelected, false, false, isTracked),
      zIndexOffset: isSelected ? 1000 : 0,
    }).addTo(map);

    marker.bindTooltip(tooltipContent(flight), {
      permanent: false, direction: 'top', offset: [0, -4], opacity: 1, className: '',
    });
    marker.on('tooltipopen', () => {
      const e = markers.get(flight.id);
      if (e) marker.setTooltipContent(tooltipContent(e.flight));
    });

    // ── Two-tap UX: preview → select ─────────────────────
    // 1st tap → mini popup  |  2nd tap → full sidebar
    // touchend fires on iOS before 'click', so we use it to avoid 300 ms delay.
    let lastTouchMs = 0;

    const handleActivate = () => {
      const pending = pendingPreviewRef.current;
      if (pending?.id === flight.id) {
        dismissPreview();
        onSelectRef.current(flight);
      } else {
        openMiniPopup(flight);
      }
    };

    marker.on('touchend', (e) => {
      L.DomEvent.stopPropagation(e);
      L.DomEvent.preventDefault(e);
      lastTouchMs = Date.now();
      console.log('[FlightMapr] touch select:', flight.callsign);
      onSelectRef.current(flight);
    });

    // ── Click handler (desktop + iOS Map.Tap fallback) ────────────
    // On iOS, Leaflet's L.Map.Tap converts every tap to a synthetic
    // 'click' on the marker element which then BUBBLES to the map
    // container where map.on('click', dismissPreview) was collapsing
    // any preview we had just opened.  We now guard against that in
    // the map-level handler (see below), so this just does a direct
    // select whenever a real desktop click arrives.
    marker.on('click', () => {
      if (Date.now() - lastTouchMs < 500) return; // suppress after touch (Android)
      console.log('[FlightMapr] click select:', flight.callsign);
      onSelectRef.current(flight);
    });

    marker.on('mouseover', () => {
      const e = markers.get(flight.id);
      if (e && selectedIdRef.current !== flight.id && !e.previewed) {
        e.rotEl = null;
        const isTracked = trackedIdsRef.current.has(flight.id);
        marker.setIcon(createIcon(e.flight.heading, false, true, false, isTracked));
      }
    });
    marker.on('mouseout', () => {
      const e = markers.get(flight.id);
      if (e && selectedIdRef.current !== flight.id && !e.previewed) {
        e.rotEl = null;
        const isTracked = trackedIdsRef.current.has(flight.id);
        marker.setIcon(createIcon(e.flight.heading, false, false, false, isTracked));
      }
    });

    markers.set(flight.id, {
      marker,
      flight,
      rotEl:    null,
      lastSel:  isSelected,
      previewed: false,
      tracked:  isTracked,
    });
  }, [map, openMiniPopup, dismissPreview]);

  const removeMarker = useCallback((id) => {
    const entry = markersRef.current.get(id);
    if (entry) { entry.marker.remove(); markersRef.current.delete(id); }
    if (pendingPreviewRef.current?.id === id) {
      _safeRemovePopup(pendingPreviewRef.current.popup);
      pendingPreviewRef.current = null;
    }
  }, []);

  const updateDensity = useCallback(() => {
    const zoom = map.getZoom();
    let idx = 0;
    markersRef.current.forEach((entry, id) => {
      idx++;
      if (id === selectedIdRef.current) { entry.marker.setOpacity(1); return; }
      let visible = true;
      if      (zoom < 3) visible = idx % 4 === 0;
      else if (zoom < 5) visible = idx % 2 === 0;
      entry.marker.setOpacity(visible ? 1 : 0);
    });
  }, [map]);

  // ── Main subscription ─────────────────────────────────────
  useEffect(() => {
    map.on('zoomend', updateDensity);

    // ── Map background click → dismiss preview ─────────────────
    // IMPORTANT: On iOS, L.Map.Tap fires a synthetic 'click' on
    // the marker element which bubbles up here.  We must NOT call
    // dismissPreview() for those — it would immediately undo the
    // selection made in the marker click handler above.
    map.on('click', (e) => {
      if (e.originalEvent?.target?.closest?.('.aircraft-marker')) return;
      dismissPreview();
    });

    const unsub = flightService.subscribe((flights) => {
      const markers = markersRef.current;
      const selId   = selectedIdRef.current;

      // Remove stale markers
      const incomingIds = new Set(flights.map((f) => f.id));
      markers.forEach((_, id) => { if (!incomingIds.has(id)) removeMarker(id); });

      flights.forEach((flight) => {
        if (!markers.has(flight.id)) addMarker(flight);

        const entry = markers.get(flight.id);
        if (!entry) return;

        entry.flight = flight;
        entry.marker.setLatLng([flight.lat, flight.lng]);

        const isSel = selId === flight.id;

        // Fast path: rotate in-place via DOM
        if (!entry.rotEl) {
          const el = entry.marker.getElement();
          if (el) entry.rotEl = el.querySelector('[data-plane-rot]');
        }
        if (entry.rotEl) entry.rotEl.style.transform = `rotate(${flight.heading}deg)`;

        // Slow path: full icon rebuild on selection change
        if (isSel !== entry.lastSel) {
          entry.lastSel   = isSel;
          entry.rotEl     = null;
          entry.previewed = false;
          const isTracked = trackedIdsRef.current.has(flight.id);
          entry.marker.setIcon(createIcon(flight.heading, isSel, false, false, isTracked));
          entry.marker.setZIndexOffset(isSel ? 1000 : 0);
        }

        // Keep selected flight trail live
        if (isSel && trailRef.current) {
          trailRef.current.setLatLngs(flight.trail.map((p) => [p.lat, p.lng]));
        }

        // Drag preview popup with the aircraft
        if (pendingPreviewRef.current?.id === flight.id) {
          try { pendingPreviewRef.current.popup.setLatLng([flight.lat, flight.lng]); } catch { /**/ }
        }
      });
    });

    return () => {
      unsub();
      map.off('zoomend', updateDensity);
      map.off('click');
      markersRef.current.forEach(({ marker }) => marker.remove());
      markersRef.current.clear();
      if (trailRef.current) { trailRef.current.remove(); trailRef.current = null; }
      _safeRemovePopup(pendingPreviewRef.current?.popup);
      pendingPreviewRef.current = null;
    };
  }, [map, addMarker, removeMarker, updateDensity, dismissPreview]);

  return null;
}
