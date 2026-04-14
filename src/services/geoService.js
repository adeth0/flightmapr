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

/**
 * Asks the browser for the user's location.
 * - Never rejects — returns null instead of throwing.
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
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      () => resolve(null),
      { timeout: timeoutMs, enableHighAccuracy: false, maximumAge: 300_000 }
    );
  });
}
