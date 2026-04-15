import { useEffect, useState, useRef } from 'react';
import {
  X, Navigation2, Plane, Clock, MapPin, TrendingUp, Radio,
  ArrowUp, ArrowDown, Minus, Bell,
} from 'lucide-react';
import { flightService, formatETA } from '../services/flightService';
import { enrichFlight }              from '../services/flightEnrichmentService';
import { notificationService }       from '../services/notificationService';
import { GlassCard, StatChip, Divider } from '../ui/GlassCard';

// ── Airline colour badge ──────────────────────────────────
// Generates a consistent hue from the airline name so every
// carrier gets a stable branded colour without an API key.
function AirlineBadge({ name }) {
  if (!name || name === 'Unknown') return null;
  const initials = name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
  return (
    <div
      className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold flex-shrink-0"
      style={{
        background: `hsla(${hue},65%,30%,0.35)`,
        border:     `1px solid hsla(${hue},65%,55%,0.45)`,
        color:      `hsl(${hue},80%,75%)`,
      }}
    >
      {initials}
    </div>
  );
}

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

// ── ETA helpers ───────────────────────────────────────────
function haversineNm(lat1, lng1, lat2, lng2) {
  const R  = 3440.065; // Earth radius in nautical miles
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Estimate departure (UTC) and ETA using haversine distance + current ground speed.
 * Returns null when data is insufficient.
 */
function calcFlightTimes(flight, enrichment) {
  const origin = enrichment?.origin;
  const dest   = enrichment?.destination;
  if (!origin?.lat || !dest?.lat || origin.lat === 0 || dest.lat === 0) return null;
  if (!flight.speed || flight.speed < 50) return null;

  const remainNm = haversineNm(flight.lat, flight.lng, dest.lat, dest.lng);
  const totalNm  = haversineNm(origin.lat, origin.lng, dest.lat, dest.lng);
  if (totalNm < 1) return null;

  const remainHours = remainNm / flight.speed;
  const totalHours  = totalNm  / flight.speed;
  const etaMs       = Date.now() + remainHours * 3_600_000;
  const deptMs      = etaMs - totalHours * 3_600_000;

  return { etaMs, deptMs, remainNm: Math.round(remainNm) };
}

function fmtUtc(ms) {
  const d  = new Date(ms);
  const hh = d.getUTCHours().toString().padStart(2, '0');
  const mm = d.getUTCMinutes().toString().padStart(2, '0');
  return `${hh}:${mm} UTC`;
}

// Detect iOS Safari running outside standalone (PWA) mode
const isIosSafari =
  /iPad|iPhone|iPod/.test(navigator.userAgent) &&
  !window.navigator.standalone;
const supportsNotifications = 'Notification' in window;

// ── Sidebar ───────────────────────────────────────────────
export function Sidebar({ flightId, isFollowing, onClose, onCenterMap, onToggleFollow }) {
  const [flight,       setFlight]       = useState(() => flightService.getFlight(flightId));
  const [enrichment,   setEnrichment]   = useState(null);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [isTracking,   setIsTracking]   = useState(() => notificationService.isTracking(flightId));
  const [photo,        setPhoto]        = useState(null);
  const flightIdRef  = useRef(flightId);
  const panelRef     = useRef(null);
  const touchStartY  = useRef(0);
  const touchDeltaY  = useRef(0);

  useEffect(() => { flightIdRef.current = flightId; }, [flightId]);

  // Keep isTracking in sync when the notification service removes a flight
  // (e.g. it left the ADS-B feed) without the user clicking "Stop tracking".
  useEffect(() => {
    return notificationService.subscribeToChanges((list) => {
      setIsTracking(list.some((t) => t.id === flightId));
    });
  }, [flightId]);

  // Fetch aircraft photo from planespotters.net (free, no API key).
  useEffect(() => {
    if (!flightId) return;
    let cancelled = false;
    setPhoto(null);
    fetch(`https://api.planespotters.net/pub/photos/hex/${flightId.toUpperCase()}`, {
      headers: { Accept: 'application/json' },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setPhoto(data?.photos?.[0]?.thumbnail?.src ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [flightId]);

  // ── Swipe-down-to-dismiss (mobile bottom sheet) ───────
  // Only activate when the panel is scrolled to the top — otherwise
  // the gesture is a scroll and we let native scrolling handle it.
  function handleTouchStart(e) {
    touchStartY.current = e.touches[0].clientY;
    touchDeltaY.current = 0;
  }
  function handleTouchMove(e) {
    const panel = panelRef.current;
    if (!panel) return;
    // If the user has scrolled down into the content, don't swipe-dismiss
    if (panel.scrollTop > 5) return;
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta <= 0) return;
    touchDeltaY.current = delta;
    panel.style.transform  = `translateY(${Math.min(delta * 0.65, 180)}px)`;
    panel.style.transition = 'none';
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
      notificationService.stopTracking(flightId);
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
  const flightTimes   = enrichment ? calcFlightTimes(flight, enrichment) : null;

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
        {/* Aircraft photo (lazy — doesn't block card render) */}
        {photo && (
          <div className="rounded-xl overflow-hidden mb-3 -mt-0.5" style={{ height: 110 }}>
            <img
              src={photo}
              alt={flight.callsign}
              className="w-full h-full object-cover"
              style={{ objectPosition: 'center 60%' }}
            />
          </div>
        )}

        <div className="flex items-start justify-between mb-3">
          <div className="flex items-start gap-2.5 flex-1 min-w-0">
            {/* Airline colour badge */}
            <AirlineBadge name={flight.airline} />

            <div className="min-w-0">
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
              <div className="text-xs text-white/45 truncate">{flight.airline}</div>
              {flight.aircraft && flight.aircraft !== 'Unknown' && (
                <div className="text-[10px] text-white/30 mt-0.5">{flight.aircraft}</div>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors flex-shrink-0 ml-2"
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
      {/* On mobile the panel itself scrolls (overflow-y:auto in CSS).       */}
      {/* flex-1/overflow-y-auto only apply on desktop (sm:) where the panel */}
      {/* is a fixed-height column.                                           */}
      <GlassCard className="p-4 sm:flex-1 sm:overflow-y-auto">
        <div className="text-[10px] uppercase tracking-widest text-white/30 mb-3">Flight Info</div>
        <div className="space-y-3">
          {flight.aircraft !== 'Unknown' && (
            <InfoRow icon={<Plane size={13} />}  label="Aircraft"  value={flight.aircraft} />
          )}
          {/* ETA / departure — shown when we have enrichment + speed */}
          {flightTimes ? (
            <>
              <InfoRow
                icon={<Clock size={13} />}
                label="Est. Departure"
                value={fmtUtc(flightTimes.deptMs)}
              />
              <InfoRow
                icon={<Clock size={13} />}
                label="ETA"
                value={fmtUtc(flightTimes.etaMs)}
                highlight
              />
              <InfoRow
                icon={<Navigation2 size={13} />}
                label="Remaining"
                value={`${flightTimes.remainNm.toLocaleString()} nm`}
              />
            </>
          ) : isLive && !enrichLoading && hasRoute && (
            <InfoRow icon={<Clock size={13} />} label="ETA" value="Calculating…" />
          )}
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

          {supportsNotifications && (
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

          {/* iOS Safari: Notification API is only available as a PWA.
              Show install instructions so the user knows how to enable alerts. */}
          {isIosSafari && !supportsNotifications && (
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3">
              <div className="flex items-start gap-2">
                <Bell size={12} className="text-amber-400/60 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[10px] font-semibold text-amber-400/80 mb-1">
                    Enable Flight Alerts
                  </p>
                  <p className="text-[10px] text-white/40 leading-relaxed">
                    Tap <span className="text-white/60">Share ↑</span> → <span className="text-white/60">Add to Home Screen</span>, then open FlightMapr from your home screen to receive departure &amp; arrival notifications.
                  </p>
                </div>
              </div>
            </div>
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
