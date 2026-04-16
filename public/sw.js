const DB_NAME = 'flightmapr-background-v1';
const STORE_NAME = 'trackedFlights';
const ADSBDB_BASE = 'https://api.adsbdb.com/v0/callsign';
const SCHEDULED_SOON_WINDOW_MS = 20 * 60 * 1_000;
const POLL_THROTTLE_MS = 5 * 60 * 1_000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function replaceTrackedFlights(flights) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    (flights ?? []).forEach((flight) => {
      if (flight?.id) store.put(flight);
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function removeTrackedFlight(id) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function readTrackedFlights() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
    request.onerror = () => reject(request.error);
  });
}

function isArrivedStatus(status) {
  const value = String(status ?? '').toLowerCase();
  return value.includes('land') || value.includes('arriv') || value.includes('completed');
}

function isDepartedStatus(status) {
  const value = String(status ?? '').toLowerCase();
  return value.includes('depart') || value.includes('en route') || value.includes('enroute') || value.includes('active');
}

async function showTrackedNotification(title, body, tag, data = {}) {
  await self.registration.showNotification(title, {
    body,
    icon: '/vite.svg',
    badge: '/vite.svg',
    tag,
    renotify: true,
    requireInteraction: false,
    data,
  });
}

async function fetchStatus(callsign) {
  const key = String(callsign ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!key) return null;

  try {
    const response = await fetch(`${ADSBDB_BASE}/${key}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;

    const json = await response.json();
    const route = json?.response?.flightroute;
    const status = json?.response?.status ?? json?.response?.flightstatus ?? json?.response?.flight_status ?? null;

    return {
      status,
      destination: route?.destination?.name ?? route?.destination?.iata_code ?? null,
      origin: route?.origin?.name ?? route?.origin?.iata_code ?? null,
    };
  } catch {
    return null;
  }
}

async function pollTrackedFlights() {
  const tracked = await readTrackedFlights();
  if (tracked.length === 0) return;

  const now = Date.now();
  const nextState = [];

  for (const item of tracked) {
    const state = { ...item };
    const destination = state.enrichment?.destination?.name ?? state.enrichment?.destination?.code ?? state.destination ?? 'destination';
    const origin = state.enrichment?.origin?.code ?? state.enrichment?.origin?.name ?? state.origin ?? 'the airport';

    if (state.kind === 'scheduled' && state.scheduledDepartureMs) {
      const soonAt = state.scheduledDepartureMs - SCHEDULED_SOON_WINDOW_MS;
      if (!state.notifiedSoon && now >= soonAt && now < state.scheduledDepartureMs) {
        await showTrackedNotification(
          'Flight Departing Soon',
          `${state.flightNumber ?? state.callsign} is due out of ${origin} for ${destination} soon`,
          `scheduled-soon-${state.id}`,
          { trackedId: state.id },
        );
        state.notifiedSoon = true;
        state.status = 'departing-soon';
      }

      if (!state.departed && now >= state.scheduledDepartureMs) {
        await showTrackedNotification(
          'Flight Departed',
          `${state.flightNumber ?? state.callsign} has departed for ${destination}`,
          `scheduled-departed-${state.id}`,
          { trackedId: state.id },
        );
        state.departed = true;
        state.status = 'departed';
      }
    }

    const shouldRefreshRemote = state.callsign && (!state.lastRemoteCheckAt || now - state.lastRemoteCheckAt >= POLL_THROTTLE_MS);
    if (shouldRefreshRemote) {
      state.lastRemoteCheckAt = now;
      const remote = await fetchStatus(state.callsign);
      if (remote?.status) {
        state.status = remote.status;
      }

      const remoteDestination = remote?.destination ?? destination;

      if (!state.departed && (isDepartedStatus(remote?.status) || (state.scheduledDepartureMs && now >= state.scheduledDepartureMs))) {
        await showTrackedNotification(
          'Flight Departed',
          `${state.flightNumber ?? state.callsign} has departed for ${remoteDestination}`,
          `background-departed-${state.id}`,
          { trackedId: state.id },
        );
        state.departed = true;
      }

      if (!state.arrivedFired && isArrivedStatus(remote?.status)) {
        await showTrackedNotification(
          'Flight Arrived',
          `${state.flightNumber ?? state.callsign} has arrived at ${remoteDestination}`,
          `background-arrived-${state.id}`,
          { trackedId: state.id },
        );
        state.arrivedFired = true;
      }
    }

    nextState.push(state);
  }

  await replaceTrackedFlights(nextState);
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data?.type) return;

  if (data.type === 'NOTIFY') {
    const { title, body, icon = '/vite.svg', tag = 'flightmapr' } = data;
    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        icon,
        badge: icon,
        tag,
        renotify: true,
        requireInteraction: false,
      }),
    );
    return;
  }

  if (data.type === 'SYNC_TRACKED_FLIGHTS') {
    event.waitUntil(replaceTrackedFlights(data.flights));
    return;
  }

  if (data.type === 'UNTRACK_FLIGHT') {
    event.waitUntil(removeTrackedFlight(data.id));
    return;
  }

  if (data.type === 'RUN_TRACKING_CHECK') {
    event.waitUntil(pollTrackedFlights());
  }
});

self.addEventListener('push', (event) => {
  const payload = (() => {
    try {
      return event.data?.json?.() ?? null;
    } catch {
      return null;
    }
  })();

  const title = payload?.title ?? 'FlightMapr';
  const body = payload?.body ?? 'Flight updates are available.';
  const tag = payload?.tag ?? 'flightmapr-push';
  event.waitUntil(showTrackedNotification(title, body, tag, payload?.data ?? {}));
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'flightmapr-flight-check') {
    event.waitUntil(pollTrackedFlights());
  }
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'flightmapr-flight-check') {
    event.waitUntil(pollTrackedFlights());
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const trackedId = event.notification.data?.trackedId;
  const targetUrl = trackedId ? `/?tracked=${encodeURIComponent(trackedId)}` : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.startsWith(self.location.origin));
      if (existing) {
        existing.focus();
        existing.postMessage({ type: 'OPEN_TRACKED_FLIGHT', trackedId });
        return existing;
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
