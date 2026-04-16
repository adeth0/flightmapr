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
import { computeFlightTimes }  from './flightTimingService.js';

// ── Altitude thresholds (feet) ────────────────────────────
const AIRBORNE_ALT_FT           = 5_000;
const GROUND_ALT_FT             = 2_000;
const FINAL_ALT_FT              = 3_000;
const FINAL_RATE_FPM            = -200;

// Landing detection — per requirement we primarily use fallback:
// altitude approx "ground" AND speed approx 0.
const LANDING_ALT_FT           = 1_200; // ~near ground given our feed filters
const LANDING_SPEED_KTS       = 20;

// ── Midpoint timers ───────────────────────────────────────
const MIDPOINT_AFTER_DEPART_MS  = 45 * 60 * 1_000;  // 45 min after detected departure
const MIDPOINT_ALREADY_UP_MS    = 30 * 60 * 1_000;  // 30 min when already airborne

// Delay notification evaluation + spam protection
const DELAY_EVAL_THROTTLE_MS    = 30_000;  // per tracked flight
const DELAY_TOAST_COOLDOWN_MS   = 8 * 60 * 1_000;

const ICON = '/vite.svg';

/**
 * Per-flight tracking state.
 * @typedef {{ id:string, callsign:string, airline:string, enrichment:object|null,
 *             prevAlt:number|null, departed:boolean, midpointFired:boolean,
 *             arrivedFired:boolean, midpointTimer:number|null, unsub:function|null,
 *             lastDeptMinute:number|null, lastEtaMinute:number|null,
 *             lastDelayToastAt:number, lastDelayToastKey:string|null, lastDelayEvalAt:number }} TrackState
 */

class NotificationService {
  constructor() {
    this._swReg    = null;
    /** @type {Map<string, TrackState>} */
    this._flights  = new Map();
    /** @type {Set<function>} dashboard update listeners */
    this._listeners = new Set();
    /** @type {Set<function>} in-app toast listeners (fallback when push unavailable) */
    this._inAppListeners = new Set();

    // Audio for landing announcements (must be unlocked by user gesture).
    this._userInteracted = false;
    this._audioCtx = null;
    this._gestureInstalled = false;
    this._initUserGesture();
  }

  _initUserGesture() {
    if (this._gestureInstalled) return;
    this._gestureInstalled = true;
    if (typeof window === 'undefined') return;

    const mark = () => {
      this._userInteracted = true;
      // Once we have a gesture, we don't need to keep listening.
      window.removeEventListener('pointerdown', mark);
      window.removeEventListener('touchstart', mark);
      window.removeEventListener('keydown', mark);
      window.removeEventListener('click', mark);
    };

    // Any one gesture is enough for most browsers to unlock WebAudio.
    window.addEventListener('pointerdown', mark, { passive: true });
    window.addEventListener('touchstart', mark, { passive: true });
    window.addEventListener('keydown', mark);
    window.addEventListener('click', mark, { passive: true });
  }

  _markUserInteracted() {
    this._userInteracted = true;
  }

  _isApiLanded(status) {
    if (!status) return false;
    const s = String(status).toLowerCase();
    // Best-effort: adsbdb fields vary; match on any landing-ish token.
    return s.includes('land') || s.includes('arrive') || s.includes('arriv') || s.includes('completed');
  }

  _playLandingSound() {
    // Browser restriction: only attempt after user interaction.
    if (!this._userInteracted) return;
    if (typeof window === 'undefined') return;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      if (!this._audioCtx) this._audioCtx = new AudioCtx();
      const ctx = this._audioCtx;
      if (ctx.state === 'suspended') ctx.resume?.().catch(() => {});

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(740, now); // subtle chirp
      osc.frequency.exponentialRampToValueAtTime(520, now + 0.14);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.05, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.18);
    } catch {
      // Silent fail (never break notifications/UI).
    }
  }

  // ── In-app notification fallback ────────────────────────
  // Used on iOS Safari browser (no push support) and as a
  // fallback when system notifications are denied or fail.
  subscribeToInApp(fn) {
    this._inAppListeners.add(fn);
    return () => this._inAppListeners.delete(fn);
  }

  _showInApp(title, body) {
    this._inAppListeners.forEach((fn) => {
      try { fn({ title, body }); } catch { /* ignore */ }
    });
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
    this._markUserInteracted();
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
    this._markUserInteracted();
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
      lastDeptMinute: null,
      lastEtaMinute: null,
      lastDelayToastAt: 0,
      lastDelayToastKey: null,
      lastDelayEvalAt: 0,
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

    // Refresh enrichment when it becomes available (background enrichment).
    if (!state.enrichment) {
      const latest = getCachedEnrichment(state.callsign) ?? null;
      if (latest) state.enrichment = latest;
    }

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

    // ── Arrival / landed ─────────────────────────────────
    if (state.departed && !state.arrivedFired) {
      const dest = state.enrichment?.destination;
      const destLabel =
        dest?.code && dest.code !== '----' ? dest.code : (dest?.name ?? 'destination');

      const apiLanded = this._isApiLanded(state.enrichment?.status);

      const groundedAlt = alt != null && alt <= LANDING_ALT_FT;
      const lowSpeed    = f.speed != null && f.speed <= LANDING_SPEED_KTS;
      const descending  = f.vertRate != null ? f.vertRate < FINAL_RATE_FPM : true;
      const prevWasHigher = prev != null ? prev > LANDING_ALT_FT : false;

      // Preferred: API status.
      // Fallback: altitude near ground AND speed near 0.
      const landed =
        (apiLanded && (groundedAlt || lowSpeed)) ||
        (!apiLanded && groundedAlt && lowSpeed && (descending || prevWasHigher));

      if (landed) {
        state.arrivedFired = true;
        clearTimeout(state.midpointTimer);

        // Sound requires a user gesture; notification itself still works without sound.
        this._playLandingSound();

        this._showToastBanner(
          `✈️ Flight ${state.callsign} has landed at ${destLabel}`,
          '',
          `arrival-${state.id}`,
        );
      }
    }

    // Delay notification (departure/arrival time change) — throttled.
    this._maybeCheckDelay(state, f);

    state.prevAlt = alt;
  }

  _maybeCheckDelay(state, f) {
    if (state.arrivedFired) return;

    const now = Date.now();
    if (now - state.lastDelayEvalAt < DELAY_EVAL_THROTTLE_MS) return;
    state.lastDelayEvalAt = now;

    if (!state.enrichment) return;

    const times = computeFlightTimes(f, state.enrichment);
    if (!times) return;

    const deptMin = Math.round(times.deptMs / 60_000);
    const etaMin  = Math.round(times.etaMs  / 60_000);

    if (state.lastDeptMinute == null || state.lastEtaMinute == null) {
      state.lastDeptMinute = deptMin;
      state.lastEtaMinute  = etaMin;
      return;
    }

    const prevDeptMin = state.lastDeptMinute;
    const prevEtaMin  = state.lastEtaMinute;

    const deptChanged = deptMin !== prevDeptMin;
    const etaChanged  = etaMin  !== prevEtaMin;
    if (!deptChanged && !etaChanged) return;

    // Update baseline immediately so we only notify on meaningful forward drift.
    state.lastDeptMinute = deptMin;
    state.lastEtaMinute  = etaMin;

    const deltaDept = deptChanged ? deptMin - prevDeptMin : 0;
    const deltaEta  = etaChanged  ? etaMin  - prevEtaMin  : 0;
    const delayDelta = Math.max(deltaDept, deltaEta);
    if (delayDelta <= 0) return; // only show "delayed"

    if (now - state.lastDelayToastAt < DELAY_TOAST_COOLDOWN_MS) return;

    const key = `${deptMin}-${etaMin}`;
    if (state.lastDelayToastKey === key) return;
    state.lastDelayToastKey = key;
    state.lastDelayToastAt = now;

    this._showToastBanner(
      `⚠️ Flight ${state.callsign} delayed by ${delayDelta} minutes`,
      '',
      `delay-${state.id}-${key}`,
    );
  }

  // Shows an in-app toast banner ALWAYS, then (optionally) tries system notifications.
  // This is used for landing + delay so the user sees the required banner even when
  // push permissions are granted.
  _showToastBanner(title, body, tag) {
    this._showInApp(title, body);
    this._showSystem(title, body, tag);
  }

  async _showSystem(title, body, tag) {
    if (!this.isGranted()) return;

    // 1) Service Worker showNotification (iOS PWA + Android)
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, {
          body, icon: ICON, badge: ICON, tag, renotify: true, requireInteraction: false,
        });
        return;
      } catch { /* fall through */ }
    }

    // 2) Direct Notification API (desktop / Android Chrome)
    try {
      // eslint-disable-next-line no-new
      new Notification(title, { body, icon: ICON, tag });
    } catch { /* ignore */ }
  }

  async _show(title, body, tag) {
    // ── Attempt system notifications ────────────────────────
    if (this.isGranted()) {
      // 1. Service Worker showNotification (works in iOS PWA 16.4+ and Android)
      if ('serviceWorker' in navigator) {
        try {
          const reg = await navigator.serviceWorker.ready;
          await reg.showNotification(title, {
            body, icon: ICON, badge: ICON, tag, renotify: true, requireInteraction: false,
          });
          return; // system notification succeeded — no in-app needed
        } catch { /* fall through */ }
      }
      // 2. Direct Notification API (desktop / Android Chrome)
      try {
        // eslint-disable-next-line no-new
        new Notification(title, { body, icon: ICON, tag });
        return; // succeeded
      } catch { /* fall through */ }
    }
    // ── Fallback: in-app toast ──────────────────────────────
    // Covers: iOS Safari browser (no push support), permission
    // denied/not-yet-granted, and any system notification failure.
    this._showInApp(title, body);
  }
}

export const notificationService = new NotificationService();
