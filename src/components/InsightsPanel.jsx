// ─────────────────────────────────────────────────────────
//  InsightsPanel — "Flight Insights"
//  Premium aggregate dashboard that sits alongside the live
//  map and surfaces five intelligence sections derived from
//  the live ADS-B feed:
//
//     1. Busy airports near you (within ~200 miles)
//     2. Top departures today    (busiest origin hubs)
//     3. Next arrivals (30 min)
//     4. Currently landing       (on final approach)
//     5. Most delayed flights
//
//  Mobile : draggable bottom sheet mirroring Sidebar/AirportSidebar
//  Desktop: right-side panel.
//
//  Clicking an airport row opens the existing AirportSidebar; a
//  flight row opens the existing flight detail Sidebar. Tracking
//  reuses notificationService.trackFlight — no new plumbing.
// ─────────────────────────────────────────────────────────

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  X, Sparkles, Building2, TrendingUp, PlaneLanding, Plane, Clock3,
  AlertTriangle, Bell,
} from 'lucide-react';
import { GlassCard, Divider } from '../ui/GlassCard';
import { flightService }       from '../services/flightService';
import { notificationService } from '../services/notificationService';
import {
  busyAirportsNear,
  topDeparturesToday,
  nextArrivals,
  currentlyLanding,
  mostDelayedFlights,
} from '../services/insightsService';
import { AirlineLogo } from './AirlineLogo.jsx';

// Snap heights — consistent with the other sheets in the app.
const SNAP = { half: '62dvh', full: '92dvh' };
const REFRESH_MS = 8_000;

const SECTIONS = [
  { id: 'busy',    label: 'Busy Airports',  icon: Building2 },
  { id: 'top',     label: 'Top Departures', icon: TrendingUp },
  { id: 'next',    label: 'Arriving Soon',  icon: Plane },
  { id: 'landing', label: 'Landing Now',    icon: PlaneLanding },
  { id: 'delays',  label: 'Most Delayed',   icon: AlertTriangle },
];

function fmtTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function fmtMinutesFromNow(ms) {
  if (!ms) return '—';
  const diff = Math.max(0, Math.round((ms - Date.now()) / 60_000));
  return `${diff} min`;
}

// ── Row components ──────────────────────────────────────
function AirportRow({ airport, subtitle, metric, metricLabel, onClick }) {
  return (
    <button type="button" onClick={onClick} className="insights-row group">
      <div className="insights-row-icon">
        <Building2 size={14} className="text-[#00ffcc]" />
      </div>
      <div className="min-w-0 flex-1 text-left">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold text-white tracking-tight truncate">{airport.code}</span>
          <span className="text-[11px] text-white/40 truncate">{airport.city}</span>
        </div>
        <div className="text-[11px] text-white/35 truncate">{subtitle}</div>
      </div>
      <div className="flex flex-col items-end flex-shrink-0">
        <span className="text-sm font-semibold text-[#00ffcc]">{metric}</span>
        <span className="text-[9px] uppercase tracking-widest text-white/30">{metricLabel}</span>
      </div>
    </button>
  );
}

function FlightRow({ flight, airline, subtitle, trailing, onClick, onTrack, isTracked }) {
  return (
    <div className="insights-row-wrap">
      <button type="button" onClick={onClick} className="insights-row flex-1 min-w-0">
        <AirlineLogo callsign={flight?.callsign} airline={airline ?? flight?.airline} size={36} />
        <div className="min-w-0 flex-1 text-left">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold text-white tracking-tight truncate">{flight?.callsign ?? '—'}</span>
            {flight?.isLive && (
              <span className="text-[9px] rounded px-1 py-0.5 bg-red-400/15 text-red-400 uppercase tracking-wide font-semibold">
                Live
              </span>
            )}
          </div>
          <div className="text-[11px] text-white/40 truncate">{subtitle}</div>
        </div>
        {trailing}
      </button>
      {onTrack && (
        <button
          type="button"
          onClick={onTrack}
          className={`insights-track-btn ${isTracked ? 'is-active' : ''}`}
          aria-label={isTracked ? 'Stop tracking' : 'Track flight'}
        >
          <Bell size={11} />
        </button>
      )}
    </div>
  );
}

// ── Panel ───────────────────────────────────────────────
export function InsightsPanel({ userLocation, onClose, onSelectFlight, onSelectAirport }) {
  const [tick, setTick]           = useState(0);
  const [trackedIds, setTrackedIds] = useState(() => new Set());
  const [snapPoint, setSnapPoint] = useState('half');
  const panelRef    = useRef(null);
  const touchStartY = useRef(0);
  const touchDeltaY = useRef(0);
  const snapRef     = useRef('half');

  useEffect(() => { snapRef.current = snapPoint; }, [snapPoint]);

  // Re-tick so memoised insight queries invalidate on their own cadence.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), REFRESH_MS);
    // Also subscribe to the live feed so a fresh poll immediately
    // re-renders — no visible lag between data arriving and UI updating.
    const unsub = flightService.subscribe(() => setTick((t) => t + 1));
    return () => { clearInterval(id); unsub(); };
  }, []);

  useEffect(() => {
    return notificationService.subscribeToChanges((list) => {
      setTrackedIds(new Set(list.map((item) => item.id)));
    });
  }, []);

  // Compute everything here and memoise on tick + user location.
  const data = useMemo(() => {
    const lat = userLocation?.lat;
    const lng = userLocation?.lng;
    return {
      busy:    busyAirportsNear(lat, lng, 200, 6),
      top:     topDeparturesToday(6),
      next:    nextArrivals(30, 8),
      landing: currentlyLanding(8),
      delays:  mostDelayedFlights(8),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, userLocation?.lat, userLocation?.lng]);

  // ── Bottom sheet touch gestures (mirrors Sidebar.jsx) ──
  const handleTouchStart = useCallback((e) => {
    touchStartY.current = e.touches[0].clientY;
    touchDeltaY.current = 0;
  }, []);

  const handleTouchMove = useCallback((e) => {
    const panel = panelRef.current;
    if (!panel) return;
    const delta = e.touches[0].clientY - touchStartY.current;

    if (delta > 0) {
      if (panel.scrollTop > 5) return;
      touchDeltaY.current = delta;
      panel.style.transform  = `translateY(${Math.min(delta * 0.55, 160)}px)`;
      panel.style.transition = 'none';
    } else if (delta < 0 && snapRef.current === 'half') {
      touchDeltaY.current = delta;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    const panel = panelRef.current;
    const delta = touchDeltaY.current;
    if (panel) { panel.style.transform = ''; panel.style.transition = ''; }

    if (delta > 100) {
      if (snapRef.current === 'full') setSnapPoint('half');
      else onClose?.();
    } else if (delta > 40 && snapRef.current === 'full') {
      setSnapPoint('half');
    } else if (delta < -50 && snapRef.current === 'half') {
      setSnapPoint('full');
    }
    touchDeltaY.current = 0;
  }, [onClose]);

  const handleTrackFlight = useCallback(async (flight) => {
    if (!flight?.id) return;
    if (trackedIds.has(flight.id)) {
      notificationService.stopTracking(flight.id);
      return;
    }
    const granted = await notificationService.requestPermission().catch(() => false);
    if (!granted) return;
    await notificationService.trackFlight(flight).catch(() => {});
  }, [trackedIds]);

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

  const totalRows =
    (data.busy?.length ?? 0) + (data.top?.length ?? 0) +
    (data.next?.length ?? 0) + (data.landing?.length ?? 0) +
    (data.delays?.length ?? 0);

  return (
    <aside
      ref={panelRef}
      className="sidebar-panel insights-panel absolute right-4 top-[72px] bottom-16 z-[920] w-80 flex flex-col gap-3 animate-slide-right"
      data-snap={snapPoint}
      style={{
        pointerEvents: 'auto',
        ...(isMobile && {
          maxHeight:  SNAP[snapPoint],
          transition: 'max-height 0.38s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        }),
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Drag handle (mobile only) */}
      <div
        className="flex flex-col items-center pt-3 pb-1 sm:hidden flex-shrink-0 cursor-grab active:cursor-grabbing select-none"
        onTouchStart={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full bg-white/25" />
        <div className="mt-1.5 text-[9px] text-white/20 font-medium tracking-wide uppercase">
          {snapPoint === 'half' ? 'Swipe up for more' : 'Swipe down to collapse'}
        </div>
      </div>

      <GlassCard className="p-4 flex-shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-9 h-9 rounded-xl bg-[#00ffcc]/12 border border-[#00ffcc]/20 flex items-center justify-center">
                <Sparkles size={16} className="text-[#00ffcc]" />
              </span>
              <div className="min-w-0">
                <div className="text-lg font-bold tracking-tight text-white">Flight Insights</div>
                <div className="text-[10px] text-white/45 tracking-[0.18em] uppercase">
                  Live · updated every {Math.round(REFRESH_MS / 1_000)}s
                </div>
              </div>
            </div>
            {userLocation
              ? <div className="text-xs text-white/45">Within 200 mi of your location · {totalRows} signals</div>
              : <div className="text-xs text-white/45">Global snapshot · {totalRows} signals</div>
            }
          </div>

          <button onClick={onClose} className="btn-icon flex-shrink-0" aria-label="Close insights">
            <X size={13} className="text-white/50" />
          </button>
        </div>
      </GlassCard>

      <div className="sm:flex-1 sm:overflow-y-auto space-y-3 pr-0.5">
        {/* 1. Busy airports near you */}
        <InsightsSection
          title="Busy Airports Near You"
          hint={userLocation ? 'Within 200 mi' : 'Global'}
          icon={Building2}
          count={data.busy.length}
          empty="No nearby activity yet"
        >
          {data.busy.map((row) => (
            <AirportRow
              key={`busy-${row.airport.code}`}
              airport={row.airport}
              subtitle={`${row.dep} dep · ${row.arr} arr${row.distanceKm != null ? ` · ${Math.round(row.distanceKm)} km` : ''}`}
              metric={row.total}
              metricLabel="tracked"
              onClick={() => onSelectAirport?.(row.airport)}
            />
          ))}
        </InsightsSection>

        {/* 2. Top departures today */}
        <InsightsSection
          title="Top Departures Today"
          icon={TrendingUp}
          count={data.top.length}
          empty="Waiting for outbound traffic…"
        >
          {data.top.map((row) => (
            <AirportRow
              key={`top-${row.airport.code}`}
              airport={row.airport}
              subtitle={row.sampleFlights
                .slice(0, 3)
                .map((f) => f.callsign)
                .join(' · ') || row.airport.name}
              metric={row.count}
              metricLabel="flights"
              onClick={() => onSelectAirport?.(row.airport)}
            />
          ))}
        </InsightsSection>

        {/* 3. Next arrivals (30 min) */}
        <InsightsSection
          title="Next Arrivals"
          hint="30 min window"
          icon={Plane}
          count={data.next.length}
          empty="No arrivals imminent"
        >
          {data.next.map((row) => (
            <FlightRow
              key={`next-${row.flight.id}`}
              flight={row.flight}
              airline={row.flight.airline}
              subtitle={`${row.origin?.code ?? '----'} → ${row.destination?.code ?? '----'} · ${row.destination?.city ?? ''}`}
              trailing={
                <div className="flex flex-col items-end flex-shrink-0 ml-2">
                  <span className="text-xs font-semibold text-[#00ffcc]">{fmtTime(row.etaMs)}</span>
                  <span className="text-[9px] uppercase tracking-widest text-white/30">{fmtMinutesFromNow(row.etaMs)}</span>
                </div>
              }
              onClick={() => onSelectFlight?.(row.flight)}
              onTrack={() => handleTrackFlight(row.flight)}
              isTracked={trackedIds.has(row.flight.id)}
            />
          ))}
        </InsightsSection>

        {/* 4. Currently landing */}
        <InsightsSection
          title="Currently Landing"
          icon={PlaneLanding}
          count={data.landing.length}
          empty="No aircraft on final approach"
        >
          {data.landing.map((row) => (
            <FlightRow
              key={`land-${row.flight.id}`}
              flight={row.flight}
              airline={row.flight.airline}
              subtitle={row.destination
                ? `Landing ${row.destination.city ?? row.destination.code} · ${(row.altitude ?? 0).toLocaleString()} ft`
                : `On approach · ${(row.altitude ?? 0).toLocaleString()} ft`}
              trailing={
                <div className="flex flex-col items-end flex-shrink-0 ml-2">
                  <span className="text-xs font-semibold text-[#10b981]">{row.speed ?? '—'} kts</span>
                  <span className="text-[9px] uppercase tracking-widest text-white/30">
                    {row.vertRate != null ? `${Math.round(row.vertRate)} fpm` : 'descending'}
                  </span>
                </div>
              }
              onClick={() => onSelectFlight?.(row.flight)}
            />
          ))}
        </InsightsSection>

        {/* 5. Most delayed flights */}
        <InsightsSection
          title="Most Delayed Flights"
          icon={AlertTriangle}
          count={data.delays.length}
          empty="Everything on schedule"
        >
          {data.delays.map((row) => (
            <FlightRow
              key={`delay-${row.flight.id}`}
              flight={row.flight}
              airline={row.flight.airline}
              subtitle={row.origin && row.destination
                ? `${row.origin.code} → ${row.destination.code} · ${row.flight.airline ?? 'Unknown'}`
                : row.flight.airline ?? 'Unknown airline'}
              trailing={
                <div className="flex flex-col items-end flex-shrink-0 ml-2">
                  <span className="text-xs font-semibold text-amber-400">+{row.delayMinutes} min</span>
                  <span className="text-[9px] uppercase tracking-widest text-white/30">
                    <Clock3 size={9} className="inline -mt-0.5 mr-0.5" /> delay
                  </span>
                </div>
              }
              onClick={() => onSelectFlight?.(row.flight)}
              onTrack={() => handleTrackFlight(row.flight)}
              isTracked={trackedIds.has(row.flight.id)}
            />
          ))}
        </InsightsSection>
      </div>
    </aside>
  );
}

// ── Section wrapper ─────────────────────────────────────
function InsightsSection({ title, hint, icon: Icon, count, empty, children }) {
  const isEmpty = !children || (Array.isArray(children) && children.filter(Boolean).length === 0);
  return (
    <GlassCard className="p-3 insights-section">
      <div className="flex items-center justify-between px-1 pb-2">
        <div className="flex items-center gap-2">
          <Icon size={13} className="text-[#00ffcc]/70" />
          <span className="text-[10px] uppercase tracking-widest text-white/55 font-semibold">{title}</span>
          {hint && <span className="text-[9px] text-white/30 uppercase tracking-widest">· {hint}</span>}
        </div>
        <span className="text-[10px] text-white/35 font-semibold">{count}</span>
      </div>
      <Divider />
      <div className="pt-2 space-y-1.5">
        {isEmpty ? (
          <div className="glass-lighter rounded-xl px-3 py-4 text-center">
            <p className="text-[11px] text-white/45">{empty}</p>
          </div>
        ) : children}
      </div>
    </GlassCard>
  );
}
