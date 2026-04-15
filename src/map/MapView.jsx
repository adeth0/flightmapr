import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import { FlightLayer }          from './FlightLayer';
import { WeatherLayer }         from './WeatherLayer';
import { DayNightLayer }        from './DayNightLayer';
import { AirportLayer }         from './AirportLayer';
import { ActivityHeatmapLayer } from './ActivityHeatmapLayer';
import { BusyRoutesLayer }      from './BusyRoutesLayer';
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
  flyToFlightId,
  followFlightId,
  initialCenter,
  sidebarOpen,
}) {
  const mapRef         = useRef(null);
  const geoApplied     = useRef(false);
  const sidebarOpenRef = useRef(sidebarOpen);

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

  // ── Follow mode: pan every 2 s while active ────────────
  useEffect(() => {
    if (!followFlightId || !mapRef.current) return;
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
  }, [followFlightId]);

  return (
    <MapContainer
      center={MAP_DEFAULTS.center}
      zoom={MAP_DEFAULTS.zoom}
      minZoom={MAP_DEFAULTS.minZoom}
      maxZoom={MAP_DEFAULTS.maxZoom}
      style={{ width: '100%', height: '100%' }}
      zoomControl={true}
      zoomAnimation={true}
      ref={mapRef}
      worldCopyJump={true}
    >
      <TileLayer
        url={TILE_LAYERS.dark.url}
        attribution={TILE_LAYERS.dark.attribution}
        maxZoom={TILE_LAYERS.dark.maxZoom}
        subdomains={TILE_LAYERS.dark.subdomains}
      />

      {/* Sync viewport bounds → openSkyService for bbox filtering */}
      <BoundsSync />

      {/* Day / Night terminator */}
      <DayNightLayer enabled={dayNightEnabled} />

      {/* Weather overlay (RainViewer → canvas fallback) */}
      <WeatherLayer enabled={weatherEnabled} />

      {/* Airport activity heatmap — soft glow circles, below markers */}
      <ActivityHeatmapLayer enabled={heatmapEnabled} />

      {/* Airport intelligence markers */}
      <AirportLayer enabled={airportsEnabled} />

      {/* Busiest route arcs — drawn above heatmap, below aircraft */}
      <BusyRoutesLayer enabled={routesEnabled} />

      {/* Aircraft markers (imperative, 60 fps) */}
      <FlightLayer
        selectedFlightId={selectedFlightId}
        onFlightSelect={onFlightSelect}
      />
    </MapContainer>
  );
}
