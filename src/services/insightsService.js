// ─────────────────────────────────────────────────────────
//  insightsService
//  Lightweight analytics layer that derives five rolled-up
//  views from the existing live flightService feed + the
//  airport dataset. It never issues its own API requests;
//  everything is computed from state already in memory, so
//  the panel is cheap to open/refresh and cannot overload
//  any third-party service.
//
//  Caching:
//    Each query is memoised for CACHE_MS using a fingerprint
//    of the current flight count + last poll time. Opening +
//    closing the panel repeatedly therefore costs nothing.
//
//  Exports:
//    busyAirportsNear(lat, lng, radiusMiles)
//    topDeparturesToday(limit)
//    nextArrivals(windowMinutes, limit)
//    currentlyLanding(limit)
//    mostDelayedFlights(limit)
//    clearInsightsCache()
// ─────────────────────────────────────────────────────────

import { flightService, AIRPORTS } from './flightService.js';
import { getCachedEnrichment }     from './flightEnrichmentService.js';
import { computeFlightTimes }      from './flightTimingService.js';

const CACHE_MS = 4_000;                 // re-compute at most every 4 s
const MILES_TO_KM = 1.60934;
const D2R = Math.PI / 180;

// ── Memoisation ──────────────────────────────────────────
// Each key → { at, fingerprint, value }. We invalidate when
// flightService.flights length changes or the poll clock ticks.
const _cache = new Map();

function fingerprint() {
  return `${flightService.flights.length}:${flightService.dataSource}`;
}

function memoise(key, args, compute) {
  const fp    = fingerprint();
  const fullK = `${key}:${args.join(':')}`;
  const hit   = _cache.get(fullK);
  const now   = Date.now();
  if (hit && hit.fingerprint === fp && now - hit.at < CACHE_MS) {
    return hit.value;
  }
  const value = compute();
  _cache.set(fullK, { at: now, fingerprint: fp, value });
  return value;
}

export function clearInsightsCache() {
  _cache.clear();
}

// ── Math helpers ─────────────────────────────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * D2R;
  const dLng = (lng2 - lng1) * D2R;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

// ── Shared flight classifiers ────────────────────────────
/**
 * Guess the origin airport of a live flight.
 * First choice: enrichment cache (high quality when available).
 * Fallback:     nearest AIRPORTS entry within 60 km of the aircraft's
 *               current position — reasonable for aircraft seen on the
 *               ground or shortly after takeoff.
 */
function guessedOriginCode(flight) {
  const enrichment = getCachedEnrichment(flight.callsign);
  if (enrichment?.origin?.code && enrichment.origin.code !== '----') {
    return enrichment.origin.code;
  }
  // Only infer from position for aircraft that are still low — matches
  // how pilots leave the departure airport cluster, avoiding matching
  // a cruising flight to whatever airport is closest below it.
  if (flight.altitude != null && flight.altitude > 8_000) return null;

  let bestCode = null;
  let bestDist = 60;
  for (const ap of Object.values(AIRPORTS)) {
    const d = haversineKm(flight.lat, flight.lng, ap.lat, ap.lng);
    if (d < bestDist) { bestDist = d; bestCode = ap.code; }
  }
  return bestCode;
}

function guessedDestinationCode(flight) {
  const enrichment = getCachedEnrichment(flight.callsign);
  if (enrichment?.destination?.code && enrichment.destination.code !== '----') {
    return enrichment.destination.code;
  }
  return null;
}

function delayMinutesFor(flight) {
  const enrichment = getCachedEnrichment(flight.callsign);
  if (enrichment && Number.isFinite(enrichment.delayMinutes)) return enrichment.delayMinutes;
  return 0;
}

// ── 1. Busy airports near you ───────────────────────────
/**
 * Rank airports by (departures + arrivals) currently in the live feed,
 * within `radiusMiles` of the supplied user location. Missing loc →
 * returns a global ranking instead.
 */
export function busyAirportsNear(lat, lng, radiusMiles = 200, limit = 6) {
  return memoise('busyAirportsNear', [lat, lng, radiusMiles, limit], () => {
    const hasLoc = Number.isFinite(lat) && Number.isFinite(lng);
    const radiusKm = radiusMiles * MILES_TO_KM;

    const totals = new Map(); // code → { airport, dep, arr }

    // Seed all in-range airports so empty hubs still appear with a zero
    // count, matching the "show me what's around" intent.
    for (const airport of Object.values(AIRPORTS)) {
      if (hasLoc) {
        const d = haversineKm(lat, lng, airport.lat, airport.lng);
        if (d > radiusKm) continue;
        totals.set(airport.code, { airport, dep: 0, arr: 0, distanceKm: d });
      } else {
        totals.set(airport.code, { airport, dep: 0, arr: 0, distanceKm: null });
      }
    }

    // Count touches from the live feed.
    for (const f of flightService.flights) {
      const oCode = guessedOriginCode(f);
      const dCode = guessedDestinationCode(f);
      if (oCode && totals.has(oCode))  totals.get(oCode).dep += 1;
      if (dCode && totals.has(dCode))  totals.get(dCode).arr += 1;
    }

    const ranked = [...totals.values()]
      .map((row) => ({ ...row, total: row.dep + row.arr }))
      .sort((a, b) => {
        if (b.total !== a.total) return b.total - a.total;
        if (a.distanceKm == null || b.distanceKm == null) return 0;
        return a.distanceKm - b.distanceKm;                   // break ties by proximity
      });

    // If none of the nearby airports have any movements, fall back to
    // the closest ones so the card is never empty.
    const withMovement = ranked.filter((r) => r.total > 0);
    const final = withMovement.length > 0 ? withMovement : ranked;

    return final.slice(0, limit);
  });
}

// ── 2. Top departures today ─────────────────────────────
/**
 * "Busiest routes flying right now." Grouped by origin airport with the
 * top airline/callsign surfaced so the card reads as a headline: who's
 * currently pushing the most movement out of each hub.
 */
export function topDeparturesToday(limit = 6) {
  return memoise('topDeparturesToday', [limit], () => {
    const counts = new Map(); // code → { airport, count, sampleFlights: [] }

    for (const f of flightService.flights) {
      const oCode = guessedOriginCode(f);
      if (!oCode) continue;
      const ap = AIRPORTS[oCode];
      if (!ap) continue;

      if (!counts.has(oCode)) counts.set(oCode, { airport: ap, count: 0, sampleFlights: [] });
      const entry = counts.get(oCode);
      entry.count += 1;
      if (entry.sampleFlights.length < 3) entry.sampleFlights.push(f);
    }

    return [...counts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  });
}

// ── 3. Next arrivals (within N minutes) ─────────────────
/**
 * Live flights whose computed ETA falls inside the next `windowMinutes`.
 * Requires an enrichment cache hit for ETA; silently skips otherwise.
 */
export function nextArrivals(windowMinutes = 30, limit = 8) {
  return memoise('nextArrivals', [windowMinutes, limit], () => {
    const now = Date.now();
    const cutoff = now + windowMinutes * 60_000;

    const rows = [];
    for (const f of flightService.flights) {
      const enrichment = getCachedEnrichment(f.callsign);
      if (!enrichment?.destination) continue;

      const times = computeFlightTimes(f, enrichment);
      if (!times?.etaMs) continue;
      if (times.etaMs < now || times.etaMs > cutoff) continue;

      rows.push({
        flight: f,
        destination: enrichment.destination,
        origin: enrichment.origin ?? f.origin,
        etaMs: times.etaMs,
        remainNm: times.remainNm,
        delayMinutes: enrichment.delayMinutes ?? 0,
      });
    }

    rows.sort((a, b) => a.etaMs - b.etaMs);
    return rows.slice(0, limit);
  });
}

// ── 4. Currently landing ────────────────────────────────
/**
 * Aircraft on final approach: low altitude, low groundspeed, and
 * descending OR within 20 km of their enriched destination. The
 * heuristic matches how the Sidebar already detects landings.
 */
export function currentlyLanding(limit = 10) {
  return memoise('currentlyLanding', [limit], () => {
    const rows = [];

    for (const f of flightService.flights) {
      const lowAlt  = f.altitude != null && f.altitude <= 3_500;
      const lowSpd  = f.speed != null && f.speed <= 220;
      const sinking = f.vertRate != null && f.vertRate < -300;

      let nearDest = false;
      let destAirport = null;
      const enrichment = getCachedEnrichment(f.callsign);
      if (enrichment?.destination?.lat) {
        const d = haversineKm(f.lat, f.lng, enrichment.destination.lat, enrichment.destination.lng);
        if (d <= 25) nearDest = true;
        destAirport = enrichment.destination;
      }

      // Require at least two landing signals so cruise traffic doesn't
      // leak in when an aircraft briefly levels off.
      const signals = [lowAlt, lowSpd, sinking, nearDest].filter(Boolean).length;
      if (signals < 2) continue;

      rows.push({
        flight: f,
        destination: destAirport,
        altitude: f.altitude,
        vertRate: f.vertRate,
        speed: f.speed,
      });
    }

    rows.sort((a, b) => (a.altitude ?? 99_999) - (b.altitude ?? 99_999));
    return rows.slice(0, limit);
  });
}

// ── 5. Most delayed flights ─────────────────────────────
export function mostDelayedFlights(limit = 8) {
  return memoise('mostDelayedFlights', [limit], () => {
    const rows = flightService.flights
      .map((f) => {
        const enrichment = getCachedEnrichment(f.callsign);
        const delayMinutes = delayMinutesFor(f);
        return {
          flight: f,
          origin: enrichment?.origin ?? null,
          destination: enrichment?.destination ?? null,
          delayMinutes,
        };
      })
      .filter((r) => r.delayMinutes >= 10);

    rows.sort((a, b) => b.delayMinutes - a.delayMinutes);
    return rows.slice(0, limit);
  });
}

// ── Delay heatmap aggregator ─────────────────────────────
/**
 * Per-airport delay roll-up: average delay minutes + aircraft count for
 * every airport with at least one live movement. Used by DelayHeatmapLayer.
 * Returns [{ airport, avgDelay, count }].
 */
export function delayByAirport() {
  return memoise('delayByAirport', [], () => {
    const agg = new Map(); // code → { airport, sum, count }

    for (const f of flightService.flights) {
      const code = guessedOriginCode(f) ?? guessedDestinationCode(f);
      if (!code) continue;
      const ap = AIRPORTS[code];
      if (!ap) continue;

      if (!agg.has(code)) agg.set(code, { airport: ap, sum: 0, count: 0 });
      const row = agg.get(code);
      row.sum   += delayMinutesFor(f);
      row.count += 1;
    }

    return [...agg.values()].map((row) => ({
      airport: row.airport,
      avgDelay: row.count ? row.sum / row.count : 0,
      count: row.count,
    }));
  });
}
