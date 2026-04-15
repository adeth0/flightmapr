import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Search, Cloud, CloudOff, Sun, Building2, X, Flame, GitBranch, Bell, Layers, ArrowLeft,
} from 'lucide-react';
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

// ── Layer toggle row used inside the mobile dropdown ──────
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
      {/* Toggle pill */}
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

export function TopBar({
  weatherEnabled, dayNightEnabled, airportsEnabled, heatmapEnabled, routesEnabled,
  onToggleWeather, onToggleDayNight, onToggleAirports, onToggleHeatmap, onToggleRoutes,
  onFlightSelect, onFlyTo,
  totalFlights, dataSource,
  alertsCount, onToggleAlerts,
}) {
  const [query,      setQuery]      = useState('');
  const [results,    setResults]    = useState([]);
  const [focused,    setFocused]    = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false); // mobile full-screen overlay

  const inputRef       = useRef(null);
  const mobileInputRef = useRef(null);
  const dropRef        = useRef(null);
  const layersRef      = useRef(null);

  // ── Search results ────────────────────────────────────────
  useEffect(() => {
    if (query.length < 1) { setResults([]); return; }
    setResults(flightService.search(query));
  }, [query]);

  // ── Auto-focus mobile input when overlay opens ────────────
  useEffect(() => {
    if (!searchOpen) return;
    const t = setTimeout(() => mobileInputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [searchOpen]);

  // ── Close desktop dropdown on outside click ───────────────
  useEffect(() => {
    function handler(e) {
      if (
        dropRef.current   && !dropRef.current.contains(e.target) &&
        inputRef.current  && !inputRef.current.contains(e.target)
      ) setFocused(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Close layers dropdown on outside click / touch ────────
  useEffect(() => {
    if (!layersOpen) return;
    function handler(e) {
      if (layersRef.current && !layersRef.current.contains(e.target)) {
        setLayersOpen(false);
      }
    }
    document.addEventListener('mousedown',  handler);
    document.addEventListener('touchstart', handler, { passive: true });
    return () => {
      document.removeEventListener('mousedown',  handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [layersOpen]);

  const handleSelect = useCallback((flight) => {
    setQuery(''); setResults([]); setFocused(false);
    onFlightSelect(flight);
    onFlyTo(flight.id);
  }, [onFlightSelect, onFlyTo]);

  const clearSearch = () => { setQuery(''); setResults([]); inputRef.current?.focus() || mobileInputRef.current?.focus(); };

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery('');
    setResults([]);
  }, []);

  const handleMobileSelect = useCallback((flight) => {
    closeSearch();
    handleSelect(flight);
  }, [closeSearch, handleSelect]);

  const showDrop = focused && results.length > 0;
  const isLive   = dataSource === 'live';

  const activeLayerCount = [weatherEnabled, dayNightEnabled, airportsEnabled, heatmapEnabled, routesEnabled]
    .filter(Boolean).length;

  return (
    <>
      {/* ══ Mobile full-screen search overlay ══════════════════
          Rendered as a fixed overlay so it sits above the map.
          font-size ≥16 on the input prevents iOS auto-zoom.     */}
      {searchOpen && (
        <div className="mobile-search-overlay sm:hidden">
          {/* Input bar ── always at top, visible above keyboard */}
          <div className="mobile-search-bar">
            <Search size={18} className="text-white/40 flex-shrink-0" />
            <input
              ref={mobileInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search flight or airline…"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              style={{ fontSize: 16 }}
              className="flex-1 bg-transparent text-white placeholder-white/30 outline-none py-1"
            />
            {query ? (
              <button
                onClick={clearSearch}
                className="mobile-search-clear"
                aria-label="Clear"
              >
                <X size={15} />
              </button>
            ) : null}
            <button onClick={closeSearch} className="mobile-search-cancel">
              Cancel
            </button>
          </div>

          {/* Results list */}
          <div className="mobile-search-results">
            {results.length > 0 ? (
              results.map((f) => (
                <SearchResult key={f.id} flight={f} onSelect={handleMobileSelect} />
              ))
            ) : query.length >= 1 ? (
              <div className="mobile-search-empty">
                <Search size={30} style={{ opacity: 0.2, marginBottom: 10 }} />
                <p>No flights found for "{query}"</p>
              </div>
            ) : (
              <div className="mobile-search-empty">
                <Search size={30} style={{ opacity: 0.15, marginBottom: 10 }} />
                <p>Type a flight number or airline</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ Top bar ════════════════════════════════════════════ */}
      <header
        className="absolute top-0 left-0 right-0 z-[1000] flex items-center gap-2 px-3 py-3"
        style={{ pointerEvents: 'none' }}
      >
        {/* ── Logo ─────────────────────────────────────────── */}
        <div
          className="glass rounded-2xl flex items-center gap-2 px-3 py-2.5 flex-shrink-0"
          style={{ pointerEvents: 'auto' }}
        >
          <div className="relative w-6 h-6 flex items-center justify-center">
            <div className="absolute inset-0 rounded-lg bg-[#00ffcc]/20" />
            <span className="relative text-sm leading-none">✈</span>
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

        {/* ── Search ───────────────────────────────────────── */}

        {/* Mobile: tap trigger — opens full-screen overlay */}
        <button
          onClick={() => setSearchOpen(true)}
          className="flex-1 sm:hidden glass rounded-2xl flex items-center gap-2 px-3"
          style={{ height: 44, pointerEvents: 'auto' }}
          aria-label="Search flights"
        >
          <Search size={15} className="text-white/35 flex-shrink-0" />
          <span className="text-sm text-white/28 truncate" style={{ color: 'rgba(255,255,255,0.28)' }}>
            Search flight…
          </span>
        </button>

        {/* Desktop: inline search + dropdown */}
        <div className="hidden sm:block flex-1 min-w-0 relative" style={{ pointerEvents: 'auto' }}>
          <div className="glass rounded-2xl flex items-center gap-2 px-3 py-2.5">
            <Search size={15} className="text-white/35 flex-shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              placeholder="Search flight, airline…"
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
                {results.map((f) => (
                  <SearchResult key={f.id} flight={f} onSelect={handleSelect} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Right-side controls ───────────────────────────── */}
        <div className="flex items-center gap-1.5 flex-shrink-0" style={{ pointerEvents: 'auto' }}>

          {/* ── Desktop-only individual layer buttons ── */}
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

          {/* ── Mobile: Layers dropdown button ── */}
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

            {/* Layers dropdown */}
            {layersOpen && (
              <div
                className="absolute top-full right-0 mt-2 glass rounded-2xl overflow-hidden animate-slide-down"
                style={{ zIndex: 9999, minWidth: 220 }}
              >
                <div className="px-4 py-2.5 border-b border-white/8">
                  <span className="text-[10px] uppercase tracking-widest text-white/35 font-semibold">Map Layers</span>
                </div>
                <LayerRow icon={<Building2 size={15} />} label="Airports"    enabled={airportsEnabled} onToggle={() => { onToggleAirports(); }} />
                <LayerRow icon={<Sun size={15} />}       label="Night Mode"  enabled={dayNightEnabled} onToggle={() => { onToggleDayNight(); }} />
                <LayerRow icon={<Cloud size={15} />}     label="Weather"     enabled={weatherEnabled}  onToggle={() => { onToggleWeather(); }} />
                <LayerRow icon={<Flame size={15} />}     label="Heatmap"     enabled={heatmapEnabled}  onToggle={() => { onToggleHeatmap(); }} />
                <LayerRow icon={<GitBranch size={15} />} label="Busy Routes" enabled={routesEnabled}   onToggle={() => { onToggleRoutes(); }} />
              </div>
            )}
          </div>

          {/* ── Alerts bell ── */}
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

          {/* ── Donate button — desktop only in header ────────
              Mobile gets a floating button rendered in App.jsx  */}
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

          {/* ── Live badge ── */}
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
