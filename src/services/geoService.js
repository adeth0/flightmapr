// ─────────────────────────────────────────────────────────
//  GeoService — browser Geolocation API wrapper
//  Resolves to { lat, lng } on success, null on denial/error.
//  iOS Safari compatible: no enableHighAccuracy, generous timeout.
//
//  LOCATION_ZOOM targets ~50 mile (≈80 km) viewing radius.
//  Leaflet zoom 9 ≈ 150 km viewport width → ≈75 km radius.
// ─────────────────────────────────────────────────────────

/** Leaflet zoom level that gives roughly a 50-mile radius view */
export const LOCATION_ZOOM = 9;

// ── localStorage cache ────────────────────────────────────
const CACHE_KEY = 'flightmapr_loc';
const CACHE_TTL = 24 * 60 * 60 * 1_000; // 24 hours

/**
 * Synchronous cache read — returns the last known user location
 * (within 24 h) or null.  Used as the React initial-state factory
 * so returning users get instant map centering with no geolocation
 * permission dialog on first render.
 *
 * @returns {{ lat: number, lng: number } | null}
 */
export function getCachedLocation() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { lat, lng, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

/**
 * Asks the browser for the user's location.
 * - Never rejects — returns null instead of throwing.
 * - Writes successful results to localStorage for instant loading next time.
 * - maximumAge: 5 min (avoids redundant GPS wakes on mobile).
 * - enableHighAccuracy: false (faster, sufficient for map centering).
 *
 * @param {number} [timeoutMs=8000]
 * @returns {Promise<{lat: number, lng: number} | null>}
 */
export function getUserLocation(timeoutMs = 8_000) {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const loc = { lat: coords.latitude, lng: coords.longitude };
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ ...loc, ts: Date.now() }));
        } catch { /* ignore storage errors (private mode etc.) */ }
        resolve(loc);
      },
      () => resolve(null),
      { timeout: timeoutMs, enableHighAccuracy: false, maximumAge: 300_000 }
    );
  });
}
