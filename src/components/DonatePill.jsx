// ─────────────────────────────────────────────────────────
//  DonatePill — small, always-visible glass "Donate" button.
//
//  Position: bottom-right, sitting just above the FeedbackFab so
//  the two controls form a stacked pair without fighting for the
//  same pixels. iOS safe-area aware.
//
//  The Stripe link opens in a new tab so the live map view is
//  preserved while the donation flow runs.
// ─────────────────────────────────────────────────────────

import { Heart } from 'lucide-react';

const DONATE_URL = 'https://donate.stripe.com/8x27sMaIf3Cm5O0gFEc7u00';

export function DonatePill() {
  function handleClick() {
    window.open(DONATE_URL, '_blank', 'noopener,noreferrer');
  }

  return (
    <button
      type="button"
      className="donate-pill"
      onClick={handleClick}
      aria-label="Support FlightMapr with a donation"
      title="Support FlightMapr"
    >
      <span className="donate-pill-icon" aria-hidden="true">
        <Heart size={13} strokeWidth={2.4} />
      </span>
      <span className="donate-pill-label">Donate</span>
    </button>
  );
}
