import { useState, useCallback, useEffect, useRef } from 'react';
import { MapView }           from './map/MapView';
import { TopBar }            from './components/TopBar';
import { Sidebar }           from './components/Sidebar';
import { StatusBar }         from './components/StatusBar';
import { AlertsDashboard }   from './components/AlertsDashboard';
import { Onboarding, hasOnboarded } from './components/Onboarding';
import { InstallBanner }     from './components/InstallBanner';
import { flightService }     from './services/flightService';
import { getUserLocation, getCachedLocation } from './services/geoService';
import { openSkyService }    from './services/openSkyService';
import { notificationService } from './services/notificationService';

export default function App() {
  const [selectedFlightId, setSelectedFlightId] = useState(null);
  const [weatherEnabled,   setWeatherEnabled]   = useState(false);
  const [dayNightEnabled,  setDayNightEnabled]  = useState(false); // colourful day map by default
  const [airportsEnabled,  setAirportsEnabled]  = useState(true);
  const [heatmapEnabled,   setHeatmapEnabled]   = useState(false);
  const [routesEnabled,    setRoutesEnabled]    = useState(false);
  const [flyToFlightId,    setFlyToFlightId]    = useState(null);
  const [followFlightId,   setFollowFlightId]   = useState(null);
  const [flightCount,      setFlightCount]      = useState(flightService.flights.length);
  const [dataSource,       setDataSource]       = useState('loading');
  const [geoLocation,      setGeoLocation]      = useState(() => {
    const loc = getCachedLocation();
    if (loc) openSkyService.preFetchLocation(loc.lat, loc.lng, 50);
    return loc;
  });
  const [alertsOpen,       setAlertsOpen]       = useState(false);
  const [alertsCount,      setAlertsCount]      = useState(0);
  // Onboarding: show once per install (localStorage flag)
  const [showOnboarding,   setShowOnboarding]   = useState(() => !hasOnboarded());
  // In-app notification toast (fallback for iOS Safari / no push permission)
  const [toast,            setToast]            = useState(null);
  const toastTimer                              = useRef(null);

  // ── Service lifecycle ────────────────────────────────────
  useEffect(() => {
    flightService.start();
    return () => flightService.stop();
  }, []);

  useEffect(() => {
    getUserLocation().then((loc) => {
      if (!loc) return;
      openSkyService.preFetchLocation(loc.lat, loc.lng, 50);
      setGeoLocation(loc);
    });
  }, []);

  useEffect(() => {
    return notificationService.subscribeToChanges((list) => setAlertsCount(list.length));
  }, []);

  // In-app toast — shown when system notifications are unavailable
  // (iOS Safari browser, permission denied, or SW failure).
  useEffect(() => {
    return notificationService.subscribeToInApp(({ title, body }) => {
      setToast({ title, body });
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 4500);
    });
  }, []);

  useEffect(() => {
    const unsub = flightService.subscribe((flights) => {
      setFlightCount(flights.length);
      setDataSource(flightService.dataSource);
    });
    return unsub;
  }, []);

  // ── Handlers ─────────────────────────────────────────────
  const handleFlightSelect   = useCallback((flight) => setSelectedFlightId(flight.id), []);
  const handleSidebarClose   = useCallback(() => { setSelectedFlightId(null); setFollowFlightId(null); }, []);
  const handleFlyTo          = useCallback((flightId) => {
    setFlyToFlightId(null);
    requestAnimationFrame(() => setFlyToFlightId(flightId));
  }, []);
  const handleToggleFollow   = useCallback((flightId) => {
    setFollowFlightId((prev) => (prev === flightId ? null : flightId));
  }, []);
  const handleToggleWeather  = useCallback(() => setWeatherEnabled((v) => !v),  []);
  const handleToggleDayNight = useCallback(() => setDayNightEnabled((v) => !v), []);
  const handleToggleAirports = useCallback(() => setAirportsEnabled((v) => !v), []);
  const handleToggleHeatmap  = useCallback(() => setHeatmapEnabled((v) => !v),  []);
  const handleToggleRoutes   = useCallback(() => setRoutesEnabled((v) => !v),   []);
  const handleToggleAlerts   = useCallback(() => setAlertsOpen((v) => !v),      []);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      {/* ── Map ──────────────────────────────────────────── */}
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

      {/* ── Top bar ──────────────────────────────────────── */}
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

      {/* ── Flight detail sidebar ─────────────────────────── */}
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

      {/* ── Alerts dashboard ─────────────────────────────── */}
      {alertsOpen && (
        <AlertsDashboard onClose={handleToggleAlerts} />
      )}

      {/* ── Status bar ───────────────────────────────────── */}
      <StatusBar flightCount={flightCount} dataSource={dataSource} />

      {/* ── Live data failure banner ─────────────────────── */}
      {dataSource === 'unavailable' && (
        <div
          style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)', zIndex: 1200, pointerEvents: 'none',
          }}
        >
          <div
            className="glass rounded-2xl px-6 py-4 flex flex-col items-center gap-2 text-center"
            style={{ border: '1px solid rgba(239,68,68,0.3)' }}
          >
            <span style={{ fontSize: 28 }}>⚠</span>
            <p className="text-sm font-semibold text-red-400">Live data unavailable</p>
            <p className="text-xs text-white/40">
              ADS-B feed could not be reached.<br />Retrying automatically…
            </p>
          </div>
        </div>
      )}

      {/* ── First-run onboarding ──────────────────────────── */}
      {showOnboarding && (
        <Onboarding onComplete={() => setShowOnboarding(false)} />
      )}

      {/* ── PWA install banner (Android + iOS) ───────────── */}
      {!showOnboarding && <InstallBanner />}

      {/* ── In-app notification toast ────────────────────── */}
      {/* Fallback for iOS Safari / push not granted          */}
      {toast && (
        <div className="in-app-toast" role="alert" aria-live="polite">
          <span className="in-app-toast-icon">✈️</span>
          <div className="in-app-toast-text">
            <div className="in-app-toast-title">{toast.title}</div>
            <div className="in-app-toast-body">{toast.body}</div>
          </div>
          <button
            className="in-app-toast-close"
            onClick={() => { clearTimeout(toastTimer.current); setToast(null); }}
            aria-label="Dismiss"
          >×</button>
        </div>
      )}

      {/* ── Mobile-only floating donate button ───────────── */}
      {/* position:fixed so it CANNOT be clipped by the App root's
          overflow:hidden — critical for iOS PWA standalone mode
          where absolute children fall outside the clipping rect.  */}
      <div className="sm:hidden" style={{ position: 'fixed', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 40px)', right: 14, zIndex: 1100, pointerEvents: 'auto' }}>
        <a
          href="https://donate.stripe.com/8x27sMaIf3Cm5O0gFEc7u00"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '10px 14px',
            borderRadius: 14,
            background: 'linear-gradient(135deg, #00ffcc 0%, #10b981 100%)',
            color: '#000',
            fontSize: 12,
            fontWeight: 700,
            textDecoration: 'none',
            boxShadow: '0 0 20px rgba(0,255,204,0.4), 0 4px 16px rgba(0,0,0,0.35)',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontSize: 14 }}>✈️</span>
          <span>Support</span>
        </a>
      </div>
    </div>
  );
}
