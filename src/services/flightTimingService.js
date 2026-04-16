// flightTimingService
// Shared time-estimation helpers (used by Sidebar + notification delay detection)

function haversineNm(lat1, lng1, lat2, lng2) {
  const R = 3440.065; // Earth radius in nautical miles
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Estimates departure (deptMs) and ETA (etaMs) based on current position + enrichment route.
 * This intentionally mirrors the existing Sidebar behavior so UI + notifications stay consistent.
 *
 * @param {object} flight
 * @param {object|null} enrichment
 * @returns {{ etaMs: number, deptMs: number, remainNm: number } | null}
 */
export function computeFlightTimes(flight, enrichment) {
  const origin = enrichment?.origin;
  const dest = enrichment?.destination;

  if (!origin?.lat || !dest?.lat || origin.lat === 0 || dest.lat === 0) return null;
  if (!flight.speed || flight.speed < 50) return null;

  const remainNm = haversineNm(flight.lat, flight.lng, dest.lat, dest.lng);
  const totalNm = haversineNm(origin.lat, origin.lng, dest.lat, dest.lng);
  if (totalNm < 1) return null;

  const remainHours = remainNm / flight.speed;
  const etaMs = Date.now() + remainHours * 3_600_000;
  const deptMs = etaMs - (totalNm / flight.speed) * 3_600_000;
  return { etaMs, deptMs, remainNm: Math.round(remainNm) };
}

