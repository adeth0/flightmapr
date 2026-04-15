// ─────────────────────────────────────────────────────────
//  notificationService
//  Manages browser push-notification permission, service-worker
//  registration, and per-flight tracking logic.
//
//  Tracking events:
//    Departure  — altitude crosses ground→airborne threshold
//    Midpoint   — time-based (30–45 min after departure)
//    Arrival    — altitude drops through final-approach threshold
//                 while descending (negative vertRate)
//
//  Only ONE flight is tracked at a time.
//  All failures are silent — never throws or breaks UI.
// ─────────────────────────────────────────────────────────

import { flightService }       from './flightService.js';
import { getCachedEnrichment } from './flightEnrichmentService.js';

// ── Altitude thresholds (feet) ────────────────────────────
const AIRBORNE_ALT_FT  = 5_000;   // definitely airborne above this
const GROUND_ALT_FT    = 2_000;   // definitely on/near ground below this
const FINAL_ALT_FT     = 3_000;   // descending through this → arrival
const FINAL_RATE_FPM   = -200;    // must be descending at ≥ 200 fpm

// ── Midpoint delay after departure detection ──────────────
const MIDPOINT_AFTER_DEPART_MS  = 45 * 60 * 1_000; // 45 min
const MIDPOINT_ALREADY_UP_MS    = 30 * 60 * 1_000; // 30 min (already airborne)

const ICON = '/vite.svg';

class NotificationService {
  constructor() {
    this._swReg         = null;
    this._tracked       = null;   // { id, callsign, enrichment } | null
    this._prevAlt       = null;
    this._departed      = false;
    this._midpointFired = false;
    this._arrivedFired  = false;
    this._midpointTimer = null;
    this._unsub         = null;
  }

  // ── Service-worker registration (lazy, idempotent) ──────
  async _initSW() {
    if (this._swReg || !('serviceWorker' in navigator)) return;
    try {
      this._swReg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    } catch (err) {
      console.warn('[Notifications] SW registration failed:', err?.message);
    }
  }

  // ── Permission helpers ───────────────────────────────────
  /** Request permission if not yet decided. Returns true if granted. */
  async requestPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied')  return false;
    try {
      const result = await Notification.requestPermission();
      return result === 'granted';
    } catch {
      return false;
    }
  }

  isGranted() {
    return 'Notification' in window && Notification.permission === 'granted';
  }

  /** Is the given flight ID currently being tracked? */
  isTracking(id) {
    return this._tracked?.id === id;
  }

  // ── Public: start tracking a flight ─────────────────────
  /**
   * Begin monitoring `flight` for departure / midpoint / arrival events.
   * Registers the service worker and reads any cached enrichment data.
   * If another flight is currently tracked it is silently replaced.
   */
  async trackFlight(flight) {
    await this._initSW();
    this._stopTracking();

    const enrichment = getCachedEnrichment(flight.callsign) ?? null;

    this._tracked       = { id: flight.id, callsign: flight.callsign, enrichment };
    this._prevAlt       = flight.altitude;
    this._departed      = flight.altitude > AIRBORNE_ALT_FT;
    this._midpointFired = false;
    this._arrivedFired  = false;

    // Already airborne when tracking starts → schedule midpoint now
    if (this._departed) {
      this._scheduleMidpoint(MIDPOINT_ALREADY_UP_MS);
    }

    this._unsub = flightService.subscribe((flights) => {
      if (!this._tracked) return;
      const f = flights.find((x) => x.id === this._tracked.id);
      if (!f) {
        // Flight dropped from feed — stop quietly
        this._stopTracking();
        return;
      }
      this._checkEvents(f);
    });
  }

  /** Stop tracking the current flight. */
  stopTracking() { this._stopTracking(); }

  // ── Internal ─────────────────────────────────────────────
  _stopTracking() {
    if (this._unsub)         { this._unsub(); this._unsub = null; }
    if (this._midpointTimer) { clearTimeout(this._midpointTimer); this._midpointTimer = null; }
    this._tracked       = null;
    this._prevAlt       = null;
    this._departed      = false;
    this._midpointFired = false;
    this._arrivedFired  = false;
  }

  _scheduleMidpoint(delayMs) {
    clearTimeout(this._midpointTimer);
    this._midpointTimer = setTimeout(() => {
      if (this._midpointFired || !this._tracked) return;
      this._midpointFired = true;
      const dest = this._tracked.enrichment?.destination;
      this._show(
        '✈️ Midway Update',
        dest?.name
          ? `${this._tracked.callsign} is halfway to ${dest.name}`
          : `${this._tracked.callsign} is at the midpoint`,
        'midpoint',
      );
    }, delayMs);
  }

  _checkEvents(f) {
    const alt  = f.altitude;
    const prev = this._prevAlt;

    // ── Departure ────────────────────────────────────────
    if (!this._departed && prev != null && prev < GROUND_ALT_FT && alt > AIRBORNE_ALT_FT) {
      this._departed = true;
      const origin = this._tracked.enrichment?.origin;
      this._show(
        '✈️ Flight Departed',
        origin?.name
          ? `${this._tracked.callsign} has departed ${origin.name}`
          : `${this._tracked.callsign} has departed`,
        'departure',
      );
      this._scheduleMidpoint(MIDPOINT_AFTER_DEPART_MS);
    }

    // ── Arrival ──────────────────────────────────────────
    if (
      this._departed && !this._arrivedFired &&
      prev != null && prev > FINAL_ALT_FT && alt < FINAL_ALT_FT &&
      f.vertRate != null && f.vertRate < FINAL_RATE_FPM
    ) {
      this._arrivedFired = true;
      clearTimeout(this._midpointTimer);
      const dest = this._tracked.enrichment?.destination;
      this._show(
        '🛬 Flight Arrived',
        dest?.name
          ? `${this._tracked.callsign} has landed at ${dest.name}`
          : `${this._tracked.callsign} has landed`,
        'arrival',
      );
    }

    this._prevAlt = alt;
  }

  /** Show a notification via the service worker (background-safe) or
   *  fall back to the foreground Notification API.  Fails silently. */
  async _show(title, body, tag) {
    if (!this.isGranted()) return;

    // Prefer SW-based showNotification — works when page is backgrounded
    if (this._swReg || 'serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, {
          body,
          icon:           ICON,
          badge:          ICON,
          tag,
          renotify:       true,
          requireInteraction: false,
        });
        return;
      } catch { /* fall through to direct API */ }
    }

    // Fallback: direct Notification (foreground only)
    try {
      // eslint-disable-next-line no-new
      new Notification(title, { body, icon: ICON, tag });
    } catch { /* fail silently */ }
  }
}

export const notificationService = new NotificationService();
