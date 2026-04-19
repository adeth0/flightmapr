import { useEffect, useState, useRef, useMemo } from 'react';
import { Bell, Building2, Clock3, MapPin, Plane, X } from 'lucide-react';
import { GlassCard, Divider } from '../ui/GlassCard';
import { airportService } from '../services/airportService';
import { enrichFlight } from '../services/flightEnrichmentService';
import { notificationService } from '../services/notificationService';
import { flightService } from '../services/flightService';
import { AirlineLogo } from './AirlineLogo.jsx';

// ── Snap point heights (mobile bottom sheet) ──────────────
// Matches Sidebar.jsx so the two sheets feel identical to the user.
const SNAP = { half: '62dvh', full: '92dvh' };

function formatTime(ms) {
  if (!ms) return 'Scheduled time unavailable';
  return new Date(ms).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function formatDelay(delayMinutes) {
  if (!delayMinutes) return 'On time';
  return `+${delayMinutes} min`;
}

function ProgressPill({ progress }) {
  if (progress == null) return null;

  const pct = Math.round(progress * 100);
  return (
    <div className="airport-progress-pill">
      <div className="airport-progress-pill-track">
        <div className="airport-progress-pill-fill" style={{ width: `${pct}%` }} />
      </div>
      <span>{pct}%</span>
    </div>
  );
}

// Arrival row — reuses airport-flight-row styles for consistency.
function ArrivalRow({ flight, onSelectFlight }) {
  return (
    <div className="airport-flight-row">
      <div className="airport-flight-actions">
        <button
          type="button"
          onClick={() => onSelectFlight(flight)}
          className="min-w-0 flex-1 text-left flex items-start gap-2.5"
        >
          <AirlineLogo callsign={flight.callsign} airline={flight.airline} size={32} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Plane size={12} className="text-[#10b981] flex-shrink-0 -rotate-90" />
              <span className="text-sm font-semibold text-white truncate">{flight.callsign}</span>
              {flight.isLive && (
                <span className="text-[9px] rounded px-1.5 py-0.5 bg-red-400/15 text-red-400 uppercase tracking-wide font-semibold">
                  Live
                </span>
              )}
            </div>
            <div className="text-xs text-white/45 mt-1 truncate">
              From {flight.origin?.city ?? flight.origin?.code ?? '—'}
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-white/45">
              <span className="flex items-center gap-1">
                <MapPin size={11} />
                {flight.origin?.code ?? '----'}
              </span>
              <span className="text-white/30 uppercase tracking-wide font-semibold">
                {flight.airline?.split(' ')[0] ?? 'Unknown'}
              </span>
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}

export function AirportSidebar({ airportCode, onClose, onCenterMap, onSelectFlight }) {
  const [airport, setAirport]       = useState(() => airportService.getAirport(airportCode));
  const [departures, setDepartures] = useState(() => airportService.getScheduledDepartures(airportCode));
  const [arrivals, setArrivals]     = useState(() => airportService.getArrivals(airportCode));
  const [trackedIds, setTrackedIds] = useState(() => new Set());
  const [tab, setTab]               = useState('departures'); // 'departures' | 'arrivals'
  const [snapPoint, setSnapPoint]   = useState('half');

  // ── Mobile bottom sheet refs (mirror Sidebar.jsx behaviour) ──
  const panelRef    = useRef(null);
  const touchStartY = useRef(0);
  const touchDeltaY = useRef(0);
  const snapRef     = useRef('half');

  useEffect(() => { snapRef.current = snapPoint; }, [snapPoint]);

  useEffect(() => {
    setAirport(airportService.getAirport(airportCode));
    setDepartures(airportService.getScheduledDepartures(airportCode));
    setArrivals(airportService.getArrivals(airportCode));

    let cancelled = false;
    const flightsToWarm = flightService.flights
      .filter((flight) => flight.callsign)
      .slice(0, 12);

    Promise.allSettled(flightsToWarm.map((flight) => enrichFlight(flight.callsign))).then(() => {
      if (!cancelled) {
        setDepartures(airportService.getScheduledDepartures(airportCode));
      }
    });

    const unsubscribeFlights = flightService.subscribe(() => {
      setDepartures(airportService.getScheduledDepartures(airportCode));
      setArrivals(airportService.getArrivals(airportCode));
    });

    const unsubscribeTracked = notificationService.subscribeToChanges((list) => {
      setTrackedIds(new Set(list.map((item) => item.id)));
    });

    return () => {
      cancelled = true;
      unsubscribeFlights();
      unsubscribeTracked();
    };
  }, [airportCode]);

  // ── Bottom-sheet touch gestures ─────────────────────────
  function handleTouchStart(e) {
    touchStartY.current = e.touches[0].clientY;
    touchDeltaY.current = 0;
  }

  function handleTouchMove(e) {
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
  }

  function handleTouchEnd() {
    const panel = panelRef.current;
    const delta = touchDeltaY.current;

    if (panel) {
      panel.style.transform  = '';
      panel.style.transition = '';
    }

    if (delta > 100) {
      if (snapRef.current === 'full') {
        setSnapPoint('half');
      } else {
        onClose();
      }
    } else if (delta > 40 && snapRef.current === 'full') {
      setSnapPoint('half');
    } else if (delta < -50 && snapRef.current === 'half') {
      setSnapPoint('full');
    }

    touchDeltaY.current = 0;
  }

  const activeList = tab === 'departures' ? departures : arrivals;
  const activeLen  = activeList.length;

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

  const liveDepartureCount = useMemo(
    () => departures.filter((item) => !item.isFallback).length,
    [departures],
  );
  const scheduledCount = departures.length - liveDepartureCount;

  if (!airport) return null;

  function handleFlightPress(item) {
    if (!item.flight) {
      onCenterMap(airport);
      return;
    }
    onSelectFlight(item.flight);
  }

  async function handleTrack(item) {
    const trackedId = item.flight?.id ?? item.id;
    if (trackedIds.has(trackedId)) {
      notificationService.stopTracking(trackedId);
      return;
    }

    if (item.flight) {
      await notificationService.trackFlight(item.flight).catch(() => {});
      return;
    }

    await notificationService.trackScheduledFlight(item, airport).catch(() => {});
  }

  return (
    <aside
      ref={panelRef}
      className="sidebar-panel absolute right-4 top-[72px] bottom-16 z-[900] w-80 flex flex-col gap-3 animate-slide-right"
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
      {/* ── Drag handle (mobile only) ─────────────────── */}
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
                <Building2 size={16} className="text-[#00ffcc]" />
              </span>
              <div className="min-w-0">
                <div className="text-lg font-bold tracking-tight text-white truncate">{airport.name}</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-[#00ffcc] font-semibold tracking-[0.18em] uppercase">{airport.code}</span>
                  {airport.icao && airport.icao !== '----' && (
                    <span className="text-[10px] text-white/35 font-semibold tracking-[0.18em] uppercase">ICAO {airport.icao}</span>
                  )}
                </div>
              </div>
            </div>
            <div className="text-xs text-white/45">{airport.city}, {airport.country}</div>
          </div>

          <button onClick={onClose} className="btn-icon flex-shrink-0" aria-label="Close airport details">
            <X size={13} className="text-white/50" />
          </button>
        </div>

        <Divider />

        {/* ── Segmented tab control — Departures / Arrivals ── */}
        <div className="pt-3 flex items-center justify-between gap-3">
          <div className="airport-tab-group" role="tablist" aria-label="Flight direction">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'departures'}
              onClick={() => setTab('departures')}
              className={`airport-tab ${tab === 'departures' ? 'is-active' : ''}`}
            >
              Departures
              <span className="airport-tab-count">{departures.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'arrivals'}
              onClick={() => setTab('arrivals')}
              className={`airport-tab ${tab === 'arrivals' ? 'is-active' : ''}`}
            >
              Arrivals
              <span className="airport-tab-count">{arrivals.length}</span>
            </button>
          </div>

          <button onClick={() => onCenterMap(airport)} className="text-[10px] text-[#00ffcc] font-semibold uppercase tracking-[0.15em] hover:underline">
            Center
          </button>
        </div>
      </GlassCard>

      <GlassCard className="p-3 sm:flex-1 sm:overflow-y-auto">
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="text-[10px] uppercase tracking-widest text-white/30">
            {tab === 'departures' ? 'Departures (next 24h)' : 'Arrivals (live)'}
          </div>
          <div className="text-[10px] text-white/30">
            {tab === 'departures'
              ? `${liveDepartureCount} live · ${scheduledCount} scheduled`
              : `${activeLen} tracked`}
          </div>
        </div>

        <div className="space-y-2">
          {activeLen === 0 ? (
            <div className="glass-lighter rounded-xl px-4 py-5 text-center">
              <p className="text-sm text-white/55">
                {tab === 'departures'
                  ? 'No scheduled departures found right now.'
                  : 'No live arrivals being tracked right now.'}
              </p>
              <p className="text-[11px] text-white/30 mt-1">
                This list updates from the current tracked ADS-B feed.
              </p>
            </div>
          ) : tab === 'departures' ? (
            departures.map((item) => {
              const trackedId = item.flight?.id ?? item.id;
              const isTracked = trackedIds.has(trackedId);

              return (
                <div
                  key={trackedId ?? `${airportCode}-${item.destination?.code ?? 'unknown'}`}
                  className="airport-flight-row"
                >
                  <div className="airport-flight-actions">
                    <button
                      type="button"
                      onClick={() => handleFlightPress(item)}
                      className="min-w-0 flex-1 text-left flex items-start gap-2.5"
                    >
                      <AirlineLogo
                        callsign={item.flight?.callsign ?? item.flightNumber}
                        airline={item.flight?.airline}
                        size={32}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Plane size={12} className="text-[#00ffcc] flex-shrink-0" />
                          <span className="text-sm font-semibold text-white truncate">{item.flight?.callsign ?? item.flightNumber}</span>
                          {item.isFallback ? (
                            <span className="text-[9px] rounded px-1.5 py-0.5 bg-white/8 text-white/45 uppercase tracking-wide">
                              Scheduled
                            </span>
                          ) : (
                            <span className="text-[9px] rounded px-1.5 py-0.5 bg-red-400/15 text-red-400 uppercase tracking-wide font-semibold">
                              Live
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-white/45 mt-1 truncate">
                          {item.destination?.name ?? item.destination?.city ?? 'Destination unavailable'}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-white/45">
                          <span className="flex items-center gap-1">
                            <Clock3 size={11} />
                            {formatTime(item.scheduledDepartureMs)}
                          </span>
                          <span className="flex items-center gap-1">
                            <MapPin size={11} />
                            {item.destination?.code ?? '----'}
                          </span>
                          <span className={`font-semibold ${item.delayMinutes ? 'text-amber-400' : 'text-[#00ffcc]'}`}>
                            {formatDelay(item.delayMinutes)}
                          </span>
                        </div>
                      </div>
                    </button>

                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <ProgressPill progress={item.progress} />
                      <button
                        type="button"
                        className={`airport-track-btn ${isTracked ? 'is-active' : ''}`}
                        onClick={() => handleTrack(item)}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <Bell size={11} />
                          {isTracked ? 'Tracking' : 'Track'}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            arrivals.map((flight) => (
              <ArrivalRow
                key={flight.id}
                flight={flight}
                onSelectFlight={onSelectFlight}
              />
            ))
          )}
        </div>
      </GlassCard>
    </aside>
  );
}
