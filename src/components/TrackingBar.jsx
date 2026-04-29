// ─────────────────────────────────────────────────────────
//  TrackingBar — fixed banner shown while a flight is followed.
//
//  Clicking / tapping:
//    1. Centers the map on the tracked aircraft (onFlyTo)
//    2. Opens the flight detail sidebar (onSelect)
//
//  Hides automatically on mobile when the sidebar is open
//  (handled via CSS .flight-selected .tracking-bar).
// ─────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { Navigation2 } from 'lucide-react';
import { flightService } from '../services/flightService';

export function TrackingBar({ followFlightId, onSelect, onFlyTo, onResumeFollow }) {
  const [flight, setFlight] = useState(() =>
    followFlightId ? flightService.getFlight(followFlightId) : null
  );

  // Keep flight data current while tracking
  useEffect(() => {
    if (!followFlightId) { setFlight(null); return; }
    setFlight(flightService.getFlight(followFlightId));
    const unsub = flightService.subscribe((flights) => {
      const f = flights.find((x) => x.id === followFlightId);
      if (f) setFlight({ ...f });
    });
    return unsub;
  }, [followFlightId]);

  if (!followFlightId || !flight) return null;

  // Centers map + opens sidebar; does NOT stop follow mode
  function handleTap(e) {
    e.preventDefault();
    e.stopPropagation();
    // If follow-pan was paused (e.g. user dragged the map), resume immediately.
    onResumeFollow?.();
    onFlyTo(followFlightId);
    onSelect(flight);
  }

  const dest = flight.destination?.code;
  const destLabel =
    dest && dest !== 'UNK' && dest !== '---' && dest !== '----'
      ? ` → ${dest}`
      : '';

  return (
    <button
      className="tracking-bar"
      onClick={handleTap}
      aria-label={`Following ${flight.callsign}. Tap to center map.`}
    >
      <span className="tracking-bar-dot" aria-hidden="true" />
      <Navigation2
        size={11}
        className="flex-shrink-0"
        style={{ color: '#38BDF8' }}
        aria-hidden="true"
      />
      <span className="tracking-bar-label">
        Following <strong>{flight.callsign}</strong>
        {destLabel}
      </span>
      <span className="tracking-bar-cta hidden sm:inline">Tap to center</span>
    </button>
  );
}
