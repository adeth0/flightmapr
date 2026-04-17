// ─────────────────────────────────────────────────────────
//  FeedbackFab — floating circular button (bottom-right).
//
//  Tap: reveals two actions
//    • Feedback  → mailto: composer (works on iOS, Android, Desktop)
//    • Donate    → Stripe checkout (same link used elsewhere)
//
//  Placement:
//    • Uses position: fixed so the App root's overflow:hidden
//      cannot clip it (critical for iOS PWA standalone mode).
//    • Sits above the StatusBar / InstallBanner; away from the
//      Leaflet zoom control (which lives on the left edge).
//    • Respects env(safe-area-inset-bottom) for iPhone notch +
//      home-indicator safe areas.
//
//  Gestures: clicking the map behind the expanded menu collapses
//  it (outside-tap listener). This never captures map gestures
//  because the FAB lives in its own stacking context and the
//  outside-tap listener only fires on click/touch events bubbling
//  up to the document — Leaflet continues to receive events first.
// ─────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { Plus, X, MessageSquare, Heart } from 'lucide-react';

const DONATE_URL = 'https://donate.stripe.com/8x27sMaIf3Cm5O0gFEc7u00';
const FEEDBACK_EMAIL = 'FlightMapr@kavauralabs.com';
const FEEDBACK_SUBJECT = 'FlightMapr Feedback';
const FEEDBACK_BODY =
  "Hi FlightMapr team,\n\n" +
  "I'd love to share some feedback:\n\n" +
  "• What I like:\n" +
  "• What could be better:\n" +
  "• Anything else:\n\n" +
  "Thanks!";

function buildMailto() {
  const params = new URLSearchParams({
    subject: FEEDBACK_SUBJECT,
    body: FEEDBACK_BODY,
  });
  // mailto RFC uses '%20' for spaces — URLSearchParams uses '+' which some
  // iOS Mail clients mis-handle inside the body. Normalise to %20 so the
  // body template renders correctly on iOS, Android and Desktop clients.
  const encoded = params.toString().replace(/\+/g, '%20');
  return `mailto:${FEEDBACK_EMAIL}?${encoded}`;
}

export function FeedbackFab() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  // Close the menu when tapping/clicking anywhere outside it.
  // Bound at document level but intentionally does NOT stop
  // event propagation, so the map still receives gestures.
  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside, { passive: true });
    document.addEventListener('touchstart', handleOutside, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [open]);

  // Close menu if user hits Escape (desktop).
  useEffect(() => {
    if (!open) return;
    function handleKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const handleFeedback = () => {
    // Use assign to the mailto URL — this works uniformly on iOS Safari,
    // Android Chrome and Desktop. window.open() with a mailto: can be
    // blocked as a popup on Safari; location assignment is not.
    try {
      window.location.href = buildMailto();
    } catch {
      // Fallback: plain anchor click (very unlikely to hit).
      const a = document.createElement('a');
      a.href = buildMailto();
      a.click();
    }
    setOpen(false);
  };

  const handleDonate = () => {
    // Open in a new tab so the user does not lose the live map view.
    window.open(DONATE_URL, '_blank', 'noopener,noreferrer');
    setOpen(false);
  };

  return (
    <div
      ref={containerRef}
      className={`feedback-fab-root${open ? ' is-open' : ''}`}
      // Capture pointer events only on the fab itself — map remains interactive
      style={{ pointerEvents: 'none' }}
    >
      {/* Reveal menu — Feedback (bottom) + Donate (top), stacked above the FAB */}
      <div
        className="feedback-fab-menu"
        role="menu"
        aria-hidden={!open}
        // When closed, block pointer events so map gestures pass through.
        style={{ pointerEvents: open ? 'auto' : 'none' }}
      >
        <button
          type="button"
          role="menuitem"
          className="feedback-fab-item feedback-fab-item-donate"
          onClick={handleDonate}
          tabIndex={open ? 0 : -1}
          aria-label="Donate to FlightMapr"
        >
          <span className="feedback-fab-item-label">Donate</span>
          <span className="feedback-fab-item-icon">
            <Heart size={16} strokeWidth={2.2} />
          </span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="feedback-fab-item feedback-fab-item-feedback"
          onClick={handleFeedback}
          tabIndex={open ? 0 : -1}
          aria-label="Send feedback via email"
        >
          <span className="feedback-fab-item-label">Feedback</span>
          <span className="feedback-fab-item-icon">
            <MessageSquare size={16} strokeWidth={2.2} />
          </span>
        </button>
      </div>

      {/* Trigger — small circular FAB */}
      <button
        type="button"
        className="feedback-fab-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={open ? 'Close support menu' : 'Open support menu'}
        style={{ pointerEvents: 'auto' }}
      >
        <span className="feedback-fab-trigger-icon" aria-hidden="true">
          {open ? <X size={18} strokeWidth={2.6} /> : <Plus size={18} strokeWidth={2.6} />}
        </span>
      </button>
    </div>
  );
}
