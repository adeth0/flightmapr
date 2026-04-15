// ─────────────────────────────────────────────────────────
//  flightEnrichmentService
//  Fetches origin + destination route data from adsbdb.com
//  when the user selects an aircraft.
//
//  API  : https://api.adsbdb.com/v0/callsign/{callsign}
//  CORS : access-control-allow-origin: *  (no API key needed)
//  Cache: in-memory Map — one lookup per callsign per session
// ─────────────────────────────────────────────────────────

const BASE = 'https://api.adsbdb.com/v0/callsign';

// In-memory cache: callsign → enrichment result (or null if not found)
const _cache = new Map();

/**
 * Shape of a returned airport object:
 * { code, icao, name, city, country, lat, lng }
 *
 * Shape of the returned enrichment object:
 * { origin, destination, airlineCallsign }  — or null if unavailable
 */

function parseAirport(ap) {
  if (!ap) return null;
  return {
    code:    ap.iata_code || ap.icao_code || '----',
    icao:    ap.icao_code  ?? '----',
    name:    ap.name       ?? 'Unknown Airport',
    city:    ap.municipality ?? '',
    country: ap.country_name ?? '',
    lat:     ap.latitude   ?? 0,
    lng:     ap.longitude  ?? 0,
  };
}

/**
 * Look up route data for a callsign.
 * Returns enrichment object or null.
 * Results are cached for the session — subsequent calls are synchronous.
 */
export async function enrichFlight(callsign) {
  if (!callsign) return null;

  // Normalise: uppercase, no whitespace (airplanes.live sometimes pads with spaces)
  const key = callsign.trim().toUpperCase().replace(/\s+/g, '');
  if (!key || key === '----') return null;

  if (_cache.has(key)) return _cache.get(key);

  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6_000);

    const res = await fetch(`${BASE}/${key}`, {
      signal:  ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);

    if (!res.ok) {
      _cache.set(key, null);
      return null;
    }

    const json  = await res.json();
    const route = json?.response?.flightroute;

    if (!route?.origin || !route?.destination) {
      _cache.set(key, null);
      return null;
    }

    const result = {
      origin:          parseAirport(route.origin),
      destination:     parseAirport(route.destination),
      airlineCallsign: route.airline?.callsign ?? null,   // e.g. "SPEEDBIRD"
    };

    _cache.set(key, result);
    return result;
  } catch {
    // Abort or network error — don't cache so it can be retried
    return null;
  }
}
