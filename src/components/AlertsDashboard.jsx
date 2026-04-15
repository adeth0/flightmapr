// ─────────────────────────────────────────────────────────
//  AlertsDashboard — compact panel showing tracked flights.
//  Appears below the TopBar on the right when the bell is clicked.
//  Uses notificationService.subscribeToChanges() for live updates.
// ─────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { X, Bell, BellOff }    from 'lucide-react';
import { notificationService } from '../services/notificationService';

// ── AlertsDashboard ───────────────────────────────────────
export function AlertsDashboard({ onClose }) {
  const [tracked, setTracked] = useState([]);

  useEffect(() => {
    // subscribeToChanges emits immediately with the current list
    return notificationService.subscribeToChanges(setTracked);
  }, []);

  return (
    <div
      className="absolute top-[68px] right-4 z-[950] w-72 glass rounded-2xl overflow-hidden animate-slide-down"
      style={{ pointerEvents: 'auto' }}
    >
      {/* ── Header ─────────────────────────────────────── */}
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

      {/* ── Content ────────────────────────────────────── */}
      <div className="p-3">
        {tracked.length === 0 ? (
          <div className="text-center py-6">
            <BellOff size={26} className="text-white/12 mx-auto mb-2.5" />
            <p className="text-xs text-white/30 font-medium">No flights tracked</p>
            <p className="text-[10px] text-white/20 mt-1 leading-relaxed">
              Select a flight and tap<br />
              <span className="text-amber-400/60">"Track Flight"</span> to get alerts
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {tracked.map((t) => (
              <AlertRow
                key={t.id}
                item={t}
                onRemove={() => notificationService.stopTracking(t.id)}
              />
            ))}
            <p className="text-[9px] text-white/20 text-center mt-2 pt-1 border-t border-white/5">
              Notifications fire on departure · midpoint · arrival
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── AlertRow ──────────────────────────────────────────────
function AlertRow({ item, onRemove }) {
  const origin = item.enrichment?.origin;
  const dest   = item.enrichment?.destination;
  const hasRoute = origin?.code && origin.code !== '----' && dest?.code && dest.code !== '----';

  return (
    <div className="flex items-center gap-3 glass-lighter rounded-xl px-3 py-2.5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-xs font-bold text-amber-400 truncate">{item.callsign}</span>
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400/70 blink-dot flex-shrink-0" />
        </div>
        <div className="text-[10px] text-white/35 truncate">
          {hasRoute
            ? `${origin.code} → ${dest.code}`
            : item.airline && item.airline !== 'Unknown'
              ? item.airline
              : 'Live tracking'}
        </div>
      </div>

      <button
        onClick={onRemove}
        title="Stop tracking"
        className="w-6 h-6 rounded-lg bg-white/5 hover:bg-red-500/20 text-white/25 hover:text-red-400 flex items-center justify-center transition-colors flex-shrink-0"
      >
        <X size={10} />
      </button>
    </div>
  );
}
