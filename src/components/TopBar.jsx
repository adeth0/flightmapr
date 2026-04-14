import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Cloud, CloudOff, Sun, Building2, X } from 'lucide-react';
import { flightService } from '../services/flightService';

function LiveDot() {
  return (
    <span className="relative inline-flex items-center">
      <span className="w-2 h-2 rounded-full bg-[#00ffcc] blink-dot" />
      <span className="absolute inset-0 w-2 h-2 rounded-full bg-[#00ffcc] ping-ring" />
    </span>
  );
}

function SearchResult({ flight, onSelect }) {
  return (
    <button
      onClick={() => onSelect(flight)}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left group"
    >
      <div className="w-8 h-8 rounded-lg bg-[#00ffcc]/10 flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-bold text-[#00ffcc]">✈</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold text-white">{flight.callsign}</span>
          <span className="text-xs text-white/40 truncate">{flight.airline}</span>
        </div>
        <div className="text-xs text-white/50 mt-0.5">
          <span className="font-medium text-white/70">{flight.origin.code}</span>
          <span className="mx-1.5 text-[#00ffcc]">→</span>
          <span className="font-medium text-white/70">{flight.destination.code}</span>
          <span className="mx-1.5 text-white/30">·</span>
          {flight.origin.city}
        </div>
      </div>
    </button>
  );
}

export function TopBar({
  weatherEnabled, dayNightEnabled, airportsEnabled,
  onToggleWeather, onToggleDayNight, onToggleAirports,
  onFlightSelect, onFlyTo,
  totalFlights, dataSource,
}) {
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState([]);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);
  const dropRef  = useRef(null);

  useEffect(() => {
    if (query.length < 1) { setResults([]); return; }
    setResults(flightService.search(query));
  }, [query]);

  useEffect(() => {
    function handler(e) {
      if (
        dropRef.current  && !dropRef.current.contains(e.target) &&
        inputRef.current && !inputRef.current.contains(e.target)
      ) setFocused(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = useCallback((flight) => {
    setQuery(''); setResults([]); setFocused(false);
    onFlightSelect(flight);
    onFlyTo(flight.id);
  }, [onFlightSelect, onFlyTo]);

  const clearSearch = () => { setQuery(''); setResults([]); inputRef.current?.focus(); };
  const showDrop    = focused && results.length > 0;

  const isLive = dataSource === 'live';

  return (
    <header
      className="absolute top-0 left-0 right-0 z-[1000] flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3"
      style={{ pointerEvents: 'none' }}
    >
      {/* ── Logo ─────────────────────────────────────── */}
      <div
        className="glass rounded-2xl flex items-center gap-2 sm:gap-2.5 px-3 sm:px-4 py-2.5 flex-shrink-0"
        style={{ pointerEvents: 'auto' }}
      >
        <div className="relative w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center">
          <div className="absolute inset-0 rounded-lg bg-[#00ffcc]/20" />
          <span className="relative text-sm sm:text-base leading-none">✈</span>
        </div>
        <div className="hidden sm:block">
          <div className="text-sm font-bold tracking-tight leading-none text-white">
            Flight<span className="text-[#00ffcc]">Mapr</span>
          </div>
          <div className="text-[9px] text-white/35 tracking-widest uppercase leading-none mt-0.5">
            {isLive ? 'Live ADS-B' : 'Simulation'}
          </div>
        </div>
      </div>

      {/* ── Search ───────────────────────────────────── */}
      <div className="flex-1 max-w-md relative" style={{ pointerEvents: 'auto' }}>
        <div className="glass rounded-2xl flex items-center gap-2 px-3 py-2.5">
          <Search size={15} className="text-white/35 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            placeholder="Search flight, airline, airport…"
            className="flex-1 bg-transparent text-sm text-white placeholder-white/25 outline-none min-w-0"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {query && (
            <button onClick={clearSearch} className="text-white/30 hover:text-white/60 transition-colors p-1 -mr-1">
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
            <div className="py-1 max-h-72 overflow-y-auto">
              {results.map((f) => (
                <SearchResult key={f.id} flight={f} onSelect={handleSelect} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Controls ─────────────────────────────────── */}
      <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0" style={{ pointerEvents: 'auto' }}>
        {/* Airport markers toggle */}
        <button
          onClick={onToggleAirports}
          title={airportsEnabled ? 'Hide airports' : 'Show airports'}
          className={`glass rounded-2xl flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-2.5 text-sm font-medium transition-all ${
            airportsEnabled
              ? 'border-[#00ffcc]/30 text-[#00ffcc] bg-[#00ffcc]/8'
              : 'text-white/35 hover:text-white/60'
          }`}
        >
          <Building2 size={15} />
          <span className="hidden md:inline text-xs">Airports</span>
        </button>

        {/* Day / Night toggle */}
        <button
          onClick={onToggleDayNight}
          title={dayNightEnabled ? 'Hide day/night' : 'Show day/night'}
          className={`glass rounded-2xl flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-2.5 text-sm font-medium transition-all ${
            dayNightEnabled
              ? 'border-white/20 text-white/70 bg-white/5'
              : 'text-white/35 hover:text-white/60'
          }`}
        >
          <Sun size={15} />
          <span className="hidden md:inline text-xs">Day/Night</span>
        </button>

        {/* Weather toggle */}
        <button
          onClick={onToggleWeather}
          title={weatherEnabled ? 'Hide weather' : 'Show weather'}
          className={`glass rounded-2xl flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-2.5 text-sm font-medium transition-all ${
            weatherEnabled
              ? 'border-[#00ffcc]/40 text-[#00ffcc] bg-[#00ffcc]/10'
              : 'text-white/50 hover:text-white/80'
          }`}
        >
          {weatherEnabled ? <Cloud size={15} /> : <CloudOff size={15} />}
          <span className="hidden sm:inline text-xs">Weather</span>
        </button>

        {/* Live badge */}
        <div className="glass rounded-2xl flex items-center gap-2 px-2.5 sm:px-3.5 py-2.5">
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
  );
}
