// ─────────────────────────────────────────────────────────
//  OpenSky Network API — free, no key, anonymous tier
//  Rate limit: poll no faster than every 10 s (we use 15 s)
//  Docs: https://opensky-network.org/apidoc/rest.html
// ─────────────────────────────────────────────────────────

const OPENSKY_URL  = 'https://opensky-network.org/api/states/all';
const POLL_MS      = 15_000;
const MAX_AIRCRAFT = 250;
const MIN_ALT_M    = 3000; // skip taxiing / low helicopters

/**
 * Maps a raw OpenSky state-vector array to the shape FlightService expects.
 * Returns null for invalid / on-ground / low-altitude states.
 *
 * State vector indices:
 *  0 icao24 | 1 callsign | 2 origin_country | 3 time_position | 4 last_contact
 *  5 longitude | 6 latitude | 7 baro_altitude(m) | 8 on_ground
 *  9 velocity(m/s) | 10 true_track(deg) | 11 vertical_rate | 12 sensors
 *  13 geo_altitude | 14 squawk | 15 spi | 16 position_source
 */
function parseState(s) {
  if (!s || s[5] === null || s[6] === null || s[8]) return null;
  const altM  = s[7] ?? s[13] ?? 0;
  if (altM < MIN_ALT_M) return null;

  const altFt    = Math.round(altM * 3.281);
  const speedKts = s[9] !== null ? Math.round(s[9] * 1.944) : 450;
  const heading  = s[10] ?? 0;
  const cs       = (s[1] ?? s[0]).trim().replace(/\s+/g, '') || s[0];
  const country  = s[2] ?? 'Unknown';

  return {
    id:           s[0],
    callsign:     cs,
    flightNumber: cs,
    airline:      country,
    aircraft:     'Unknown',
    lat:          s[6],
    lng:          s[5],
    altitude:     altFt,
    speed:        speedKts,
    heading,
    isLive:       true,
    // Placeholders so Sidebar doesn't crash
    origin:      { code: '----', name: 'Live Aircraft', city: country, country, lat: 0, lng: 0 },
    destination: { code: '----', name: 'En Route',      city: '',      country: '', lat: 0, lng: 0 },
    progress:      0.5,
    routeDistance: 1000,
    routePoints:   [],
    trail:         [],
  };
}

class OpenSkyService {
  constructor() {
    this._cache     = null;   // last successful array
    this._lastFetch = 0;
    this._inflight  = null;   // pending fetch promise
    this.available  = null;   // null=unknown true=ok false=failed
  }

  /**
   * Returns cached data if fresh enough, otherwise fetches.
   * Never throws — returns null on failure.
   */
  async fetchOnce() {
    const now = Date.now();
    if (now - this._lastFetch < POLL_MS && this._cache) return this._cache;
    if (this._inflight) return this._inflight;

    this._lastFetch = now;
    this._inflight  = this._doFetch().finally(() => { this._inflight = null; });
    return this._inflight;
  }

  async _doFetch() {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);

      const res = await fetch(OPENSKY_URL, {
        signal:  ctrl.signal,
        cache:   'no-store',
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timer);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();
      const raw  = json.states ?? [];

      // Sort by last-contact recency, take up to MAX_AIRCRAFT
      const flights = raw
        .sort((a, b) => (b[4] ?? 0) - (a[4] ?? 0))
        .map(parseState)
        .filter(Boolean)
        .slice(0, MAX_AIRCRAFT);

      this._cache    = flights;
      this.available = flights.length > 0;
      console.info(`[OpenSky] ${flights.length} live aircraft loaded`);
      return flights;
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('[OpenSky] fetch failed:', err.message);
      }
      this.available = false;
      return null;
    }
  }
}

export const openSkyService = new OpenSkyService();
