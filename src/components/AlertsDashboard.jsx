import { useEffect, useRef, useState } from 'react';
import { X, Bell, BellOff } from 'lucide-react';
import { notificationService } from '../services/notificationService';
import { flightService } from '../services/flightService';

export function AlertsDashboard({ onClose, onFocusFlight }) {
  const [tracked, setTracked] = useState([]);
  // Per-row "locating…" state. We key by tracked id so only the row
  // the user actually tapped shows a spinner while a global lookup
  // is in-flight via openSkyService.
  const [resolvingId, setResolvingId] = useState(null);

  useEffect(() => notificationService.subscribeToChanges(setTracked), []);

  // Keep re-render in sync with live flight updates so a scheduled
  // flight that just went live will be reflected on the next render
  // (and is immediately targetable by the click handler below).
  useEffect(() => {
    const unsub = flightService.subscribe(() => {
      setTracked((prev) => prev.slice());
    });
    return unsub;
  }, []);

  async function handleRowClick(item) {
    if (!item?.id || resolvingId === item.id) return;
    setResolvingId(item.id);
    try {
      // The parent (App.jsx / handleAlertFocus) is responsible for:
      //   1. finding the aircraft in flightService,
      //   2. falling back to a global airplanes.live fetch,
      //   3. upserting + flyTo + follow.
      // We `await` so the spinner stays visible until the work is done.
      await Promise.resolve(onFocusFlight?.(item));
    } finally {
      setResolvingId((prev) => (prev === item.id ? null : prev));
    }
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
                resolving={resolvingId === item.id}
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

function AlertRow({ item, resolving, onRemove, onClick }) {
  const origin = item.enrichment?.origin;
  const dest = item.enrichment?.destination;
  const hasRoute = origin?.code && origin.code !== '----' && dest?.code && dest.code !== '----';
  const statusLine = item.kind === 'scheduled'
    ? item.status === 'departed'
      ? 'Scheduled tracking · departed'
      : 'Scheduled tracking'
    : 'Live tracking';

  // We intentionally avoid any "canFocus" pre-gate here. Previously
  // rows only fired click when the aircraft was already in the local
  // viewport feed, which made the alerts panel feel broken for the
  // common case of "flight I'm tracking is elsewhere in the world".
  // The parent now resolves the aircraft (locally → callsign search →
  // global airplanes.live hex/callsign lookup → upsert) on every tap.

  // Guard against a re-fire caused by the × (remove) button bubbling
  // a synthesized click up to the row after stopPropagation on some
  // older iOS builds.
  const suppressUntil = useRef(0);

  const fireClick = (e) => {
    if (resolving) return;
    if (e?.defaultPrevented) return;
    const now = Date.now();
    if (now < suppressUntil.current) return;
    suppressUntil.current = now + 350;
    onClick?.();
  };

  const handleKeyDown = (e) => {
    if (resolving) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick?.();
    }
  };

  const handleRemove = (e) => {
    // Prevent the row click from firing when the user taps ×.
    e.preventDefault();
    e.stopPropagation();
    suppressUntil.current = Date.now() + 400;
    onRemove?.();
  };

  return (
    <div
      className={`alert-row-btn${resolving ? ' is-resolving' : ''}`}
      role="button"
      tabIndex={0}
      aria-busy={resolving ? 'true' : undefined}
      // onClick covers desktop mouse, Android tap, iOS Safari tap, and
      // keyboard-activated click. `touch-action: manipulation` (below)
      // removes the 300ms iOS double-tap delay so taps feel instant.
      onClick={fireClick}
      onKeyDown={handleKeyDown}
      title={resolving ? 'Locating aircraft…' : 'Focus on map'}
      style={{
        cursor: resolving ? 'progress' : 'pointer',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <div className="alert-row-body flex items-center gap-3 glass-lighter rounded-xl px-3 py-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-xs font-bold text-amber-400 truncate">{item.flightNumber ?? item.callsign}</span>
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                resolving ? 'bg-emerald-400 alert-row-loading-dot' : 'bg-amber-400/70 blink-dot'
              }`}
            />
          </div>
          <div className="text-[10px] text-white/35 truncate">
            {resolving
              ? 'Locating aircraft…'
              : hasRoute
                ? `${origin.code} → ${dest.code}`
                : item.airline && item.airline !== 'Unknown'
                  ? item.airline
                  : statusLine}
          </div>
        </div>

        <button
          type="button"
          onClick={handleRemove}
          onPointerDown={(e) => e.stopPropagation()}
          title="Stop tracking"
          aria-label={`Stop tracking ${item.flightNumber ?? item.callsign}`}
          className="w-6 h-6 rounded-lg bg-white/5 hover:bg-red-500/20 text-white/25 hover:text-red-400 flex items-center justify-center transition-colors flex-shrink-0"
          style={{ touchAction: 'manipulation' }}
        >
          <X size={10} />
        </button>
      </div>
    </div>
  );
}
