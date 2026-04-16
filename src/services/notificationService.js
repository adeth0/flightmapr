import { flightService } from './flightService.js';
import { getCachedEnrichment } from './flightEnrichmentService.js';
import { computeFlightTimes } from './flightTimingService.js';

const AIRBORNE_ALT_FT = 5_000;
const GROUND_ALT_FT = 2_000;
const FINAL_RATE_FPM = -200;
const LANDING_ALT_FT = 1_200;
const LANDING_SPEED_KTS = 20;

const MIDPOINT_AFTER_DEPART_MS = 45 * 60 * 1_000;
const MIDPOINT_ALREADY_UP_MS = 30 * 60 * 1_000;

const DELAY_EVAL_THROTTLE_MS = 30_000;
const DELAY_TOAST_COOLDOWN_MS = 8 * 60 * 1_000;
const SCHEDULED_CHECK_MS = 30_000;
const SCHEDULED_SOON_WINDOW_MS = 20 * 60 * 1_000;

const ICON = '/vite.svg';
const TRACKED_IDS_STORAGE_KEY = 'flightmapr_tracked_flights_v1';
const TRACKED_STATE_STORAGE_KEY = 'flightmapr_tracked_state_v2';

function normalizeCallsign(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

function safeAirport(ap) {
  if (!ap) return null;
  return {
    code: ap.code ?? '----',
    icao: ap.icao ?? '----',
    name: ap.name ?? 'Unknown Airport',
    city: ap.city ?? '',
    country: ap.country ?? '',
    lat: Number(ap.lat) || 0,
    lng: Number(ap.lng) || 0,
  };
}

class NotificationService {
  constructor() {
    this._swReg = null;
    this._flights = new Map();
    this._listeners = new Set();
    this._inAppListeners = new Set();

    this._userInteracted = false;
    this._audioCtx = null;
    this._gestureInstalled = false;
    this._scheduledTimer = null;
    this._restoreStarted = false;
    this._restorePendingLive = new Map();

    this._initUserGesture();
  }

  _readTrackedSnapshots() {
    if (typeof window === 'undefined') return [];

    try {
      const raw = localStorage.getItem(TRACKED_STATE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
      }
    } catch {
      // Fall through to legacy storage.
    }

    try {
      const raw = localStorage.getItem(TRACKED_IDS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(Boolean)
        .map((id) => ({ kind: 'live', id }));
    } catch {
      return [];
    }
  }

  _snapshotState(state) {
    return {
      kind: state.kind ?? 'live',
      id: state.id,
      callsign: state.callsign,
      flightNumber: state.flightNumber ?? state.callsign,
      airline: state.airline ?? 'Unknown',
      enrichment: state.enrichment ?? null,
      scheduledDepartureMs: state.scheduledDepartureMs ?? null,
      estimatedArrivalMs: state.estimatedArrivalMs ?? null,
      delayMinutes: state.delayMinutes ?? 0,
      departed: Boolean(state.departed),
      midpointFired: Boolean(state.midpointFired),
      arrivedFired: Boolean(state.arrivedFired),
      notifiedSoon: Boolean(state.notifiedSoon),
      lastDeptMinute: state.lastDeptMinute ?? null,
      lastEtaMinute: state.lastEtaMinute ?? null,
      lastDelayToastAt: state.lastDelayToastAt ?? 0,
      lastDelayToastKey: state.lastDelayToastKey ?? null,
      status: state.status ?? null,
    };
  }

  _persistTrackedState() {
    if (typeof window === 'undefined') return;

    const snapshots = [...this._flights.values()].map((state) => this._snapshotState(state));

    try {
      localStorage.setItem(TRACKED_STATE_STORAGE_KEY, JSON.stringify(snapshots));
      localStorage.setItem(
        TRACKED_IDS_STORAGE_KEY,
        JSON.stringify(
          snapshots
            .filter((item) => item.kind === 'live')
            .map((item) => item.id),
        ),
      );
    } catch {
      // Ignore storage failures; tracking still works for this session.
    }

    this._syncTrackedFlightsToSW(snapshots);
  }

  _initUserGesture() {
    if (this._gestureInstalled || typeof window === 'undefined') return;
    this._gestureInstalled = true;

    const mark = () => {
      this._userInteracted = true;
      window.removeEventListener('pointerdown', mark);
      window.removeEventListener('touchstart', mark);
      window.removeEventListener('keydown', mark);
      window.removeEventListener('click', mark);
    };

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
    const value = String(status).toLowerCase();
    return value.includes('land') || value.includes('arriv') || value.includes('completed');
  }

  _playLandingSound() {
    if (!this._userInteracted || typeof window === 'undefined') return;

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
      osc.frequency.setValueAtTime(740, now);
      osc.frequency.exponentialRampToValueAtTime(520, now + 0.14);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.05, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.18);
    } catch {
      // Never break the UI on audio failures.
    }
  }

  subscribeToInApp(fn) {
    this._inAppListeners.add(fn);
    return () => this._inAppListeners.delete(fn);
  }

  _showInApp(title, body) {
    this._inAppListeners.forEach((fn) => {
      try {
        fn({ title, body });
      } catch {
        // Ignore listener failures.
      }
    });
  }

  async _initSW() {
    if (this._swReg || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    try {
      this._swReg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready.catch(() => null);
      await this._registerBackgroundTasks();
      this._syncTrackedFlightsToSW();
    } catch (err) {
      console.warn('[Notifications] SW registration failed:', err?.message);
    }
  }

  async _registerBackgroundTasks() {
    if (!this._swReg) return;

    try {
      if ('sync' in this._swReg) {
        await this._swReg.sync.register('flightmapr-flight-check');
      }
    } catch {
      // Background sync is optional.
    }

    try {
      if ('periodicSync' in this._swReg) {
        await this._swReg.periodicSync.register('flightmapr-flight-check', {
          minInterval: 30 * 60 * 1_000,
        });
      }
    } catch {
      // Periodic sync is optional and often gated to installed PWAs.
    }
  }

  _postToSW(message) {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const target =
      navigator.serviceWorker.controller ||
      this._swReg?.active ||
      this._swReg?.waiting ||
      this._swReg?.installing;

    try {
      target?.postMessage(message);
    } catch {
      // Ignore transient controller issues.
    }
  }

  _syncTrackedFlightsToSW(snapshots) {
    const flights = snapshots ?? [...this._flights.values()].map((state) => this._snapshotState(state));
    this._postToSW({ type: 'SYNC_TRACKED_FLIGHTS', flights });
  }

  async requestPermission() {
    this._markUserInteracted();
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;

    try {
      return (await Notification.requestPermission()) === 'granted';
    } catch {
      return false;
    }
  }

  isGranted() {
    return typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted';
  }

  ensureStarted() {
    this._initSW();
    this.restoreTrackedFlights();
  }

  isTracking(id) {
    return this._flights.has(id);
  }

  getTrackedList() {
    return [...this._flights.values()].map((state) => ({
      id: state.id,
      kind: state.kind ?? 'live',
      callsign: state.callsign,
      flightNumber: state.flightNumber ?? state.callsign,
      airline: state.airline ?? 'Unknown',
      enrichment: state.enrichment ?? null,
      scheduledDepartureMs: state.scheduledDepartureMs ?? null,
      estimatedArrivalMs: state.estimatedArrivalMs ?? null,
      delayMinutes: state.delayMinutes ?? 0,
      status: state.status ?? null,
    }));
  }

  subscribeToChanges(fn) {
    this._listeners.add(fn);
    fn(this.getTrackedList());
    return () => this._listeners.delete(fn);
  }

  _updateLiveTiming(state, flight) {
    const latest = getCachedEnrichment(state.callsign) ?? state.enrichment ?? null;
    if (latest) state.enrichment = latest;

    const times = state.enrichment ? computeFlightTimes(flight, state.enrichment) : null;
    state.scheduledDepartureMs = times?.deptMs ?? state.scheduledDepartureMs ?? null;
    state.estimatedArrivalMs = times?.etaMs ?? state.estimatedArrivalMs ?? null;
    state.delayMinutes = state.enrichment?.delayMinutes ?? state.delayMinutes ?? 0;
    state.status = state.enrichment?.status ?? state.status ?? null;
  }

  async trackFlight(flight, options = {}) {
    if (!flight?.id || this._flights.has(flight.id)) return;

    const { silentStart = false, restoredSnapshot = null } = options;

    this._markUserInteracted();
    await this._initSW();

    const enrichment = getCachedEnrichment(flight.callsign) ?? restoredSnapshot?.enrichment ?? null;
    const alreadyAirborne = flight.altitude > AIRBORNE_ALT_FT;

    const state = {
      kind: 'live',
      id: flight.id,
      callsign: normalizeCallsign(flight.callsign) || flight.id,
      flightNumber: flight.flightNumber ?? (normalizeCallsign(flight.callsign) || flight.id),
      airline: flight.airline ?? restoredSnapshot?.airline ?? 'Unknown',
      enrichment,
      prevAlt: flight.altitude,
      departed: restoredSnapshot?.departed ?? alreadyAirborne,
      midpointFired: Boolean(restoredSnapshot?.midpointFired),
      arrivedFired: Boolean(restoredSnapshot?.arrivedFired),
      notifiedSoon: Boolean(restoredSnapshot?.notifiedSoon),
      midpointTimer: null,
      lastDeptMinute: restoredSnapshot?.lastDeptMinute ?? null,
      lastEtaMinute: restoredSnapshot?.lastEtaMinute ?? null,
      lastDelayToastAt: restoredSnapshot?.lastDelayToastAt ?? 0,
      lastDelayToastKey: restoredSnapshot?.lastDelayToastKey ?? null,
      lastDelayEvalAt: 0,
      scheduledDepartureMs: restoredSnapshot?.scheduledDepartureMs ?? null,
      estimatedArrivalMs: restoredSnapshot?.estimatedArrivalMs ?? null,
      delayMinutes: restoredSnapshot?.delayMinutes ?? 0,
      status: restoredSnapshot?.status ?? null,
      unsub: null,
    };

    this._updateLiveTiming(state, flight);

    if (state.departed && !state.midpointFired) {
      this._scheduleMidpoint(state, MIDPOINT_ALREADY_UP_MS);
    }

    state.unsub = flightService.subscribe((flights) => {
      if (!this._flights.has(flight.id)) return;
      const live = flights.find((item) => item.id === flight.id);
      if (!live) {
        this._remove(flight.id);
        return;
      }
      this._checkEvents(state, live);
    });

    this._flights.set(flight.id, state);
    this._persistTrackedState();
    this._emit();

    if (!silentStart) {
      const dest = enrichment?.destination;
      const origin = enrichment?.origin;
      const routeStr = origin?.code && dest?.code ? ` (${origin.code} -> ${dest.code})` : '';
      this._show(
        'Now Tracking',
        dest?.name
          ? `Tracking ${state.callsign}${routeStr} to ${dest.name}`
          : `Tracking ${state.callsign} - you will be notified on departure, midpoint and landing`,
        `tracking-start-${flight.id}`,
      );
    }
  }

  async trackScheduledFlight(item, airport, options = {}) {
    if (item?.flight) {
      return this.trackFlight(item.flight, options);
    }

    const callsign = normalizeCallsign(item?.flightNumber) || normalizeCallsign(item?.callsign);
    const origin = safeAirport(airport);
    const destination = safeAirport(item?.destination);
    const id = item?.id ?? `scheduled:${callsign || origin?.code || 'unknown'}:${item?.scheduledDepartureMs ?? Date.now()}`;

    if (this._flights.has(id)) return;

    this._markUserInteracted();
    await this._initSW();

    const state = {
      kind: 'scheduled',
      id,
      callsign: callsign || id,
      flightNumber: item?.flightNumber ?? callsign ?? id,
      airline: item?.airline ?? 'Scheduled Flight',
      enrichment: {
        origin,
        destination,
      },
      prevAlt: null,
      departed: Boolean(options?.restoredSnapshot?.departed),
      midpointFired: false,
      arrivedFired: false,
      notifiedSoon: Boolean(options?.restoredSnapshot?.notifiedSoon),
      midpointTimer: null,
      lastDeptMinute: null,
      lastEtaMinute: null,
      lastDelayToastAt: 0,
      lastDelayToastKey: null,
      lastDelayEvalAt: 0,
      scheduledDepartureMs: Number(item?.scheduledDepartureMs) || null,
      estimatedArrivalMs: Number(item?.estimatedArrivalMs) || null,
      delayMinutes: Number(item?.delayMinutes) || 0,
      status: options?.restoredSnapshot?.status ?? 'scheduled',
      unsub: null,
    };

    this._flights.set(id, state);
    this._restartScheduledTimer();
    this._checkScheduledStates();
    this._persistTrackedState();
    this._emit();

    if (!options?.silentStart) {
      const destLabel = destination?.name ?? destination?.code ?? 'destination';
      this._show(
        'Scheduled Flight Tracked',
        `Tracking ${state.flightNumber} to ${destLabel} before departure`,
        `scheduled-start-${id}`,
      );
    }
  }

  stopTracking(id) {
    this._remove(id);
  }

  _remove(id) {
    const state = this._flights.get(id);
    if (!state) return;

    if (state.unsub) state.unsub();
    if (state.midpointTimer) clearTimeout(state.midpointTimer);

    this._flights.delete(id);
    this._persistTrackedState();
    this._restartScheduledTimer();
    this._emit();
    this._postToSW({ type: 'UNTRACK_FLIGHT', id });
  }

  restoreTrackedFlights() {
    if (this._restoreStarted) return;
    this._restoreStarted = true;

    const snapshots = this._readTrackedSnapshots();
    if (snapshots.length === 0) return;

    snapshots.forEach((snapshot) => {
      if (snapshot?.kind === 'scheduled') {
        const origin = safeAirport(snapshot.enrichment?.origin);
        const destination = safeAirport(snapshot.enrichment?.destination);
        this.trackScheduledFlight({
          ...snapshot,
          destination,
        }, origin, {
          silentStart: true,
          restoredSnapshot: snapshot,
        }).catch(() => {});
        return;
      }

      this._restorePendingLive.set(snapshot.id, snapshot);
    });

    if (this._restorePendingLive.size === 0) return;

    const tryRestore = (flights) => {
      if (this._restorePendingLive.size === 0) return;

      for (const [id, snapshot] of [...this._restorePendingLive.entries()]) {
        const match = flights.find((flight) =>
          flight.id === id ||
          normalizeCallsign(flight.callsign) === normalizeCallsign(snapshot.callsign),
        );

        if (!match) continue;

        this._restorePendingLive.delete(id);
        this.trackFlight(match, {
          silentStart: true,
          restoredSnapshot: snapshot,
        }).catch(() => {});
      }
    };

    tryRestore(flightService.flights);
    flightService.subscribe((flights) => {
      tryRestore(flights);
    });
  }

  _emit() {
    const list = this.getTrackedList();
    this._listeners.forEach((fn) => fn(list));
  }

  _restartScheduledTimer() {
    if (this._scheduledTimer) {
      clearInterval(this._scheduledTimer);
      this._scheduledTimer = null;
    }

    const hasScheduled = [...this._flights.values()].some((state) => state.kind === 'scheduled');
    if (!hasScheduled || typeof window === 'undefined') return;

    this._scheduledTimer = window.setInterval(() => {
      this._checkScheduledStates();
    }, SCHEDULED_CHECK_MS);
  }

  _scheduleMidpoint(state, delayMs) {
    clearTimeout(state.midpointTimer);
    state.midpointTimer = setTimeout(() => {
      if (state.midpointFired || !this._flights.has(state.id)) return;
      state.midpointFired = true;
      const dest = state.enrichment?.destination;
      this._show(
        'Midway Update',
        dest?.name
          ? `${state.callsign} is halfway to ${dest.name}`
          : `${state.callsign} is at the midpoint`,
        `midpoint-${state.id}`,
      );
      this._persistTrackedState();
      this._emit();
    }, delayMs);
  }

  _checkScheduledStates(now = Date.now()) {
    let didChange = false;

    this._flights.forEach((state) => {
      if (state.kind !== 'scheduled') return;
      if (!state.scheduledDepartureMs) return;

      const soonWindowStart = state.scheduledDepartureMs - SCHEDULED_SOON_WINDOW_MS;
      const dest = state.enrichment?.destination;
      const origin = state.enrichment?.origin;
      const destinationLabel = dest?.name ?? dest?.code ?? 'destination';
      const originLabel = origin?.code ?? origin?.name ?? 'the airport';

      if (!state.notifiedSoon && now >= soonWindowStart && now < state.scheduledDepartureMs) {
        state.notifiedSoon = true;
        state.status = 'departing-soon';
        this._show(
          'Flight Departing Soon',
          `${state.flightNumber} is due out of ${originLabel} for ${destinationLabel} soon`,
          `scheduled-soon-${state.id}`,
        );
        didChange = true;
      }

      if (!state.departed && now >= state.scheduledDepartureMs) {
        state.departed = true;
        state.status = 'departed';
        this._show(
          'Flight Departed',
          `${state.flightNumber} has departed for ${destinationLabel}`,
          `scheduled-departed-${state.id}`,
        );
        didChange = true;
      }
    });

    if (didChange) {
      this._persistTrackedState();
      this._emit();
    }
  }

  _checkEvents(state, flight) {
    const alt = flight.altitude;
    const prev = state.prevAlt;

    this._updateLiveTiming(state, flight);

    if (!state.departed && prev != null && prev < GROUND_ALT_FT && alt > AIRBORNE_ALT_FT) {
      state.departed = true;
      const origin = state.enrichment?.origin;
      this._show(
        'Flight Departed',
        origin?.name
          ? `${state.callsign} has departed ${origin.name}`
          : `${state.callsign} has departed`,
        `departure-${state.id}`,
      );
      this._scheduleMidpoint(state, MIDPOINT_AFTER_DEPART_MS);
      this._persistTrackedState();
      this._emit();
    }

    if (state.departed && !state.arrivedFired) {
      const dest = state.enrichment?.destination;
      const destLabel =
        dest?.code && dest.code !== '----' ? dest.code : (dest?.name ?? 'destination');

      const apiLanded = this._isApiLanded(state.enrichment?.status);
      const groundedAlt = alt != null && alt <= LANDING_ALT_FT;
      const lowSpeed = flight.speed != null && flight.speed <= LANDING_SPEED_KTS;
      const descending = flight.vertRate != null ? flight.vertRate < FINAL_RATE_FPM : true;
      const prevWasHigher = prev != null ? prev > LANDING_ALT_FT : false;

      const landed =
        (apiLanded && (groundedAlt || lowSpeed)) ||
        (!apiLanded && groundedAlt && lowSpeed && (descending || prevWasHigher));

      if (landed) {
        state.arrivedFired = true;
        state.status = 'arrived';
        clearTimeout(state.midpointTimer);
        this._playLandingSound();
        this._showToastBanner(
          `Flight ${state.callsign} has landed at ${destLabel}`,
          '',
          `arrival-${state.id}`,
        );
        this._persistTrackedState();
        this._emit();
      }
    }

    this._maybeCheckDelay(state, flight);
    state.prevAlt = alt;
  }

  _maybeCheckDelay(state, flight) {
    if (state.arrivedFired) return;

    const now = Date.now();
    if (now - state.lastDelayEvalAt < DELAY_EVAL_THROTTLE_MS) return;
    state.lastDelayEvalAt = now;

    if (!state.enrichment) return;

    const times = computeFlightTimes(flight, state.enrichment);
    if (!times) return;

    const deptMin = Math.round(times.deptMs / 60_000);
    const etaMin = Math.round(times.etaMs / 60_000);

    if (state.lastDeptMinute == null || state.lastEtaMinute == null) {
      state.lastDeptMinute = deptMin;
      state.lastEtaMinute = etaMin;
      state.scheduledDepartureMs = times.deptMs;
      state.estimatedArrivalMs = times.etaMs;
      return;
    }

    const prevDeptMin = state.lastDeptMinute;
    const prevEtaMin = state.lastEtaMinute;
    const deptChanged = deptMin !== prevDeptMin;
    const etaChanged = etaMin !== prevEtaMin;
    if (!deptChanged && !etaChanged) return;

    state.lastDeptMinute = deptMin;
    state.lastEtaMinute = etaMin;
    state.scheduledDepartureMs = times.deptMs;
    state.estimatedArrivalMs = times.etaMs;

    const deltaDept = deptChanged ? deptMin - prevDeptMin : 0;
    const deltaEta = etaChanged ? etaMin - prevEtaMin : 0;
    const delayDelta = Math.max(deltaDept, deltaEta);
    if (delayDelta <= 0) return;

    state.delayMinutes = Math.max(state.delayMinutes ?? 0, delayDelta);

    if (now - state.lastDelayToastAt < DELAY_TOAST_COOLDOWN_MS) return;

    const key = `${deptMin}-${etaMin}`;
    if (state.lastDelayToastKey === key) return;

    state.lastDelayToastKey = key;
    state.lastDelayToastAt = now;

    this._showToastBanner(
      `Flight ${state.callsign} delayed by ${delayDelta} minutes`,
      '',
      `delay-${state.id}-${key}`,
    );
    this._persistTrackedState();
    this._emit();
  }

  _showToastBanner(title, body, tag) {
    this._showInApp(title, body);
    this._showSystem(title, body, tag);
  }

  async _showSystem(title, body, tag) {
    if (!this.isGranted()) return;

    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, {
          body,
          icon: ICON,
          badge: ICON,
          tag,
          renotify: true,
          requireInteraction: false,
        });
        return;
      } catch {
        // Fall through.
      }
    }

    try {
      // eslint-disable-next-line no-new
      new Notification(title, { body, icon: ICON, tag });
    } catch {
      // Ignore system notification failures.
    }
  }

  async _show(title, body, tag) {
    if (this.isGranted()) {
      if ('serviceWorker' in navigator) {
        try {
          const reg = await navigator.serviceWorker.ready;
          await reg.showNotification(title, {
            body,
            icon: ICON,
            badge: ICON,
            tag,
            renotify: true,
            requireInteraction: false,
          });
          return;
        } catch {
          // Fall through.
        }
      }

      try {
        // eslint-disable-next-line no-new
        new Notification(title, { body, icon: ICON, tag });
        return;
      } catch {
        // Fall through to in-app.
      }
    }

    this._showInApp(title, body);
  }
}

export const notificationService = new NotificationService();

