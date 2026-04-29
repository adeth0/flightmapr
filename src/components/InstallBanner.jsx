// ─────────────────────────────────────────────────────────
//  InstallBanner — PWA install prompt
//
//  Android Chrome : captures `beforeinstallprompt`, shows
//                   a native-style install card.
//  iOS Safari     : shows share-sheet instructions
//                   ("Tap Share → Add to Home Screen").
//
//  Dismissed state is persisted for 14 days so the banner
//  doesn't re-appear immediately after being closed.
// ─────────────────────────────────────────────────────────

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import logoSrc from '../assets/flightmapr-logo.png';

const DISMISSED_KEY = 'flightmapr_install_dismissed_at';
const DISMISS_TTL   = 14 * 24 * 3600 * 1000; // 14 days

function wasDismissedRecently() {
  const ts = Number(localStorage.getItem(DISMISSED_KEY) || 0);
  return ts > 0 && Date.now() - ts < DISMISS_TTL;
}

// Device detection — run once at module load
const UA          = navigator.userAgent || '';
const isIos       = /iPad|iPhone|iPod/.test(UA) && !/Windows Phone/.test(UA);
const isStandalone = ('standalone' in navigator && !!navigator.standalone)
                   || window.matchMedia('(display-mode: standalone)').matches;
const isIosSafari = isIos && !isStandalone;

export function InstallBanner() {
  // deferredPrompt: the Web-Install API event captured from the browser
  const [prompt,    setPrompt]    = useState(null);
  const [visible,   setVisible]   = useState(false);
  const [dismissed, setDismissed] = useState(wasDismissedRecently);

  useEffect(() => {
    if (dismissed) return;

    // ── Android / Chrome: capture the install prompt ────
    const capture = (e) => {
      e.preventDefault();
      setPrompt(e);
      // Slight delay so the onboarding can finish first
      setTimeout(() => setVisible(true), 1200);
    };
    window.addEventListener('beforeinstallprompt', capture);

    // ── iOS Safari: show instructions after 3 s ─────────
    let iosTimer;
    if (isIosSafari) {
      iosTimer = setTimeout(() => setVisible(true), 3000);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', capture);
      clearTimeout(iosTimer);
    };
  }, [dismissed]);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    setDismissed(true);
    setVisible(false);
  }

  async function handleInstall() {
    if (prompt) {
      prompt.prompt();
      const { outcome } = await prompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
      // Whether accepted or dismissed, don't nag again soon
      if (outcome === 'accepted') {
        setVisible(false);
        return;
      }
    }
    dismiss();
  }

  if (!visible || dismissed) return null;
  // Don't show on desktop (no standalone mode benefit there)
  if (!isIosSafari && !prompt) return null;

  return (
    <div className="install-banner" role="banner" aria-label="Install FlightMapr">
      {/* App icon */}
      <div className="install-banner-icon">
        <img
          src={logoSrc}
          alt="FlightMapr"
          draggable={false}
          style={{ width: 26, height: 26, objectFit: 'contain',
            filter: 'drop-shadow(0 0 5px rgba(255, 255, 255,0.5))' }}
        />
      </div>

      {/* Text */}
      <div className="install-banner-text">
        <div className="install-banner-title">Install FlightMapr</div>
        {isIosSafari && !prompt ? (
          <div className="install-banner-desc">
            Tap <span style={{ color: '#38BDF8' }}>Share ↑</span>
            {' → '}
            <span style={{ color: '#38BDF8' }}>Add to Home Screen</span>
            {' for flight alerts'}
          </div>
        ) : (
          <div className="install-banner-desc">
            Get push notifications for your tracked flights
          </div>
        )}
      </div>

      {/* CTA — only shown on Android where we have the prompt */}
      {prompt && (
        <button className="install-banner-cta" onClick={handleInstall}>
          Install
        </button>
      )}

      {/* Dismiss */}
      <button className="install-banner-close" onClick={dismiss} aria-label="Dismiss">
        <X size={13} />
      </button>
    </div>
  );
}
