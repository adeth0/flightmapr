import { useState, useCallback, useEffect } from 'react';
import { MapView }    from './map/MapView';
import { TopBar }     from './components/TopBar';
import { Sidebar }    from './components/Sidebar';
import { StatusBar }  from './components/StatusBar';
import { flightService } from './services/flightService';

export default function App() {
  const [selectedFlightId, setSelectedFlightId] = useState(null);
  const [weatherEnabled,   setWeatherEnabled]   = useState(false);
  const [dayNightEnabled,  setDayNightEnabled]  = useState(true);
  const [airportsEnabled,  setAirportsEnabled]  = useState(true);
  const [flyToFlightId,    setFlyToFlightId]    = useState(null);
  const [followFlightId,   setFollowFlightId]   = useState(null);
  const [flightCount,      setFlightCount]      = useState(flightService.flights.length);
  const [dataSource,       setDataSource]       = useState('sim');

  // Start simulation + OpenSky polling
  useEffect(() => {
    flightService.start();
    return () => flightService.stop();
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

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      <MapView
        selectedFlightId={selectedFlightId}
        onFlightSelect={handleFlightSelect}
        weatherEnabled={weatherEnabled}
        dayNightEnabled={dayNightEnabled}
        airportsEnabled={airportsEnabled}
        flyToFlightId={flyToFlightId}
        followFlightId={followFlightId}
      />

      <TopBar
        weatherEnabled={weatherEnabled}
        dayNightEnabled={dayNightEnabled}
        airportsEnabled={airportsEnabled}
        onToggleWeather={handleToggleWeather}
        onToggleDayNight={handleToggleDayNight}
        onToggleAirports={handleToggleAirports}
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

      <StatusBar flightCount={flightCount} dataSource={dataSource} />
    </div>
  );
}
