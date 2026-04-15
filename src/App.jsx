import { useState, useCallback, useEffect } from 'react';
import { MapView }           from './map/MapView';
import { TopBar }            from './components/TopBar';
import { Sidebar }           from './components/Sidebar';
import { StatusBar }         from './components/StatusBar';
import { AlertsDashboard }   from './components/AlertsDashboard';
import { flightService }     from './services/flightService';
import { getUserLocation, getCachedLocation } from './services/geoService';
import { openSkyService }    from './services/openSkyService';
import { notificationService } from './services/notificationService';

export default function App() {
  const [selectedFlightId, setSelectedFlightId] = useState(null);
  const [weatherEnabled,   setWeatherEnabled]   = useState(false);
  const [dayNightEnabled,  setDayNightEnabled]  = useState(true);
  const [airportsEnabled,  setAirportsEnabled]  = useState(true);
  const [heatmapEnabled,   setHeatmapEnabled]   = useState(false);
  const [routesEnabled,    setRoutesEnabled]    = useState(false);
  const [flyToFlightId,    setFlyToFlightId]    = useState(null);
  const [followFlightId,   setFollowFlightId]   = useState(null);
  const [flightCount,      setFlightCount]      = useState(flightService.flights.length);
  const [dataSource,       setDataSource]       = useState('loading');
  // getCachedLocation() is synchronous — returning users get instant geolocation.
  // We also pre-seed openSkyService with a 50 nm local bbox right here in the
  // state initialiser (runs before BoundsSync mounts) so the very first ADS-B
  // fetch targets the user's neighbourhood instead of a global viewport.
  const [geoLocation,      setGeoLocation]      = useState(() => {
    const loc = getCachedLocation();
    if (loc) openSkyService.preFetchLocation(loc.lat, loc.lng, 50);
    return loc;
  });
  const [alertsOpen,       setAlertsOpen]       = useState(false);
  const [alertsCount,      setAlertsCount]      = useState(0);

  // Start simulation + OpenSky polling
  useEffect(() => {
    flightService.start();
    return () => flightService.stop();
  }, []);

  // Request user location once on mount (non-blocking, no UI delay).
  // For new users (no cache), also pre-fetch the local 50 nm area as soon
  // as geolocation resolves — before the flyTo animation fires BoundsSync.
  useEffect(() => {
    getUserLocation().then((loc) => {
      if (!loc) return;
      openSkyService.preFetchLocation(loc.lat, loc.lng, 50);
      setGeoLocation(loc);
    });
  }, []);

  // Keep alertsCount badge in sync with tracked-flight list
  useEffect(() => {
    return notificationService.subscribeToChanges((list) => setAlertsCount(list.length));
  }, []);

  // Mirror live flight count and data-source label
  useEffect(() => {
    const unsub = flightService.subscribe((flights) => {
      setFlightCount(flights.length);
      setDataSource(flightService.dataSource);
    });
    return unsub;
  }, []);

  const handleFlightSelect = useCallback((flight) => {
    setSelectedFlightId(flight.id);
  }, []);

  const handleSidebarClose = useCallback(() => {
    setSelectedFlightId(null);
    setFollowFlightId(null);
  }, []);

  const handleFlyTo = useCallback((flightId) => {
    setFlyToFlightId(null);
    requestAnimationFrame(() => setFlyToFlightId(flightId));
  }, []);

  const handleToggleFollow = useCallback((flightId) => {
    setFollowFlightId((prev) => (prev === flightId ? null : flightId));
  }, []);

  const handleToggleWeather   = useCallback(() => setWeatherEnabled((v) => !v),  []);
  const handleToggleDayNight  = useCallback(() => setDayNightEnabled((v) => !v), []);
  const handleToggleAirports  = useCallback(() => setAirportsEnabled((v) => !v), []);
  const handleToggleHeatmap   = useCallback(() => setHeatmapEnabled((v) => !v),  []);
  const handleToggleRoutes    = useCallback(() => setRoutesEnabled((v) => !v),   []);
  const handleToggleAlerts    = useCallback(() => setAlertsOpen((v) => !v),      []);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      <MapView
        selectedFlightId={selectedFlightId}
        onFlightSelect={handleFlightSelect}
        weatherEnabled={weatherEnabled}
        dayNightEnabled={dayNightEnabled}
        airportsEnabled={airportsEnabled}
        heatmapEnabled={heatmapEnabled}
        routesEnabled={routesEnabled}
        flyToFlightId={flyToFlightId}
        followFlightId={followFlightId}
        initialCenter={geoLocation}
        sidebarOpen={!!selectedFlightId}
      />

      <TopBar
        weatherEnabled={weatherEnabled}
        dayNightEnabled={dayNightEnabled}
        airportsEnabled={airportsEnabled}
        heatmapEnabled={heatmapEnabled}
        routesEnabled={routesEnabled}
        onToggleWeather={handleToggleWeather}
        onToggleDayNight={handleToggleDayNight}
        onToggleAirports={handleToggleAirports}
        onToggleHeatmap={handleToggleHeatmap}
        onToggleRoutes={handleToggleRoutes}
        alertsCount={alertsCount}
        onToggleAlerts={handleToggleAlerts}
        onFlightSelect={handleFlightSelect}
        onFlyTo={handleFlyTo}
        totalFlights={flightCount}
        dataSource={dataSource}
      />

      {selectedFlightId && (
        <Sidebar
          key={selectedFlightId}
          flightId={selectedFlightId}
          isFollowing={followFlightId === selectedFlightId}
          onClose={handleSidebarClose}
          onCenterMap={handleFlyTo}
          onToggleFollow={handleToggleFollow}
        />
      )}

      {alertsOpen && (
        <AlertsDashboard onClose={handleToggleAlerts} />
      )}

      <StatusBar flightCount={flightCount} dataSource={dataSource} />

      {/* "Live data unavailable" overlay — only shown after API failure */}
      {dataSource === 'unavailable' && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 1200,
            pointerEvents: 'none',
          }}
        >
          <div
            className="glass rounded-2xl px-6 py-4 flex flex-col items-center gap-2 text-center"
            style={{ border: '1px solid rgba(239,68,68,0.3)' }}
          >
            <span style={{ fontSize: 28 }}>⚠</span>
            <p className="text-sm font-semibold text-red-400">Live data unavailable</p>
            <p className="text-xs text-white/40">OpenSky Network could not be reached.<br />Retrying automatically…</p>
          </div>
        </div>
      )}
    </div>
  );
}
