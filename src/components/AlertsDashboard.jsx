import { useEffect, useState } from 'react';
import { X, Bell, BellOff } from 'lucide-react';
import { notificationService } from '../services/notificationService';
import { flightService } from '../services/flightService';

export function AlertsDashboard({ onClose, onFocusFlight }) {
  const [tracked, setTracked] = useState([]);

  useEffect(() => notificationService.subscribeToChanges(setTracked), []);

  // Keep re-render in sync with live flight updates so a scheduled
  // flight that just went live will be handed a real flight object
  // on the next click.
  useEffect(() => {
    const unsub = flightService.subscribe(() => {
      // Pull a fresh tracked list — values may have live data attached.
      setTracked((prev) => prev.slice());
    });
    return unsub;
  }, []);

  function handleRowClick(item) {
    // Only live (airborne) flights can be focused on the map.
    // Scheduled items that haven't departed yet don't have a
    // position, so we just show a gentle visual "nope" and keep
    // the alerts panel open.
    if (item.kind === 'scheduled') {
      const maybe = flightService.getFlight(item.id)
        ?? flightService.search(item.callsign ?? item.flightNumber ?? '')[0];
      if (!maybe) return;
      onFocusFlight?.(maybe);
      return;
    }

    const flight = flightService.getFlight(item.id);
    if (!flight) return;
    onFocusFlight?.(flight);
  }

  return (
    <div
      className="absolute top-[68px] right-4 z-[950] w-72 glass rounded-2xl overflow-hidden animate-slide-down"
      style={{ pointerEvents: 'auto' }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Bell size={13} className="text-amber-400" />
          <span className="text-xs font-semibold text-white">Flight Alerts</span>
          {tracked.length > 0 && (
            <span className="text-[9px] bg-amber-400/20 text-amber-400 rounded-full px-1.5 py-0.5 font-bold leading-none">
              {tracked.length}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
          aria-label="Close alerts"
        >
          <X size={11} className="text-white/50" />
        </button>
      </div>

      <div className="p-3">
        {tracked.length === 0 ? (
          <div className="text-center py-6">
            <BellOff size={26} className="text-white/12 mx-auto mb-2.5" />
            <p className="text-xs text-white/30 font-medium">No flights tracked</p>
            <p className="text-[10px] text-white/20 mt-1 leading-relaxed">
              Select a flight and tap<br />
              <span className="text-amber-400/60">Track</span> to get alerts
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {tracked.map((item) => (
              <AlertRow
                key={item.id}
                item={item}
                onRemove={() => notificationService.stopTracking(item.id)}
                onClick={() => handleRowClick(item)}
              />
            ))}
            <p className="text-[9px] text-white/20 text-center mt-2 pt-1 border-t border-white/5">
              Tap a flight to focus it on the map
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function AlertRow({ item, onRemove, onClick }) {
  const origin = item.enrichment?.origin;
  const dest = item.enrichment?.destination;
  const hasRoute = origin?.code && origin.code !== '----' && dest?.code && dest.code !== '----';
  const statusLine = item.kind === 'scheduled'
    ? item.status === 'departed'
      ? 'Scheduled tracking · departed'
      : 'Scheduled tracking'
    : 'Live tracking';

  // An alert is "focusable" if we can resolve a live aircraft for it.
  // Live-tracked items: matched by their ICAO hex id directly.
  // Scheduled items: matched by callsign once the flight is airborne.
  const canFocus = (() => {
    if (flightService.getFlight(item.id)) return true;
    const cs = (item.callsign ?? item.flightNumber ?? '').toString().toUpperCase().replace(/\s+/g, '');
    if (!cs) return false;
    return (flightService.search(cs) ?? []).length > 0;
  })();

  const handleClick = (e) => {
    // If the click originated from the remove (×) button, don't trigger focus.
    if (e.defaultPrevented) return;
    if (canFocus) onClick?.();
  };

  const handleRemove = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onRemove?.();
  };

  return (
    <div
      className={`alert-row-btn ${canFocus ? '' : 'alert-row-disabled'}`}
      role={canFocus ? 'button' : undefined}
      tabIndex={canFocus ? 0 : -1}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (!canFocus) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      title={canFocus ? 'Focus on map' : 'Awaiting live data'}
      style={{ cursor: canFocus ? 'pointer' : 'default' }}
    >
      <div className="alert-row-body flex items-center gap-3 glass-lighter rounded-xl px-3 py-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-xs font-bold text-amber-400 truncate">{item.flightNumber ?? item.callsign}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400/70 blink-dot flex-shrink-0" />
          </div>
          <div className="text-[10px] text-white/35 truncate">
            {hasRoute
              ? `${origin.code} → ${dest.code}`
              : item.airline && item.airline !== 'Unknown'
                ? item.airline
                : statusLine}
          </div>
        </div>

        <button
          onClick={handleRemove}
          title="Stop tracking"
          aria-label={`Stop tracking ${item.flightNumber ?? item.callsign}`}
          className="w-6 h-6 rounded-lg bg-white/5 hover:bg-red-500/20 text-white/25 hover:text-red-400 flex items-center justify-center transition-colors flex-shrink-0"
        >
          <X size={10} />
        </button>
      </div>
    </div>
  );
}
