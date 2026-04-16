import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Search, Cloud, CloudOff, Sun, Building2, X, Flame, GitBranch, Bell, Layers,
} from 'lucide-react';
import { flightService } from '../services/flightService';
import { airportService } from '../services/airportService';
import logoSrc from '../assets/flightmapr-logo.png';

function LiveDot() {
  return (
    <span className="relative inline-flex items-center">
      <span className="w-2 h-2 rounded-full bg-[#00ffcc] blink-dot" />
      <span className="absolute inset-0 w-2 h-2 rounded-full bg-[#00ffcc] ping-ring" />
    </span>
  );
}

function FlightSearchResult({ flight, onSelect }) {
  return (
    <button
      onClick={() => onSelect(flight)}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 active:bg-white/8 transition-colors text-left"
    >
      <div className="w-9 h-9 rounded-xl bg-[#00ffcc]/10 flex items-center justify-center flex-shrink-0">
        <span className="text-sm font-bold text-[#00ffcc]">✈</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-bold text-white" style={{ fontSize: 15 }}>{flight.callsign}</span>
          <span className="text-xs text-white/40 truncate">{flight.airline}</span>
        </div>
        <div className="text-xs text-white/50 mt-0.5 flex items-center gap-1">
          <span className="font-semibold text-white/70">{flight.origin.code}</span>
          <span className="text-[#00ffcc]">→</span>
          <span className="font-semibold text-white/70">{flight.destination.code}</span>
          <span className="text-white/25 mx-0.5">·</span>
          <span className="truncate">{flight.origin.city}</span>
        </div>
      </div>
    </button>
  );
}

function AirportSearchResult({ airport, onSelect }) {
  return (
    <button
      onClick={() => onSelect(airport)}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 active:bg-white/8 transition-colors text-left"
    >
      <div className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center flex-shrink-0">
        <Building2 size={15} className="text-[#00ffcc]" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-bold text-white" style={{ fontSize: 15 }}>{airport.code}</span>
          <span className="text-xs text-white/40 truncate">{airport.city}</span>
        </div>
        <div className="text-xs text-white/50 mt-0.5 truncate">{airport.name}</div>
      </div>
    </button>
  );
}

function SearchEntry({ item, onFlightSelect, onAirportSelect }) {
  if (item.type === 'airport') {
    return <AirportSearchResult airport={item.airport} onSelect={onAirportSelect} />;
  }
  return <FlightSearchResult flight={item.flight} onSelect={onFlightSelect} />;
}

function LayerRow({ icon, label, enabled, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center gap-3 px-4 py-3 transition-colors ${
        enabled ? 'bg-[#00ffcc]/8' : 'hover:bg-white/4'
      }`}
    >
      <span className={enabled ? 'text-[#00ffcc]' : 'text-white/45'}>{icon}</span>
      <span className={`text-sm font-medium flex-1 text-left ${enabled ? 'text-[#00ffcc]' : 'text-white/60'}`}>
        {label}
      </span>
      <span
        className={`w-8 h-4 rounded-full transition-colors relative flex-shrink-0 ${
          enabled ? 'bg-[#00ffcc]' : 'bg-white/15'
        }`}
      >
        <span
          className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
            enabled ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  );
}

export function EnhancedTopBar({
  weatherEnabled, dayNightEnabled, airportsEnabled, heatmapEnabled, routesEnabled,
  onToggleWeather, onToggleDayNight, onToggleAirports, onToggleHeatmap, onToggleRoutes,
  onFlightSelect, onAirportSelect, onFlyTo,
  totalFlights, dataSource,
  alertsCount, onToggleAlerts,
  onLogoClick,
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [focused, setFocused] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [logoPulse, setLogoPulse] = useState(false);

  const inputRef = useRef(null);
  const mobileInputRef = useRef(null);
  const dropRef = useRef(null);
  const layersRef = useRef(null);

  useEffect(() => {
    if (query.length < 1) {
      setResults([]);
      return;
    }

    const flightResults = flightService.search(query).map((flight) => ({
      type: 'flight',
      id: `flight:${flight.id}`,
      flight,
    }));
    const airportResults = airportService.searchAirports(query).map((airport) => ({
      type: 'airport',
      id: `airport:${airport.code}`,
      airport,
    }));

    setResults([...flightResults, ...airportResults].slice(0, 10));
  }, [query]);

  useEffect(() => {
    if (!searchOpen) return;
    const t = setTimeout(() => mobileInputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [searchOpen]);

  useEffect(() => {
    function handler(e) {
      if (
        dropRef.current && !dropRef.current.contains(e.target) &&
        inputRef.current && !inputRef.current.contains(e.target)
      ) setFocused(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!layersOpen) return;
    function handler(e) {
      if (layersRef.current && !layersRef.current.contains(e.target)) {
        setLayersOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [layersOpen]);

  const resetSearch = useCallback(() => {
    setQuery('');
    setResults([]);
    setFocused(false);
  }, []);

  const handleFlightPick = useCallback((flight) => {
    resetSearch();
    onFlightSelect(flight);
    onFlyTo(flight.id);
  }, [onFlightSelect, onFlyTo, resetSearch]);

  const handleAirportPick = useCallback((airport) => {
    resetSearch();
    onAirportSelect(airport);
  }, [onAirportSelect, resetSearch]);

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    inputRef.current?.focus() || mobileInputRef.current?.focus();
  };

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery('');
    setResults([]);
  }, []);

  const handleMobileFlightPick = useCallback((flight) => {
    closeSearch();
    handleFlightPick(flight);
  }, [closeSearch, handleFlightPick]);

  const handleMobileAirportPick = useCallback((airport) => {
    closeSearch();
    handleAirportPick(airport);
  }, [closeSearch, handleAirportPick]);

  const handleLogoTap = useCallback(() => {
    setLogoPulse(true);
    setTimeout(() => setLogoPulse(false), 500);
    onLogoClick?.();
  }, [onLogoClick]);

  const showDrop = focused && results.length > 0;
  const isLive = dataSource === 'live';
  const activeLayerCount = [weatherEnabled, dayNightEnabled, airportsEnabled, heatmapEnabled, routesEnabled]
    .filter(Boolean).length;

  return (
    <>
      {searchOpen && (
        <div className="mobile-search-overlay sm:hidden">
          <div className="mobile-search-bar">
            <Search size={18} className="text-white/40 flex-shrink-0" />
            <input
              ref={mobileInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search flight, airport, airline..."
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              style={{ fontSize: 16 }}
              className="flex-1 bg-transparent text-white placeholder-white/30 outline-none py-1"
            />
            {query ? (
              <button onClick={clearSearch} className="mobile-search-clear" aria-label="Clear">
                <X size={15} />
              </button>
            ) : null}
            <button onClick={closeSearch} className="mobile-search-cancel">
              Cancel
            </button>
          </div>

          <div className="mobile-search-results">
            {results.length > 0 ? (
              results.map((item) => (
                <SearchEntry
                  key={item.id}
                  item={item}
                  onFlightSelect={handleMobileFlightPick}
                  onAirportSelect={handleMobileAirportPick}
                />
              ))
            ) : query.length >= 1 ? (
              <div className="mobile-search-empty">
                <Search size={30} style={{ opacity: 0.2, marginBottom: 10 }} />
                <p>No flights or airports found for "{query}"</p>
              </div>
            ) : (
              <div className="mobile-search-empty">
                <Search size={30} style={{ opacity: 0.15, marginBottom: 10 }} />
                <p>Type a flight number, airport code, or airport name</p>
              </div>
            )}
          </div>
        </div>
      )}

      <header
        className="absolute top-0 left-0 right-0 z-[1000] flex items-center gap-2 px-3 py-3"
        style={{ pointerEvents: 'none' }}
      >
        <button
          onClick={handleLogoTap}
          className="glass rounded-2xl flex items-center gap-2 px-3 py-2.5 flex-shrink-0 transition-all active:scale-95 hover:bg-[#00ffcc]/5"
          style={{ pointerEvents: 'auto', cursor: 'pointer' }}
          aria-label="Reset map to my location"
          title="Reset map to my location"
        >
          <img
            src={logoSrc}
            alt="FlightMapr"
            draggable={false}
            className="w-7 h-7 object-contain flex-shrink-0"
            style={{
              filter: logoPulse
                ? 'drop-shadow(0 0 8px rgba(0,255,204,0.9))'
                : 'drop-shadow(0 0 4px rgba(0,255,204,0.45))',
              transition: 'filter 0.3s ease',
            }}
          />
          <div className="hidden sm:block">
            <div className="text-sm font-bold tracking-tight leading-none text-white">
              Flight<span className="text-[#00ffcc]">Mapr</span>
            </div>
            <div className="text-[9px] text-white/35 tracking-widest uppercase leading-none mt-0.5">
              {isLive ? 'Live ADS-B' : 'Simulation'}
            </div>
          </div>
        </button>

        <button
          onClick={() => setSearchOpen(true)}
          className="flex-1 sm:hidden glass rounded-2xl flex items-center gap-2 px-3"
          style={{ height: 44, pointerEvents: 'auto' }}
          aria-label="Search flights or airports"
        >
          <Search size={15} className="text-white/35 flex-shrink-0" />
          <span className="text-sm text-white/28 truncate" style={{ color: 'rgba(255,255,255,0.28)' }}>
            Search flight or airport...
          </span>
        </button>

        <div className="hidden sm:block flex-1 min-w-0 relative" style={{ pointerEvents: 'auto' }}>
          <div className="glass rounded-2xl flex items-center gap-2 px-3 py-2.5">
            <Search size={15} className="text-white/35 flex-shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              placeholder="Search flight, airport, airline..."
              className="flex-1 bg-transparent text-sm text-white placeholder-white/25 outline-none min-w-0"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {query && (
              <button onClick={clearSearch} className="text-white/30 hover:text-white/60 transition-colors p-1 -mr-1 flex-shrink-0">
                <X size={13} />
              </button>
            )}
          </div>

          {showDrop && (
            <div
              ref={dropRef}
              className="absolute top-full left-0 right-0 mt-2 glass rounded-2xl overflow-hidden animate-slide-down"
              style={{ zIndex: 9999 }}
            >
              <div className="py-1 max-h-64 overflow-y-auto">
                {results.map((item) => (
                  <SearchEntry
                    key={item.id}
                    item={item}
                    onFlightSelect={handleFlightPick}
                    onAirportSelect={handleAirportPick}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0" style={{ pointerEvents: 'auto' }}>
          <div className="hidden sm:flex items-center gap-1.5">
            <button
              onClick={onToggleAirports}
              title={airportsEnabled ? 'Hide airports' : 'Show airports'}
              className={`glass rounded-2xl flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium transition-all ${
                airportsEnabled ? 'border-[#00ffcc]/30 text-[#00ffcc] bg-[#00ffcc]/8' : 'text-white/35 hover:text-white/60'
              }`}
            >
              <Building2 size={15} />
              <span className="hidden md:inline text-xs">Airports</span>
            </button>

            <button
              onClick={onToggleDayNight}
              title={dayNightEnabled ? 'Switch to day map' : 'Switch to night map'}
              className={`glass rounded-2xl flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium transition-all ${
                dayNightEnabled ? 'border-white/20 text-white/70 bg-white/5' : 'text-white/35 hover:text-white/60'
              }`}
            >
              <Sun size={15} />
              <span className="hidden md:inline text-xs">Night</span>
            </button>

            <button
              onClick={onToggleWeather}
              title={weatherEnabled ? 'Hide weather' : 'Show weather'}
              className={`glass rounded-2xl flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium transition-all ${
                weatherEnabled ? 'border-[#00ffcc]/40 text-[#00ffcc] bg-[#00ffcc]/10' : 'text-white/50 hover:text-white/80'
              }`}
            >
              {weatherEnabled ? <Cloud size={15} /> : <CloudOff size={15} />}
              <span className="hidden md:inline text-xs">Weather</span>
            </button>

            <button
              onClick={onToggleHeatmap}
              title={heatmapEnabled ? 'Hide heatmap' : 'Show heatmap'}
              className={`glass rounded-2xl flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium transition-all ${
                heatmapEnabled ? 'border-orange-400/40 text-orange-400 bg-orange-400/10' : 'text-white/35 hover:text-white/60'
              }`}
            >
              <Flame size={15} />
              <span className="hidden lg:inline text-xs">Heatmap</span>
            </button>

            <button
              onClick={onToggleRoutes}
              title={routesEnabled ? 'Hide routes' : 'Show routes'}
              className={`glass rounded-2xl flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium transition-all ${
                routesEnabled ? 'border-[#00ffcc]/40 text-[#00ffcc] bg-[#00ffcc]/10' : 'text-white/35 hover:text-white/60'
              }`}
            >
              <GitBranch size={15} />
              <span className="hidden lg:inline text-xs">Routes</span>
            </button>
          </div>

          <div ref={layersRef} className="relative sm:hidden">
            <button
              onClick={() => setLayersOpen((v) => !v)}
              className={`glass rounded-2xl flex items-center gap-1.5 px-2.5 py-2.5 text-sm font-medium transition-all ${
                layersOpen
                  ? 'border-[#00ffcc]/35 text-[#00ffcc] bg-[#00ffcc]/8'
                  : 'text-white/45 hover:text-white/70'
              }`}
              aria-label="Map layers"
            >
              <Layers size={16} />
              {activeLayerCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-[#00ffcc] text-black text-[9px] font-bold flex items-center justify-center leading-none">
                  {activeLayerCount}
                </span>
              )}
            </button>

            {layersOpen && (
              <div
                className="absolute top-full right-0 mt-2 glass rounded-2xl overflow-hidden animate-slide-down"
                style={{ zIndex: 9999, minWidth: 220 }}
              >
                <div className="px-4 py-2.5 border-b border-white/8">
                  <span className="text-[10px] uppercase tracking-widest text-white/35 font-semibold">Map Layers</span>
                </div>
                <LayerRow icon={<Building2 size={15} />} label="Airports" enabled={airportsEnabled} onToggle={onToggleAirports} />
                <LayerRow icon={<Sun size={15} />} label="Night Mode" enabled={dayNightEnabled} onToggle={onToggleDayNight} />
                <LayerRow icon={<Cloud size={15} />} label="Weather" enabled={weatherEnabled} onToggle={onToggleWeather} />
                <LayerRow icon={<Flame size={15} />} label="Heatmap" enabled={heatmapEnabled} onToggle={onToggleHeatmap} />
                <LayerRow icon={<GitBranch size={15} />} label="Busy Routes" enabled={routesEnabled} onToggle={onToggleRoutes} />
              </div>
            )}
          </div>

          {'Notification' in window && (
            <button
              onClick={onToggleAlerts}
              title="Flight Alerts"
              className={`glass rounded-2xl relative flex items-center gap-1.5 px-2.5 py-2.5 text-sm font-medium transition-all ${
                alertsCount > 0
                  ? 'border-amber-400/35 text-amber-400 bg-amber-400/8'
                  : 'text-white/35 hover:text-white/60'
              }`}
            >
              <Bell size={15} />
              {alertsCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-400 text-black text-[9px] font-bold flex items-center justify-center leading-none">
                  {alertsCount}
                </span>
              )}
            </button>
          )}

          <a
            href="https://donate.stripe.com/8x27sMaIf3Cm5O0gFEc7u00"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:flex items-center gap-1.5 px-3 py-2.5 rounded-2xl text-xs font-bold text-black whitespace-nowrap transition-all shadow-[0_0_16px_rgba(0,255,204,0.35)]"
            style={{ background: 'linear-gradient(135deg, #00ffcc 0%, #10b981 100%)', pointerEvents: 'auto' }}
          >
            <span className="text-sm leading-none">✈️</span>
            <span>Support FlightMapr</span>
          </a>

          <div className="glass rounded-2xl flex items-center gap-1.5 px-2.5 py-2.5">
            <LiveDot />
            <span className="text-xs font-semibold text-white/70 hidden sm:inline">
              {totalFlights.toLocaleString()}
            </span>
            {isLive && (
              <span className="text-[9px] font-bold text-red-400 uppercase tracking-wide hidden sm:inline">Live</span>
            )}
          </div>
        </div>
      </header>
    </>
  );
}
