import { useEffect, useState, useRef, useCallback } from 'react';
import {
  X, Navigation2, Plane, Clock, MapPin, TrendingUp, Radio,
  ArrowUp, ArrowDown, Bell,
} from 'lucide-react';
import { flightService, formatETA } from '../services/flightService';
import { enrichFlight }              from '../services/flightEnrichmentService';
import { notificationService }       from '../services/notificationService';
import { GlassCard, StatChip, Divider } from '../ui/GlassCard';

// ── Airline colour badge ──────────────────────────────────
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

// ── Route arrow ───────────────────────────────────────────
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

// ── Progress bar ──────────────────────────────────────────
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

function VertRateChip({ fpm }) {
  if (fpm == null) return <StatChip label="V/Rate" value="—" />;
  const abs = Math.abs(Math.round(fpm));
  if (abs < 64) return <StatChip label="V/Rate" value="Level" />;
  return (
    <StatChip
      label="V/Rate"
      value={`${fpm > 0 ? '↑' : '↓'} ${abs.toLocaleString()}`}
      unit="fpm"
    />
  );
}

// ── ETA helpers ───────────────────────────────────────────
function haversineNm(lat1, lng1, lat2, lng2) {
  const R  = 3440.065;
  const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180, Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcFlightTimes(flight, enrichment) {
  const origin = enrichment?.origin, dest = enrichment?.destination;
  if (!origin?.lat || !dest?.lat || origin.lat === 0 || dest.lat === 0) return null;
  if (!flight.speed || flight.speed < 50) return null;
  const remainNm   = haversineNm(flight.lat, flight.lng, dest.lat, dest.lng);
  const totalNm    = haversineNm(origin.lat, origin.lng, dest.lat, dest.lng);
  if (totalNm < 1) return null;
  const remainHours = remainNm / flight.speed;
  const etaMs       = Date.now() + remainHours * 3_600_000;
  const deptMs      = etaMs - (totalNm / flight.speed) * 3_600_000;
  return { etaMs, deptMs, remainNm: Math.round(remainNm) };
}

function fmtLocal(ms) {
  const d  = new Date(ms);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const tz = d.toLocaleTimeString('en-GB', { timeZoneName: 'short' }).split(' ').pop() || '';
  return `${hh}:${mm}${tz ? ' ' + tz : ''}`;
}

// ── Device detection ──────────────────────────────────────
const isIosSafari =
  /iPad|iPhone|iPod/.test(navigator.userAgent) &&
  !window.navigator.standalone;
const supportsNotifications = 'Notification' in window;

// ── Snap point heights (mobile bottom sheet) ──────────────
const SNAP = { half: '62dvh', full: '92dvh' };

// ── Sidebar ───────────────────────────────────────────────
export function Sidebar({ flightId, isFollowing, onClose, onCenterMap, onToggleFollow }) {
  const [flight,        setFlight]        = useState(() => flightService.getFlight(flightId));
  const [enrichment,    setEnrichment]    = useState(null);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [isTracking,    setIsTracking]    = useState(() => notificationService.isTracking(flightId));
  const [photo,         setPhoto]         = useState(null);
  const [snapPoint,     setSnapPoint]     = useState('half'); // 'half' | 'full'

  const flightIdRef  = useRef(flightId);
  const panelRef     = useRef(null);
  const touchStartY  = useRef(0);
  const touchDeltaY  = useRef(0);
  const snapRef      = useRef('half');

  useEffect(() => { flightIdRef.current = flightId; }, [flightId]);
  useEffect(() => { snapRef.current = snapPoint; }, [snapPoint]);

  // Keep tracking badge in sync
  useEffect(() => {
    return notificationService.subscribeToChanges((list) => {
      setIsTracking(list.some((t) => t.id === flightId));
    });
  }, [flightId]);

  // Aircraft photo (non-blocking)
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

  // ── Multi-snap bottom sheet touch handling ────────────
  function handleTouchStart(e) {
    touchStartY.current = e.touches[0].clientY;
    touchDeltaY.current = 0;
  }

  function handleTouchMove(e) {
    const panel = panelRef.current;
    if (!panel) return;
    const delta = e.touches[0].clientY - touchStartY.current;

    if (delta > 0) {
      // Downward — allow only when at scroll top
      if (panel.scrollTop > 5) return;
      touchDeltaY.current = delta;
      // Rubber-band drag (doesn't override the CSS snap height transition)
      panel.style.transform  = `translateY(${Math.min(delta * 0.55, 160)}px)`;
      panel.style.transition = 'none';
    } else if (delta < 0 && snapRef.current === 'half') {
      // Upward from half — track it, snap handled on touchEnd
      touchDeltaY.current = delta;
    }
  }

  function handleTouchEnd() {
    const panel = panelRef.current;
    const delta = touchDeltaY.current;

    // Reset rubber-band
    if (panel) {
      panel.style.transform  = '';
      panel.style.transition = '';
    }

    if (delta > 100) {
      // Hard swipe down
      if (snapRef.current === 'full') {
        setSnapPoint('half');
      } else {
        onClose();
      }
    } else if (delta > 40 && snapRef.current === 'full') {
      // Gentle swipe down from full → half
      setSnapPoint('half');
    } else if (delta < -50 && snapRef.current === 'half') {
      // Swipe up → expand
      setSnapPoint('full');
    }

    touchDeltaY.current = 0;
  }

  // Live flight updates
  useEffect(() => {
    if (!flightId) return;
    setFlight(flightService.getFlight(flightId));
    const unsub = flightService.subscribe((flights) => {
      const f = flights.find((x) => x.id === flightIdRef.current);
      if (f) setFlight({ ...f });
    });
    return unsub;
  }, [flightId]);

  // Enrich route data
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

  // Tracking toggle
  async function handleToggleTracking() {
    if (isTracking) {
      notificationService.stopTracking(flightId);
      setIsTracking(false);
      return;
    }
    const granted = await notificationService.requestPermission();
    if (!granted) return;
    await notificationService.trackFlight(flight);
    setIsTracking(true);
  }

  if (!flight) return null;

  const isLive        = !!flight.isLive;
  const distRemaining = Math.round(flight.routeDistance * (1 - flight.progress));
  const flightTimes   = enrichment ? calcFlightTimes(flight, enrichment) : null;
  const hasRoute      = enrichment?.origin && enrichment?.destination;
  const routeOrigin      = hasRoute ? enrichment.origin      : flight.origin;
  const routeDestination = hasRoute ? enrichment.destination : flight.destination;

  // On mobile use CSS snap-driven height; desktop uses the absolute positioning in CSS
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

  return (
    <aside
      ref={panelRef}
      className="sidebar-panel absolute right-4 top-[72px] bottom-16 z-[900] w-80 flex flex-col gap-3 animate-slide-right"
      data-snap={snapPoint}
      style={{
        pointerEvents: 'auto',
        // On mobile the CSS class controls max-height; we also drive it inline for
        // transition to work correctly when snapPoint changes.
        ...(isMobile && {
          maxHeight:  SNAP[snapPoint],
          transition: 'max-height 0.38s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        }),
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* ── Drag handle (mobile only) ─────────────────── */}
      <div
        className="flex flex-col items-center pt-3 pb-1 sm:hidden flex-shrink-0 cursor-grab active:cursor-grabbing select-none"
        onTouchStart={(e) => e.stopPropagation()}  // let handle drags bubble normally
      >
        <div className="w-10 h-1 rounded-full bg-white/25" />
        <div className="mt-1.5 text-[9px] text-white/20 font-medium tracking-wide uppercase">
          {snapPoint === 'half' ? 'Swipe up for more' : 'Swipe down to collapse'}
        </div>
      </div>

      {/* ── Header card ──────────────────────────────── */}
      <GlassCard className="p-4 flex-shrink-0">
        {photo && (
          <div className="rounded-xl overflow-hidden mb-3 -mt-0.5 photo-fade-in" style={{ height: 110 }}>
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
                {isTracking && (
                  <span className="text-[10px] bg-amber-400/15 text-amber-400 rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 blink-dot inline-block" />
                    Tracked
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
            className="btn-icon flex-shrink-0 ml-2"
            aria-label="Close"
          >
            <X size={13} className="text-white/50" />
          </button>
        </div>

        <Divider />

        <div className="py-3">
          {isLive
            ? hasRoute
              ? <RouteArrow origin={routeOrigin} destination={routeDestination} />
              : <LiveTrackingRow loading={enrichLoading} />
            : <RouteArrow origin={flight.origin} destination={flight.destination} />
          }
        </div>

        {!isLive && (
          <>
            <Divider />
            <div className="pt-3">
              <ProgressBar progress={flight.progress} />
            </div>
          </>
        )}
      </GlassCard>

      {/* ── Stats grid ───────────────────────────────── */}
      <GlassCard className="p-4 flex-shrink-0">
        <div className="text-[10px] uppercase tracking-widest text-white/30 mb-3">Flight Data</div>
        <div className="grid grid-cols-2 gap-2">
          <StatChip label="Altitude" value={flight.altitude.toLocaleString()} unit="ft" />
          <StatChip label="Speed"    value={flight.speed}                      unit="kts" />
          <StatChip label="Heading"  value={`${Math.round(flight.heading)}°`} />
          {isLive
            ? <VertRateChip fpm={flight.vertRate} />
            : <StatChip label="Distance" value={distRemaining.toLocaleString()} unit="km" />
          }
        </div>
      </GlassCard>

      {/* ── Info + actions ────────────────────────────── */}
      <GlassCard className="p-4 sm:flex-1 sm:overflow-y-auto">
        <div className="text-[10px] uppercase tracking-widest text-white/30 mb-3">Flight Info</div>
        <div className="space-y-3">
          {flight.aircraft !== 'Unknown' && (
            <InfoRow icon={<Plane size={13} />} label="Aircraft" value={flight.aircraft} />
          )}

          {flightTimes ? (
            <>
              <InfoRow icon={<Clock size={13} />} label="Est. Departure" value={fmtLocal(flightTimes.deptMs)} />
              <InfoRow icon={<Clock size={13} />} label="ETA"            value={fmtLocal(flightTimes.etaMs)} highlight />
              <InfoRow icon={<Navigation2 size={13} />} label="Remaining" value={`${flightTimes.remainNm.toLocaleString()} nm`} />
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

          {/* Delay status */}
          {enrichment?.delayMinutes !== undefined && (
            <InfoRow
              icon={<Clock size={13} />}
              label="Delay Status"
              value={enrichment.delayMinutes === 0 ? '✓ On Time' : `+${enrichment.delayMinutes} min delay`}
              highlight={enrichment.delayMinutes === 0}
              warn={enrichment.delayMinutes > 0}
            />
          )}

          {/* Live-only rows */}
          {isLive && (
            <>
              {flight.registration && (
                <InfoRow icon={<Plane size={13} />} label="Registration" value={flight.registration} mono />
              )}
              <InfoRow icon={<Radio size={13} />} label="ICAO Hex" value={flight.id?.toUpperCase() ?? '—'} mono />
              {flight.squawk && (
                <InfoRow icon={<Radio size={13} />} label="Squawk" value={flight.squawk} mono />
              )}
              {flight.vertRate != null && Math.abs(flight.vertRate) >= 64 && (
                <InfoRow
                  icon={flight.vertRate > 0 ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
                  label="Vertical Rate"
                  value={`${flight.vertRate > 0 ? '+' : ''}${Math.round(flight.vertRate).toLocaleString()} fpm`}
                />
              )}
              {enrichment?.airlineCallsign && (
                <InfoRow icon={<Radio size={13} />} label="Radio Callsign" value={enrichment.airlineCallsign} />
              )}
            </>
          )}
        </div>

        <Divider />

        {/* Action buttons */}
        <div className="flex flex-col gap-2 mt-3">
          <button
            onClick={() => onCenterMap(flight.id)}
            className="sidebar-btn sidebar-btn-outline"
          >
            Center on Map
          </button>
          <button
            onClick={() => onToggleFollow(flight.id)}
            className={`sidebar-btn ${
              isFollowing
                ? 'sidebar-btn-active'
                : 'sidebar-btn-outline sidebar-btn-follow'
            }`}
          >
            {isFollowing ? '⊙ Following' : '◎ Follow Flight'}
          </button>

          {supportsNotifications && (
            <button
              onClick={handleToggleTracking}
              className={`sidebar-btn flex items-center justify-center gap-2 ${
                isTracking
                  ? 'sidebar-btn-tracking-on'
                  : 'sidebar-btn-outline sidebar-btn-tracking-off'
              }`}
            >
              <Bell size={12} />
              {isTracking ? 'Tracking Flight' : 'Track Flight'}
            </button>
          )}

          {/* iOS: show install-to-get-notifications instructions */}
          {isIosSafari && !supportsNotifications && (
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3">
              <div className="flex items-start gap-2">
                <Bell size={12} className="text-amber-400/60 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[10px] font-semibold text-amber-400/80 mb-1">Enable Flight Alerts</p>
                  <p className="text-[10px] text-white/40 leading-relaxed">
                    Tap <span className="text-white/60">Share ↑</span> →{' '}
                    <span className="text-white/60">Add to Home Screen</span>, then open
                    FlightMapr from your home screen to receive departure &amp; arrival notifications.
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

function InfoRow({ icon, label, value, highlight, mono, warn }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-white/35 flex-shrink-0">
        {icon}
        <span className="text-[11px]">{label}</span>
      </div>
      <span className={`text-xs font-medium text-right ${
        highlight ? 'text-[#00ffcc]'
        : warn     ? 'text-amber-400'
        : mono     ? 'text-white/50 font-mono text-[10px]'
        : 'text-white/80'
      }`}>
        {value}
      </span>
    </div>
  );
}
