// ─────────────────────────────────────────────────────────
//  Onboarding — 3-slide first-run experience
//  Shows only once (localStorage flag: flightmapr_onboarded).
//  Last slide requests notification permission.
// ─────────────────────────────────────────────────────────

import { useState } from 'react';
import { notificationService } from '../services/notificationService';
import logoSrc from '../assets/flightmapr-logo.png';

export const ONBOARDING_KEY = 'flightmapr_onboarded';
export const hasOnboarded    = () => !!localStorage.getItem(ONBOARDING_KEY);

// ── Slide definitions ─────────────────────────────────────
const SLIDES = [
  {
    emoji:    '✈️',
    color:    '#E8E8E8',
    title:    'Track Flights in Real-Time',
    body:     'See live aircraft positions updated every 15 seconds from real ADS-B transponders worldwide.',
  },
  {
    emoji:    '🗺️',
    color:    '#FFD700',
    title:    'Tap Any Aircraft for Live Data',
    body:     'Altitude, speed, route, delay status, and ETA — all in one card. Tap once for a preview, again for full details.',
  },
  {
    emoji:    '🔔',
    color:    '#f59e0b',
    title:    'Never Miss a Landing',
    body:     'Get instant push notifications on takeoff, at the midpoint, and when your tracked flight lands safely.',
  },
];

export function Onboarding({ onComplete }) {
  const [slide,   setSlide]   = useState(0);
  const [leaving, setLeaving] = useState(false);

  const isLast = slide === SLIDES.length - 1;
  const { emoji, color, title, body } = SLIDES[slide];

  // Animate out then call onComplete and persist the flag
  function finish() {
    setLeaving(true);
    setTimeout(() => {
      localStorage.setItem(ONBOARDING_KEY, '1');
      onComplete();
    }, 280);
  }

  async function handleEnableAlerts() {
    await notificationService.requestPermission();
    finish();
  }

  function next() {
    if (isLast) { finish(); return; }
    setSlide((s) => s + 1);
  }

  return (
    <div
      className={`onboarding-overlay${leaving ? ' onboarding-leaving' : ''}`}
      // Trap clicks so the map doesn't receive them
      onClick={(e) => e.stopPropagation()}
    >
      <div className={`onboarding-sheet${leaving ? ' onboarding-sheet-leaving' : ''}`}>

        {/* Skip — top-right */}
        <button className="onboarding-skip" onClick={finish}>Skip</button>

        {/* ── Logo header — always visible across all slides ── */}
        <div className="onboarding-logo-header">
          <img
            src={logoSrc}
            alt="FlightMapr"
            className="onboarding-logo-img"
            draggable={false}
          />
          <span className="onboarding-logo-wordmark">
            Flight<span style={{ color: '#E8E8E8' }}>Mapr</span>
          </span>
        </div>

        {/* Slide content */}
        <div className="onboarding-body" style={{ paddingTop: 20 }}>
          {/* Per-slide animated icon */}
          <div
            className="onboarding-icon"
            style={{ background: `${color}15`, border: `1.5px solid ${color}30` }}
          >
            <span style={{ fontSize: 34, lineHeight: 1 }}>{emoji}</span>
          </div>

          <h2 className="onboarding-title">{title}</h2>
          <p  className="onboarding-desc">{body}</p>
        </div>

        {/* Progress dots */}
        <div className="onboarding-dots">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setSlide(i)}
              className="onboarding-dot"
              style={{
                width:      i === slide ? 22 : 7,
                background: i === slide ? '#E8E8E8' : 'rgba(255,255,255,0.18)',
              }}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="onboarding-actions">
          {isLast ? (
            <>
              <button className="onboarding-btn-primary" onClick={handleEnableAlerts}>
                🔔&nbsp; Enable Flight Alerts
              </button>
              <button className="onboarding-btn-ghost" onClick={finish}>
                Maybe later
              </button>
            </>
          ) : (
            <>
              <button className="onboarding-btn-primary" onClick={next}>
                Continue →
              </button>
              <button className="onboarding-btn-ghost" onClick={finish}>
                Skip
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
