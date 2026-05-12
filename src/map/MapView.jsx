import { useEffect, useRef } from 'react';
import { MapContainer, Pane, TileLayer, useMap } from 'react-leaflet';
import { FlightLayer }          from './FlightLayer';
import { WeatherLayer }         from './WeatherLayer';
import { DayNightLayer }        from './DayNightLayer';
import { AirportLayer }         from './AirportLayer';
import { ActivityHeatmapLayer } from './ActivityHeatmapLayer';
import { BusyRoutesLayer }      from './BusyRoutesLayer';
import { DelayHeatmapLayer }    from './DelayHeatmapLayer';
import { TILE_LAYERS, MAP_DEFAULTS, FLY_TO_ZOOM } from '../services/mapService';
import { LOCATION_ZOOM }  from '../services/geoService';
import { flightService }  from '../services/flightService';
import { openSkyService } from '../services/openSkyService';

// ── BoundsSync ────────────────────────────────────────────
// Tells openSkyService the current viewport so it can filter
// the OpenSky API request to only visible airspace.
function BoundsSync() {
  const map = useMap();

  useEffect(() => {
    function sync() {
      const b = map.getBounds();
      openSkyService.setBounds({
        lamin: b.getSouth(),
        lomin: b.getWest(),
        lamax: b.getNorth(),
        lomax: b.getEast(),
      });
    }
    map.on('moveend', sync);
    map.on('zoomend', sync);
    sync();
    return () => {
      map.off('moveend', sync);
      map.off('zoomend', sync);
    };
  }, [map]);

  return null;
}

// ── MapView ───────────────────────────────────────────────
export function MapView({
  selectedFlightId,
  onFlightSelect,
  weatherEnabled,
  dayNightEnabled,
  airportsEnabled,
  heatmapEnabled,
  routesEnabled,
  delayHeatmapEnabled,
  detailedMapEnabled,
  flyToFlightId,
  searchFocusFlightId,
  followFlightId,
  followPaused,
  onFollowPausedChange,
  flyToCenter,
  initialCenter,
  sidebarOpen,
}) {
  const mapRef         = useRef(null);
  const geoApplied     = useRef(false);
  const sidebarOpenRef = useRef(sidebarOpen);
  const resumeTimerRef = useRef(null);

  // Keep sidebarOpen ref in sync without re-running fly-to effects
  useEffect(() => { sidebarOpenRef.current = sidebarOpen; }, [sidebarOpen]);

  // ── Geolocation initial center (fires once) ────────────
  useEffect(() => {
    if (!initialCenter || !mapRef.current || geoApplied.current) return;
    geoApplied.current = true;
    mapRef.current.flyTo(
      [initialCenter.lat, initialCenter.lng],
      LOCATION_ZOOM,
      { duration: 1.5, easeLinearity: 0.25 }
    );
  }, [initialCenter]);

  // ── Logo tap: fly to user location (re-triggerable) ───
  useEffect(() => {
    if (!flyToCenter || !mapRef.current) return;
    const lat = Number(flyToCenter.lat);
    const lng = Number(flyToCenter.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    mapRef.current.flyTo(
      [lat, lng],
      LOCATION_ZOOM,
      { duration: 1.5, easeLinearity: 0.25 }
    );
  }, [flyToCenter]);

  // ── One-shot fly-to (with panel offset) ───────────────
  useEffect(() => {
    if (!flyToFlightId || !mapRef.current) return;
    const flight = flightService.getFlight(flyToFlightId);
    if (!flight) return;
    const map = mapRef.current;

    map.flyTo([flight.lat, flight.lng], FLY_TO_ZOOM, {
      duration:      1.2,
      easeLinearity: 0.25,
    });

    // After animation completes, nudge the map so the aircraft isn't
    // hidden behind the open sidebar panel.
    map.once('moveend', () => {
      if (!sidebarOpenRef.current) return;
      const isMobile = window.innerWidth < 640;
      // Desktop: sidebar is 320 px on the right → shift map right by ~160 px
      //          so the aircraft sits in the visible left area.
      // Mobile:  sidebar is a bottom sheet (≤60dvh) → shift up by ~100 px.
      map.panBy(
        isMobile ? [0, -100] : [160, 0],
        { animate: true, duration: 0.35, easeLinearity: 0.5 }
      );
    });
  }, [flyToFlightId]); // sidebarOpen consumed via ref — intentionally not in deps

  // Search focus: preserve map context, avoid sidebar offset, and zoom gently.
  useEffect(() => {
    if (!searchFocusFlightId || !mapRef.current) return;
    const flight = flightService.getFlight(searchFocusFlightId);
    if (!flight) return;

    const map = mapRef.current;
    const currentZoom = map.getZoom();
    const targetZoom = Math.max(8, Math.min(10, currentZoom));

    map.flyTo([flight.lat, flight.lng], targetZoom, {
      duration: 0.9,
      easeLinearity: 0.3,
      noMoveStart: true,
    });
  }, [searchFocusFlightId]);

  // ── Follow mode: pan every 2 s while active ────────────
  useEffect(() => {
    if (!followFlightId || followPaused) return;
    if (!mapRef.current) return;
    let lastPan = 0;

    const unsub = flightService.subscribe((flights) => {
      if (!mapRef.current) return;
      const now = Date.now();
      if (now - lastPan < 2000) return;
      const f = flights.find((x) => x.id === followFlightId);
      if (!f) return;
      lastPan = now;
      mapRef.current.panTo([f.lat, f.lng], {
        animate:      true,
        duration:     1.8,
        easeLinearity: 0.5,
        noMoveStart:  true,
      });
    });

    return unsub;
  }, [followFlightId, followPaused]);

  // ── Pause follow panning on user map interaction ───────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !followFlightId) return;
    if (typeof onFollowPausedChange !== 'function') return;

    const FOLLOW_RESUME_AFTER_MS = 10_000;

    const pauseFromUserGesture = (e) => {
      // If this is a programmatic movement, Leaflet won't include an originalEvent.
      // We only pause for genuine user gestures.
      if (!e?.originalEvent) return;
      onFollowPausedChange(true);
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = setTimeout(() => {
        onFollowPausedChange(false);
      }, FOLLOW_RESUME_AFTER_MS);
    };

    map.on('dragstart', pauseFromUserGesture);
    map.on('zoomstart', pauseFromUserGesture);

    return () => {
      map.off('dragstart', pauseFromUserGesture);
      map.off('zoomstart', pauseFromUserGesture);
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    };
  }, [followFlightId, onFollowPausedChange]);

  // If we have a cached/resolved geolocation, mount the map there at street
  // zoom so that BoundsSync sends a local bbox on its very first sync() call.
  // Without this, the map mounts at zoom 3 over the mid-Atlantic and the
  // first ADS-B fetch covers a 500 nm global radius.
  const mountCenter = initialCenter
    ? [initialCenter.lat, initialCenter.lng]
    : MAP_DEFAULTS.center;
  const mountZoom = initialCenter ? LOCATION_ZOOM : MAP_DEFAULTS.zoom;

  return (
    <MapContainer
      center={mountCenter}
      zoom={mountZoom}
      minZoom={MAP_DEFAULTS.minZoom}
      maxZoom={MAP_DEFAULTS.maxZoom}
      style={{ width: '100%', height: '100%' }}
      zoomControl={true}
      zoomAnimation={true}
      ref={mapRef}
      worldCopyJump={true}
    >
      {/* Base tile layer — three-way swap:
            • detailedMapEnabled  → Esri World Imagery (satellite)
            • dayNightEnabled     → CartoDB dark
            • else                → CartoDB Voyager (day)
          The labels layer below sits in its own pane on top, so we keep
          place names readable regardless of which base is active. */}
      <TileLayer
        key={
          detailedMapEnabled ? 'detailed' :
          dayNightEnabled    ? 'dark'     : 'light'
        }
        url={
          detailedMapEnabled ? TILE_LAYERS.detailed.url :
          dayNightEnabled    ? TILE_LAYERS.dark.url     : TILE_LAYERS.light.url
        }
        attribution={
          detailedMapEnabled ? TILE_LAYERS.detailed.attribution :
          dayNightEnabled    ? TILE_LAYERS.dark.attribution     : TILE_LAYERS.light.attribution
        }
        maxZoom={
          detailedMapEnabled ? TILE_LAYERS.detailed.maxZoom : TILE_LAYERS.dark.maxZoom
        }
        subdomains={
          detailedMapEnabled ? TILE_LAYERS.detailed.subdomains : TILE_LAYERS.dark.subdomains
        }
      />

      {/* Labels-only tile layer so ocean/sea/place names stay readable.
          When the detailed satellite base is on we still show labels so
          users can identify cities; we use the dark labels variant since
          they stand out best over imagery. */}
      <Pane name="map-labels" style={{ zIndex: 360, pointerEvents: 'none' }}>
        <TileLayer
          key={
            detailedMapEnabled ? 'detailed-labels' :
            dayNightEnabled    ? 'dark-labels'     : 'light-labels'
          }
          url={
            detailedMapEnabled || dayNightEnabled
              ? TILE_LAYERS.dark.labelsUrl
              : TILE_LAYERS.light.labelsUrl
          }
          attribution={dayNightEnabled ? TILE_LAYERS.dark.attribution : TILE_LAYERS.light.attribution}
          maxZoom={TILE_LAYERS.dark.maxZoom}
          subdomains={TILE_LAYERS.dark.subdomains}
          pane="map-labels"
          opacity={detailedMapEnabled ? 0.85 : 0.95}
        />
      </Pane>

      {/* Sync viewport bounds → openSkyService for bbox filtering */}
      <BoundsSync />

      {/* Day / Night terminator */}
      <DayNightLayer enabled={dayNightEnabled} />

      {/* Weather overlay — proper raster tile layer */}
      <WeatherLayer enabled={weatherEnabled} dayNightEnabled={dayNightEnabled} />

      {/* Airport activity heatmap — soft glow circles, below markers */}
      <ActivityHeatmapLayer enabled={heatmapEnabled} />

      {/* Delay heatmap — green/amber/red tints per airport */}
      <DelayHeatmapLayer enabled={delayHeatmapEnabled} />

      {/* Airport intelligence markers */}
      <AirportLayer enabled={airportsEnabled} />

      {/* Selected + tracked route arcs — drawn above heatmap, below
          aircraft. Now scoped to the user's selection / tracked list
          rather than a global "busy routes" projection. */}
      <BusyRoutesLayer enabled={routesEnabled} selectedFlightId={selectedFlightId} />

      {/* Aircraft markers (imperative, 60 fps).
          followFlightId is passed so that even when the user
          clicks the "Flight Route" button (which closes the
          card) the route + trail polylines stay drawn for the
          flight they're following. */}
      <FlightLayer
        selectedFlightId={selectedFlightId}
        followFlightId={followFlightId}
        onFlightSelect={onFlightSelect}
      />
    </MapContainer>
  );
}
