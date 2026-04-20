// ─────────────────────────────────────────────────────────
//  LandingIntro — premium first-load experience
//
//  A one-shot-per-session glass overlay that plays while the
//  map + aircraft feed are spinning up behind it. Acts as a
//  "virtual landing animation" — the map is loading tiles and
//  centering on the user's location underneath the frosted
//  backdrop, so when the overlay fades out the user sees live
//  aircraft already populated around them (the "wow" moment).
//
//  Design goals:
//    • Runs once per browser session (sessionStorage flag).
//    • 1.8–2.4s intro animation, CTA available from ~1.2s.
//    • Never blocks usability — dismisses instantly on CTA tap.
//    • Pure CSS keyframes + rAF — no animation libraries.
//    • Safe-area aware for iOS Safari / PWA standalone.
//
//  Phases:
//    1. Backdrop blur + dim eases in (0 → 250ms)
//    2. Logo scales in, headline slides up (150 → 900ms)
//    3. Subtext + CTA + preview cards stagger in (800 → 1600ms)
//    4. User taps "Open Live Map" → 420ms fade-out → unmount
// ─────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import {
  Plane, Clock3, AlertTriangle, Building2, ArrowRight,
} from 'lucide-react';

const INTRO_KEY        = 'flightmapr_intro_v1';
const INTRO_MIN_VISIBLE = 1800;   // don't flash away on fast machines
const INTRO_AUTO_CLOSE  = 12_000; // safety — never block the map forever

function hasSeenIntro() {
  try { return sessionStorage.getItem(INTRO_KEY) === '1'; } catch { return false; }
}
function markIntroSeen() {
  try { sessionStorage.setItem(INTRO_KEY, '1'); } catch { /* private mode */ }
}

export function LandingIntro({ onComplete, onOpenInsights }) {
  const [visible, setVisible] = useState(() => !hasSeenIntro());
  const [closing, setClosing] = useState(false);
  const mountedAt             = useRef(Date.now());
  const hasDismissed          = useRef(false);

  // Returning session visits skip the intro entirely. Fire onComplete
  // synchronously-ish so the parent can unlock DonatePill / DonateToast
  // immediately without waiting for an animation that never plays.
  useEffect(() => {
    if (visible) return;
    onComplete?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Safety auto-close: if the user never taps the CTA (e.g. distracted),
  // never leave the overlay covering the map indefinitely.
  useEffect(() => {
    if (!visible) return;
    const safety = setTimeout(() => handleDismiss(), INTRO_AUTO_CLOSE);
    return () => clearTimeout(safety);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Keyboard: Escape + Enter both dismiss gracefully.
  useEffect(() => {
    if (!visible) return;
    function onKey(e) {
      if (e.key === 'Escape' || e.key === 'Enter') handleDismiss();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function handleDismiss() {
    if (hasDismissed.current) return;
    hasDismissed.current = true;

    const elapsed = Date.now() - mountedAt.current;
    const wait    = Math.max(0, INTRO_MIN_VISIBLE - elapsed);

    // Delay the closing transition until we've been on screen
    // long enough that the animation feels intentional.
    setTimeout(() => {
      setClosing(true);
      markIntroSeen();
      setTimeout(() => {
        setVisible(false);
        onComplete?.();
      }, 440);
    }, wait);
  }

  function handlePreviewTap() {
    // A preview card click dismisses the overlay and, if wired, opens the
    // real InsightsPanel so the "wow" moment continues beyond the intro.
    handleDismiss();
    if (typeof onOpenInsights === 'function') {
      // Run slightly after the dismiss so the fade doesn't compete with
      // the panel's own slide-in animation.
      setTimeout(() => onOpenInsights(), 520);
    }
  }

  if (!visible) return null;

  return (
    <div
      className={`landing-intro ${closing ? 'is-closing' : ''}`}
      role="dialog"
      aria-labelledby="landing-intro-heading"
      aria-modal="true"
    >
      {/* Frosted backdrop — hides the first-frame map flicker */}
      <div className="landing-intro-backdrop" aria-hidden="true" />
      {/* Emerald glow beam — subtle "locking-in" accent */}
      <div className="landing-intro-beam" aria-hidden="true" />

      <div className="landing-intro-content">
        <div className="landing-intro-logo">
          <span className="landing-intro-logo-icon">
            <Plane size={16} strokeWidth={2.4} />
          </span>
          <span className="landing-intro-logo-text metallic-wordmark">FlightMapr</span>
          <span className="landing-intro-logo-dot" aria-hidden="true" />
          <span className="landing-intro-logo-live">Live</span>
        </div>

        <h1 id="landing-intro-heading" className="landing-intro-title">
          See every aircraft flying
          <span className="landing-intro-title-accent"> around you</span>
          <span className="landing-intro-title-break"> — instantly.</span>
        </h1>

        <p className="landing-intro-sub">
          Track planes, helicopters and flights in real time. No login required.
        </p>

        <button
          type="button"
          className="landing-intro-cta"
          onClick={handleDismiss}
          autoFocus
        >
          <span>Open Live Map</span>
          <ArrowRight size={16} strokeWidth={2.6} />
        </button>

        <div className="landing-intro-previews" role="list">
          <PreviewCard
            icon={Building2}
            title="Busy airports"
            hint="Near you"
            onClick={handlePreviewTap}
          />
          <PreviewCard
            icon={Plane}
            title="Next arrivals"
            hint="30 min window"
            onClick={handlePreviewTap}
          />
          <PreviewCard
            icon={AlertTriangle}
            title="Most delayed"
            hint="Live alerts"
            onClick={handlePreviewTap}
          />
        </div>

        <p className="landing-intro-footer">
          Built and maintained independently — support helps keep it running.
        </p>
      </div>
    </div>
  );
}

function PreviewCard({ icon: Icon, title, hint, onClick }) {
  return (
    <button type="button" role="listitem" className="landing-preview-card" onClick={onClick}>
      <span className="landing-preview-icon">
        <Icon size={13} strokeWidth={2.3} />
      </span>
      <span className="landing-preview-text">
        <span className="landing-preview-title">{title}</span>
        <span className="landing-preview-hint">
          <Clock3 size={9} strokeWidth={2.2} className="landing-preview-hint-icon" />
          {hint}
        </span>
      </span>
    </button>
  );
}
