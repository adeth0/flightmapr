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
      className="alerts-panel animate-slide-down"
      style={{ pointerEvents: 'auto' }}
      role="dialog"
      aria-label="Flight alerts"
    >
      <div className="alerts-panel-header">
        <div className="alerts-panel-title-row">
          <Bell size={13} className="alerts-panel-bell" aria-hidden="true" />
          <span className="alerts-panel-title">Flight Alerts</span>
          {tracked.length > 0 && (
            <span className="alerts-panel-count">{tracked.length}</span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="alerts-panel-close"
          aria-label="Close alerts"
        >
          <X size={11} aria-hidden="true" />
        </button>
      </div>

      <div className="alerts-panel-body">
        {tracked.length === 0 ? (
          <div className="alerts-panel-empty">
            <BellOff size={26} className="alerts-panel-empty-icon" aria-hidden="true" />
            <p className="alerts-panel-empty-title">No flights tracked</p>
            <p className="alerts-panel-empty-hint">
              Select a flight and tap<br />
              <span className="alerts-panel-empty-accent">Track</span> to get alerts
            </p>
          </div>
        ) : (
          <div className="alerts-panel-list">
            {tracked.map((item) => (
              <AlertRow
                key={item.id}
                item={item}
                resolving={resolvingId === item.id}
                onRemove={() => notificationService.stopTracking(item.id)}
                onClick={() => handleRowClick(item)}
              />
            ))}
            <p className="alerts-panel-foot">
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
      <div className="alert-row-body">
        <div className="alert-row-main">
          <div className="alert-row-heading">
            <span className="alert-row-cs">{item.flightNumber ?? item.callsign}</span>
            <span
              className={`alert-row-dot ${resolving ? 'alert-row-loading-dot' : 'blink-dot'}`}
              aria-hidden="true"
            />
          </div>
          <div className="alert-row-sub">
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
          className="alert-row-remove"
          style={{ touchAction: 'manipulation' }}
        >
          <X size={10} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
