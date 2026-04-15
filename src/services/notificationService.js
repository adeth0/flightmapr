// ─────────────────────────────────────────────────────────
//  notificationService — multi-flight push notification tracker
//
//  Supports tracking N flights simultaneously.
//  Per-flight state machine:
//    Departure  — altitude < GROUND_ALT then climbs > AIRBORNE_ALT
//    Midpoint   — time-based (30–45 min after departure)
//    Arrival    — descending through FINAL_ALT at ≥ FINAL_RATE_FPM
//
//  All failures are silent — never throws or breaks the UI.
// ─────────────────────────────────────────────────────────

import { flightService }       from './flightService.js';
import { getCachedEnrichment } from './flightEnrichmentService.js';

// ── Altitude thresholds (feet) ────────────────────────────
const AIRBORNE_ALT_FT           = 5_000;
const GROUND_ALT_FT             = 2_000;
const FINAL_ALT_FT              = 3_000;
const FINAL_RATE_FPM            = -200;

// ── Midpoint timers ───────────────────────────────────────
const MIDPOINT_AFTER_DEPART_MS  = 45 * 60 * 1_000;  // 45 min after detected departure
const MIDPOINT_ALREADY_UP_MS    = 30 * 60 * 1_000;  // 30 min when already airborne

const ICON = '/vite.svg';

/**
 * Per-flight tracking state.
 * @typedef {{ id:string, callsign:string, airline:string, enrichment:object|null,
 *             prevAlt:number|null, departed:boolean, midpointFired:boolean,
 *             arrivedFired:boolean, midpointTimer:number|null, unsub:function|null }} TrackState
 */

class NotificationService {
  constructor() {
    this._swReg    = null;
    /** @type {Map<string, TrackState>} */
    this._flights  = new Map();
    /** @type {Set<function>} dashboard update listeners */
    this._listeners = new Set();
  }

  // ── SW registration (lazy, idempotent) ─────────────────
  async _initSW() {
    if (this._swReg || !('serviceWorker' in navigator)) return;
    try {
      this._swReg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    } catch (err) {
      console.warn('[Notifications] SW registration failed:', err?.message);
    }
  }

  // ── Permission helpers ───────────────────────────────────
  async requestPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied')  return false;
    try {
      return (await Notification.requestPermission()) === 'granted';
    } catch {
      return false;
    }
  }

  isGranted() {
    return 'Notification' in window && Notification.permission === 'granted';
  }

  // ── Public query API ─────────────────────────────────────
  isTracking(id) { return this._flights.has(id); }

  /** Returns a snapshot array for the dashboard. */
  getTrackedList() {
    return [...this._flights.values()].map(({ id, callsign, airline, enrichment }) => ({
      id, callsign, airline, enrichment,
    }));
  }

  /** Subscribe to tracking-list changes (for AlertsDashboard). */
  subscribeToChanges(fn) {
    this._listeners.add(fn);
    // Immediately emit current state
    fn(this.getTrackedList());
    return () => this._listeners.delete(fn);
  }

  // ── Public: start tracking a flight ─────────────────────
  async trackFlight(flight) {
    if (this._flights.has(flight.id)) return;   // already tracked
    await this._initSW();

    const enrichment = getCachedEnrichment(flight.callsign) ?? null;
    const already = flight.altitude > AIRBORNE_ALT_FT;

    /** @type {TrackState} */
    const state = {
      id:            flight.id,
      callsign:      flight.callsign,
      airline:       flight.airline ?? 'Unknown',
      enrichment,
      prevAlt:       flight.altitude,
      departed:      already,
      midpointFired: false,
      arrivedFired:  false,
      midpointTimer: null,
      unsub:         null,
    };

    if (already) this._scheduleMidpoint(state, MIDPOINT_ALREADY_UP_MS);

    state.unsub = flightService.subscribe((flights) => {
      if (!this._flights.has(flight.id)) return;
      const f = flights.find((x) => x.id === flight.id);
      if (!f) { this._remove(flight.id); return; }
      this._checkEvents(state, f);
    });

    this._flights.set(flight.id, state);
    this._emit();

    // ── Immediate "Now Tracking" notification ──────────────
    // Fires as soon as the user clicks Track — no altitude events needed.
    const dest   = enrichment?.destination;
    const origin = enrichment?.origin;
    const routeStr = (origin?.code && dest?.code)
      ? ` (${origin.code} → ${dest.code})`
      : '';
    this._show(
      '✈️ Now Tracking',
      dest?.name
        ? `Tracking ${flight.callsign}${routeStr} to ${dest.name}`
        : `Tracking ${flight.callsign} — you'll be notified on departure, midway & landing`,
      `tracking-start-${flight.id}`,
    );
  }

  // ── Public: stop tracking by ID ──────────────────────────
  stopTracking(id) { this._remove(id); }

  // ── Internal ─────────────────────────────────────────────
  _remove(id) {
    const state = this._flights.get(id);
    if (!state) return;
    if (state.unsub)         state.unsub();
    if (state.midpointTimer) clearTimeout(state.midpointTimer);
    this._flights.delete(id);
    this._emit();
  }

  _emit() {
    const list = this.getTrackedList();
    this._listeners.forEach((fn) => fn(list));
  }

  _scheduleMidpoint(state, delayMs) {
    clearTimeout(state.midpointTimer);
    state.midpointTimer = setTimeout(() => {
      if (state.midpointFired || !this._flights.has(state.id)) return;
      state.midpointFired = true;
      const dest = state.enrichment?.destination;
      this._show(
        '✈️ Midway Update',
        dest?.name
          ? `${state.callsign} is halfway to ${dest.name}`
          : `${state.callsign} is at the midpoint`,
        `midpoint-${state.id}`,
      );
    }, delayMs);
  }

  _checkEvents(state, f) {
    const alt  = f.altitude;
    const prev = state.prevAlt;

    // ── Departure ────────────────────────────────────────
    if (!state.departed && prev != null && prev < GROUND_ALT_FT && alt > AIRBORNE_ALT_FT) {
      state.departed = true;
      const origin = state.enrichment?.origin;
      this._show(
        '✈️ Flight Departed',
        origin?.name
          ? `${state.callsign} has departed ${origin.name}`
          : `${state.callsign} has departed`,
        `departure-${state.id}`,
      );
      this._scheduleMidpoint(state, MIDPOINT_AFTER_DEPART_MS);
    }

    // ── Arrival ──────────────────────────────────────────
    if (
      state.departed && !state.arrivedFired &&
      prev != null && prev > FINAL_ALT_FT && alt < FINAL_ALT_FT &&
      f.vertRate != null && f.vertRate < FINAL_RATE_FPM
    ) {
      state.arrivedFired = true;
      clearTimeout(state.midpointTimer);
      const dest = state.enrichment?.destination;
      this._show(
        '🛬 Landed Safely',
        dest?.name
          ? `${state.callsign} has landed safely at ${dest.name}. Track more flights on FlightMapr! ✈️`
          : `${state.callsign} has landed safely. Check out more flights on FlightMapr! ✈️`,
        `arrival-${state.id}`,
      );
    }

    state.prevAlt = alt;
  }

  async _show(title, body, tag) {
    if (!this.isGranted()) return;
    if (this._swReg || 'serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, {
          body, icon: ICON, badge: ICON, tag, renotify: true, requireInteraction: false,
        });
        return;
      } catch { /* fall through */ }
    }
    try {
      // eslint-disable-next-line no-new
      new Notification(title, { body, icon: ICON, tag });
    } catch { /* fail silently */ }
  }
}

export const notificationService = new NotificationService();
