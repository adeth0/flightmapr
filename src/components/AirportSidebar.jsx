import { useEffect, useState } from 'react';
import { Building2, Clock3, MapPin, Plane, X } from 'lucide-react';
import { GlassCard, Divider } from '../ui/GlassCard';
import { airportService } from '../services/airportService';
import { enrichFlight } from '../services/flightEnrichmentService';
import { notificationService } from '../services/notificationService';
import { flightService } from '../services/flightService';

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

export function AirportSidebar({ airportCode, onClose, onCenterMap, onSelectFlight }) {
  const [airport, setAirport] = useState(() => airportService.getAirport(airportCode));
  const [departures, setDepartures] = useState(() => airportService.getScheduledDepartures(airportCode));

  useEffect(() => {
    setAirport(airportService.getAirport(airportCode));
    setDepartures(airportService.getScheduledDepartures(airportCode));

    let cancelled = false;
    const flightsToWarm = flightService.flights
      .filter((flight) => flight.callsign)
      .slice(0, 12);

    Promise.allSettled(flightsToWarm.map((flight) => enrichFlight(flight.callsign))).then(() => {
      if (!cancelled) {
        setDepartures(airportService.getScheduledDepartures(airportCode));
      }
    });

    const unsubscribe = flightService.subscribe(() => {
      setDepartures(airportService.getScheduledDepartures(airportCode));
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [airportCode]);

  if (!airport) return null;

  async function handleFlightPress(item) {
    if (!item.flight) {
      onCenterMap(airport);
      return;
    }
    await notificationService.trackFlight(item.flight).catch(() => {});
    onSelectFlight(item.flight);
  }

  return (
    <aside className="sidebar-panel absolute right-4 top-[72px] bottom-16 z-[900] w-80 flex flex-col gap-3 animate-slide-right">
      <GlassCard className="p-4 flex-shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-9 h-9 rounded-xl bg-[#00ffcc]/12 border border-[#00ffcc]/20 flex items-center justify-center">
                <Building2 size={16} className="text-[#00ffcc]" />
              </span>
              <div>
                <div className="text-lg font-bold tracking-tight text-white">{airport.name}</div>
                <div className="text-xs text-[#00ffcc] font-semibold tracking-[0.18em] uppercase">{airport.code}</div>
              </div>
            </div>
            <div className="text-xs text-white/45">{airport.city}, {airport.country}</div>
          </div>

          <button onClick={onClose} className="btn-icon flex-shrink-0" aria-label="Close airport details">
            <X size={13} className="text-white/50" />
          </button>
        </div>

        <Divider />

        <div className="pt-3 flex items-center justify-between text-xs">
          <div className="text-white/35">Scheduled departures</div>
          <button onClick={() => onCenterMap(airport)} className="text-[#00ffcc] font-semibold">
            Center airport
          </button>
        </div>
      </GlassCard>

      <GlassCard className="p-3 sm:flex-1 sm:overflow-y-auto">
        <div className="text-[10px] uppercase tracking-widest text-white/30 mb-3 px-1">
          Departures ({departures.length})
        </div>

        <div className="space-y-2">
          {departures.length === 0 ? (
            <div className="glass-lighter rounded-xl px-4 py-5 text-center">
              <p className="text-sm text-white/55">No live scheduled departures found right now.</p>
              <p className="text-[11px] text-white/30 mt-1">This list updates from the current tracked ADS-B feed.</p>
            </div>
          ) : departures.map((item) => (
            <button
              key={item.flight?.id ?? item.id ?? `${airportCode}-${item.destination?.code ?? 'unknown'}`}
              onClick={() => handleFlightPress(item)}
              className="airport-flight-row w-full text-left"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Plane size={13} className="text-[#00ffcc] flex-shrink-0" />
                    <span className="text-sm font-semibold text-white truncate">{item.flight?.callsign ?? item.flightNumber}</span>
                    {item.isFallback && (
                      <span className="text-[9px] rounded px-1.5 py-0.5 bg-white/8 text-white/45 uppercase tracking-wide">
                        Scheduled
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
                <ProgressPill progress={item.progress} />
              </div>
            </button>
          ))}
        </div>
      </GlassCard>
    </aside>
  );
}
