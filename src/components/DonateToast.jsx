// ─────────────────────────────────────────────────────────
//  DonateToast — subtle, session-dismissible donation prompt.
//
//  Triggered once per session when EITHER:
//    • user tracks a new flight (tracked list grows), or
//    • the app has been open for >30 s without dismissal.
//
//  Behaviour:
//    • Slides in from bottom with a gentle glass pill.
//    • Always dismissible via the × button (no dark patterns).
//    • Sets a sessionStorage flag on dismiss / donation tap so
//      the toast never re-triggers within the same session.
//    • Hidden automatically while the LandingIntro is on screen
//      so the first-paint UX stays uncluttered.
// ─────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { Heart, X } from 'lucide-react';
import { notificationService } from '../services/notificationService';

const DONATE_URL          = 'https://donate.stripe.com/8x27sMaIf3Cm5O0gFEc7u00';
const DONATE_TOAST_KEY    = 'flightmapr_donate_toast_v1';
const IDLE_TRIGGER_MS     = 30_000;
const AUTO_HIDE_MS        = 14_000;

function hasSeenToast() {
  try { return sessionStorage.getItem(DONATE_TOAST_KEY) === '1'; } catch { return false; }
}
function markToastSeen() {
  try { sessionStorage.setItem(DONATE_TOAST_KEY, '1'); } catch { /* private mode */ }
}

export function DonateToast({ enabled }) {
  const [open, setOpen]       = useState(false);
  const [closing, setClosing] = useState(false);
  const baselineRef           = useRef(null); // initial tracked-list size
  const hideTimerRef          = useRef(null);

  // Only arm the toast once the intro is complete. This prevents it from
  // competing with the landing overlay's animations.
  useEffect(() => {
    if (!enabled)   return;
    if (hasSeenToast()) return;

    const idleTimer = setTimeout(() => {
      if (!hasSeenToast()) setOpen(true);
    }, IDLE_TRIGGER_MS);

    // Show the toast when the user tracks a new flight.
    const unsub = notificationService.subscribeToChanges((list) => {
      // subscribeToChanges fires immediately with the current list — treat
      // that first invocation as the baseline; only react to subsequent
      // growth beyond it.
      if (baselineRef.current == null) {
        baselineRef.current = list.length;
        return;
      }
      if (list.length > baselineRef.current) {
        baselineRef.current = list.length;
        if (!hasSeenToast()) setOpen(true);
      } else {
        baselineRef.current = list.length;
      }
    });

    return () => {
      clearTimeout(idleTimer);
      unsub?.();
    };
  }, [enabled]);

  // Auto-hide (still counts as seen) so it doesn't linger indefinitely.
  useEffect(() => {
    if (!open || closing) return;
    hideTimerRef.current = setTimeout(() => handleClose(), AUTO_HIDE_MS);
    return () => clearTimeout(hideTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, closing]);

  function handleClose() {
    if (closing) return;
    setClosing(true);
    setTimeout(() => {
      markToastSeen();
      setOpen(false);
      setClosing(false);
    }, 280);
  }

  function handleDonate() {
    window.open(DONATE_URL, '_blank', 'noopener,noreferrer');
    handleClose();
  }

  if (!open) return null;

  return (
    <div
      className={`donate-toast ${closing ? 'is-closing' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className="donate-toast-icon" aria-hidden="true">
        <Heart size={13} strokeWidth={2.4} />
      </span>
      <div className="donate-toast-text">
        <div className="donate-toast-title">Enjoying FlightMapr?</div>
        <div className="donate-toast-body">Support its development</div>
      </div>
      <button type="button" className="donate-toast-cta" onClick={handleDonate}>
        Donate
      </button>
      <button
        type="button"
        className="donate-toast-close"
        onClick={handleClose}
        aria-label="Dismiss donation prompt"
      >
        <X size={12} strokeWidth={2.4} />
      </button>
    </div>
  );
}
