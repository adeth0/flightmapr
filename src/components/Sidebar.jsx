import { useEffect, useState, useRef } from 'react';
import {
  X, Navigation2, Plane, Clock, MapPin, TrendingUp, Radio,
  ArrowUp, ArrowDown, Minus, Bell,
} from 'lucide-react';
import { flightService, formatETA } from '../services/flightService';
import { enrichFlight }              from '../services/flightEnrichmentService';
import { notificationService }       from '../services/notificationService';
import { GlassCard, StatChip, Divider } from '../ui/GlassCard';

// ── Sub-components ────────────────────────────────────────

function RouteArrow({ origin, destination }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1">
        <div className="text-xl font-bold tracking-tight text-white">{origin.code}</div>
        <div className="text-xs text-white/45 mt-0.5 leading-tight">{origin.city}</div>
        <div className="text-[10px] text-white/25 mt-0.5">{origin.name}</div>
      </div>
      <div className="flex flex-col items-center gap-1.5 flex-shrink-0 px-2">
        <Navigation2 size={13} className="text-[#00ffcc] rotate-90" />
        <div className="text-[10px] text-white/30 font-medium">direct</div>
      </div>
      <div className="flex-1 text-right">
        <div className="text-xl font-bold tracking-tight text-white">{destination.code}</div>
        <div className="text-xs text-white/45 mt-0.5 leading-tight">{destination.city}</div>
        <div className="text-[10px] text-white/25 mt-0.5">{destination.name}</div>
      </div>
    </div>
  );
}

function ProgressBar({ progress }) {
  const pct = Math.round(progress * 100);
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-[10px] text-white/35 uppercase tracking-widest">Progress</span>
        <span className="text-xs font-semibold text-[#00ffcc]">{pct}%</span>
      </div>
      <div className="w-full h-1 rounded-full bg-white/8 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#10b981] to-[#00ffcc] fill-bar"
          style={{ width: `${pct}%`, boxShadow: '0 0 8px #00ffcc80' }}
        />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[9px] text-white/20">Departed</span>
        <span className="text-[9px] text-white/20">Arrived</span>
      </div>
    </div>
  );
}

/** Compact row shown while route data is loading or unavailable */
function LiveTrackingRow({ loading }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="w-8 h-8 rounded-lg bg-[#00ffcc]/10 flex items-center justify-center flex-shrink-0">
        <Radio size={14} className="text-[#00ffcc]" />
      </div>
      <div>
        <div className="text-xs font-semibold text-white">Live ADS-B Tracking</div>
        <div className="text-[10px] text-white/40 mt-0.5">
          {loading ? 'Resolving route…' : 'Route data unavailable'}
        </div>
      </div>
    </div>
  );
}

/** Vertical rate chip with direction icon */
function VertRateChip({ fpm }) {
  if (fpm == null) return <StatChip label="V/Rate" value="—" />;
  const abs = Math.abs(Math.round(fpm));
  if (abs < 64) return <StatChip label="V/Rate" value="Level" />;
  const label = fpm > 0 ? '↑' : '↓';
  return (
    <StatChip
      label="V/Rate"
      value={`${label} ${abs.toLocaleString()}`}
      unit="fpm"
    />
  );
}

// ── Sidebar ───────────────────────────────────────────────
export function Sidebar({ flightId, isFollowing, onClose, onCenterMap, onToggleFollow }) {
  const [flight,       setFlight]       = useState(() => flightService.getFlight(flightId));
  const [enrichment,   setEnrichment]   = useState(null);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [isTracking,   setIsTracking]   = useState(() => notificationService.isTracking(flightId));
  const flightIdRef  = useRef(flightId);
  const panelRef     = useRef(null);
  const touchStartY  = useRef(0);
  const touchDeltaY  = useRef(0);

  useEffect(() => { flightIdRef.current = flightId; }, [flightId]);

  // ── Swipe-down-to-dismiss (mobile bottom sheet) ───────
  function handleTouchStart(e) {
    touchStartY.current = e.touches[0].clientY;
    touchDeltaY.current = 0;
  }
  function handleTouchMove(e) {
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta <= 0) return;
    touchDeltaY.current = delta;
    if (panelRef.current) {
      panelRef.current.style.transform  = `translateY(${Math.min(delta * 0.65, 180)}px)`;
      panelRef.current.style.transition = 'none';
    }
  }
  function handleTouchEnd() {
    if (touchDeltaY.current > 80) {
      onClose();
    } else if (panelRef.current) {
      panelRef.current.style.transform  = '';
      panelRef.current.style.transition = '';
    }
    touchDeltaY.current = 0;
  }

  // Subscribe to live flight updates
  useEffect(() => {
    if (!flightId) return;
    setFlight(flightService.getFlight(flightId));
    const unsub = flightService.subscribe((flights) => {
      const f = flights.find((x) => x.id === flightIdRef.current);
      if (f) setFlight({ ...f });
    });
    return unsub;
  }, [flightId]);

  // Enrich selected flight with route data (origin/destination)
  useEffect(() => {
    if (!flightId) return;
    const f = flightService.getFlight(flightId);
    if (!f?.isLive || !f?.callsign) return;

    setEnrichment(null);
    setEnrichLoading(true);

    enrichFlight(f.callsign).then((data) => {
      setEnrichment(data);
      setEnrichLoading(false);
    });
  }, [flightId]);

  // ── Flight tracking (push notifications) ──────────────
  async function handleToggleTracking() {
    if (isTracking) {
      notificationService.stopTracking();
      setIsTracking(false);
      return;
    }
    const granted = await notificationService.requestPermission();
    if (!granted) return; // permission denied — fail silently
    await notificationService.trackFlight(flight);
    setIsTracking(true);
  }

  if (!flight) return null;

  const isLive        = !!flight.isLive;
  const eta           = formatETA(flight);
  const distRemaining = Math.round(flight.routeDistance * (1 - flight.progress));

  // Route display: use real enrichment when available, fallback to live-tracking row
  const hasRoute = enrichment?.origin && enrichment?.destination;
  const routeOrigin      = hasRoute ? enrichment.origin      : flight.origin;
  const routeDestination = hasRoute ? enrichment.destination : flight.destination;

  return (
    <aside
      ref={panelRef}
      className="sidebar-panel absolute right-4 top-[72px] bottom-16 z-[900] w-80 flex flex-col gap-3 animate-slide-right"
      style={{ pointerEvents: 'auto' }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* ── Drag handle (mobile only) ─────────────────── */}
      <div className="flex justify-center pt-2 pb-0 sm:hidden flex-shrink-0 cursor-grab active:cursor-grabbing">
        <div className="w-10 h-1 rounded-full bg-white/20" />
      </div>

      {/* ── Header ─────────────────────────────────────── */}
      <GlassCard className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span className="text-lg font-bold text-[#00ffcc] tracking-tight">{flight.callsign}</span>
              {isLive ? (
                <span className="text-[10px] bg-red-500/20 text-red-400 rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 blink-dot inline-block" />
                  Live
                </span>
              ) : (
                <span className="text-[10px] bg-[#00ffcc]/15 text-[#00ffcc] rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide">
                  En Route
                </span>
              )}
            </div>
            <div className="text-xs text-white/45">{flight.airline}</div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors flex-shrink-0"
            aria-label="Close"
          >
            <X size={13} className="text-white/50" />
          </button>
        </div>

        <Divider />

        {/* Route section */}
        <div className="py-3">
          {isLive
            ? hasRoute
              ? <RouteArrow origin={routeOrigin} destination={routeDestination} />
              : <LiveTrackingRow loading={enrichLoading} />
            : <RouteArrow origin={flight.origin} destination={flight.destination} />
          }
        </div>

        {/* Progress bar — sim flights only */}
        {!isLive && (
          <>
            <Divider />
            <div className="pt-3">
              <ProgressBar progress={flight.progress} />
            </div>
          </>
        )}
      </GlassCard>

      {/* ── Stats grid ─────────────────────────────────── */}
      <GlassCard className="p-4">
        <div className="text-[10px] uppercase tracking-widest text-white/30 mb-3">Flight Data</div>
        <div className="grid grid-cols-2 gap-2">
          <StatChip label="Altitude"  value={flight.altitude.toLocaleString()} unit="ft"  />
          <StatChip label="Speed"     value={flight.speed}                      unit="kts" />
          <StatChip label="Heading"   value={`${Math.round(flight.heading)}°`}             />
          {isLive
            ? <VertRateChip fpm={flight.vertRate} />
            : <StatChip label="Distance" value={distRemaining.toLocaleString()} unit="km" />
          }
        </div>
      </GlassCard>

      {/* ── Info + actions ─────────────────────────────── */}
      <GlassCard className="p-4 flex-1 overflow-y-auto">
        <div className="text-[10px] uppercase tracking-widest text-white/30 mb-3">Flight Info</div>
        <div className="space-y-3">
          {flight.aircraft !== 'Unknown' && (
            <InfoRow icon={<Plane size={13} />}  label="Aircraft"  value={flight.aircraft} />
          )}
          <InfoRow icon={<Clock size={13} />}    label="Departure" value="See route above" highlight />
          <InfoRow
            icon={<MapPin size={13} />}
            label="Position"
            value={`${flight.lat.toFixed(3)}°, ${flight.lng.toFixed(3)}°`}
            mono
          />
          {!isLive && (
            <InfoRow
              icon={<TrendingUp size={13} />}
              label="Route Distance"
              value={`${Math.round(flight.routeDistance).toLocaleString()} km`}
            />
          )}

          {/* Live-only enrichment rows */}
          {isLive && (
            <>
              {flight.registration && (
                <InfoRow
                  icon={<Plane size={13} />}
                  label="Registration"
                  value={flight.registration}
                  mono
                />
              )}
              <InfoRow
                icon={<Radio size={13} />}
                label="ICAO Hex"
                value={flight.id?.toUpperCase() ?? '—'}
                mono
              />
              {flight.squawk && (
                <InfoRow
                  icon={<Radio size={13} />}
                  label="Squawk"
                  value={flight.squawk}
                  mono
                />
              )}
              {flight.vertRate != null && Math.abs(flight.vertRate) >= 64 && (
                <InfoRow
                  icon={flight.vertRate > 0 ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
                  label="Vertical Rate"
                  value={`${flight.vertRate > 0 ? '+' : ''}${Math.round(flight.vertRate).toLocaleString()} fpm`}
                />
              )}
              {enrichment?.airlineCallsign && (
                <InfoRow
                  icon={<Radio size={13} />}
                  label="Radio Callsign"
                  value={enrichment.airlineCallsign}
                />
              )}
            </>
          )}
        </div>

        <Divider />

        {/* Action buttons */}
        <div className="flex flex-col gap-2 mt-3">
          <button
            onClick={() => onCenterMap(flight.id)}
            className="w-full py-2.5 rounded-xl text-xs font-semibold text-[#00ffcc] border border-[#00ffcc]/25 hover:bg-[#00ffcc]/10 transition-all hover:border-[#00ffcc]/50"
          >
            Center on Map
          </button>
          <button
            onClick={() => onToggleFollow(flight.id)}
            className={`w-full py-2.5 rounded-xl text-xs font-semibold transition-all ${
              isFollowing
                ? 'bg-[#00ffcc]/15 text-[#00ffcc] border border-[#00ffcc]/40 shadow-[0_0_10px_rgba(0,255,204,0.15)]'
                : 'text-white/40 border border-white/8 hover:border-[#00ffcc]/25 hover:text-[#00ffcc]'
            }`}
          >
            {isFollowing ? '⊙ Following' : '◎ Follow Flight'}
          </button>

          {'Notification' in window && (
            <button
              onClick={handleToggleTracking}
              className={`w-full py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2 ${
                isTracking
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-400/40 shadow-[0_0_10px_rgba(251,191,36,0.12)]'
                  : 'text-white/40 border border-white/8 hover:border-amber-400/25 hover:text-amber-400'
              }`}
            >
              <Bell size={12} />
              {isTracking ? 'Tracking Flight' : 'Track Flight'}
            </button>
          )}
        </div>
      </GlassCard>
    </aside>
  );
}

function InfoRow({ icon, label, value, highlight, mono }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-white/35 flex-shrink-0">
        {icon}
        <span className="text-[11px]">{label}</span>
      </div>
      <span className={`text-xs font-medium text-right ${
        highlight ? 'text-[#00ffcc]' : mono ? 'text-white/50 font-mono text-[10px]' : 'text-white/80'
      }`}>
        {value}
      </span>
    </div>
  );
}
