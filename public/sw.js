/* ─────────────────────────────────────────────────────────
   FlightMapr Service Worker
   Handles background notification display when the page
   is minimised or the screen is off (Android Chrome).
   iOS Safari 16.4+ in standalone PWA mode also benefits.
───────────────────────────────────────────────────────── */

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// ── Message handler (main thread → SW) ───────────────────
// The main thread posts { type: 'NOTIFY', title, body, tag }
// when it wants to show a notification (including background).
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'NOTIFY') return;
  const { title, body, icon = '/vite.svg', tag = 'flightmapr' } = event.data;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge:          icon,
      tag,
      renotify:       true,
      requireInteraction: false,
    })
  );
});

// ── Notification click → focus or open the app ───────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((list) => {
        const existing = list.find((c) => c.url.startsWith(self.location.origin));
        if (existing) return existing.focus();
        return self.clients.openWindow('/');
      })
  );
});
