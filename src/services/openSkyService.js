// ─────────────────────────────────────────────────────────
//  OpenSky Network API — free, no key, anonymous tier
//  Rate limit: poll no faster than every 10 s (we use 15 s)
//  Docs: https://opensky-network.org/apidoc/rest.html
//
//  Enhancements over v1:
//    • ICAO airline callsign-prefix → airline name lookup
//    • Viewport bbox filtering (only fetch visible airspace)
//    • Exponential backoff on repeated failures
// ─────────────────────────────────────────────────────────

const OPENSKY_BASE  = 'https://opensky-network.org/api/states/all';
const POLL_MS       = 15_000;
const MAX_AIRCRAFT  = 250;
const MIN_ALT_M     = 3000;
const MAX_BACKOFF   = 120_000; // cap retry delay at 2 minutes

// ── ICAO 3-letter operator prefix → airline name ──────────
// Maps the first 3 chars of a callsign to a human-readable name.
// Coverage: ~80 major operators. Unknown prefixes fall back to origin country.
const ICAO_AIRLINES = {
  AAL: 'American Airlines',  AAR: 'Asiana Airlines',
  ACA: 'Air Canada',         AFR: 'Air France',
  AIC: 'Air India',          ANA: 'All Nippon Airways',
  ANZ: 'Air New Zealand',    ARG: 'Aerolíneas Argentinas',
  ASA: 'Alaska Airlines',    AUA: 'Austrian Airlines',
  AVA: 'Avianca',            AXM: 'AirAsia',
  AZA: 'ITA Airways',        AZU: 'Azul Airlines',
  BAW: 'British Airways',    BEL: 'Brussels Airlines',
  BTI: 'airBaltic',          CAL: 'China Airlines',
  CCA: 'Air China',          CES: 'China Eastern',
  CPA: 'Cathay Pacific',     CSN: 'China Southern',
  CTN: 'Croatia Airlines',   DAL: 'Delta Air Lines',
  DLH: 'Lufthansa',          EIN: 'Aer Lingus',
  ELY: 'El Al',              ETD: 'Etihad Airways',
  ETH: 'Ethiopian Airlines', EZY: 'easyJet',
  FDB: 'flydubai',           FIN: 'Finnair',
  GEC: 'Lufthansa Cargo',    GFA: 'Gulf Air',
  GTI: 'Atlas Air',          HAL: 'Hawaiian Airlines',
  HVN: 'Vietnam Airlines',   IBE: 'Iberia',
  IBS: 'Iberia Express',     ICE: 'Icelandair',
  ISS: 'Meridiana',          JAI: 'IndiGo',
  JAL: 'Japan Airlines',     JBU: 'JetBlue',
  JNA: 'Jin Air',            KAL: 'Korean Air',
  KAC: 'Kuwait Airways',     KLM: 'KLM',
  LAN: 'LATAM Airlines',     LAM: 'LAM Mozambique',
  LOT: 'LOT Polish Airlines',MAS: 'Malaysia Airlines',
  MEA: 'Middle East Airlines',MSR: 'EgyptAir',
  MXD: 'Mexicana',           NAX: 'Norwegian',
  NKS: 'Spirit Airlines',    NWA: 'Northwest Airlines',
  OAL: 'Olympic Air',        PIA: 'Pakistan International',
  QFA: 'Qantas',             QTR: 'Qatar Airways',
  RAM: 'Royal Air Maroc',    RJA: 'Royal Jordanian',
  RYR: 'Ryanair',            SAS: 'Scandinavian Airlines',
  SIA: 'Singapore Airlines', SKW: 'SkyWest Airlines',
  SVA: 'Saudia',             SWR: 'Swiss',
  TAM: 'LATAM Brasil',       TAP: 'TAP Air Portugal',
  THA: 'Thai Airways',       THY: 'Turkish Airlines',
  TOM: 'TUI Airways',        UAE: 'Emirates',
  UAL: 'United Airlines',    UPS: 'UPS Airlines',
  VIR: 'Virgin Atlantic',    VOE: 'Volotea',
  VRD: 'Virgin America',     WJA: 'WestJet',
  WN:  'Southwest Airlines', WZZ: 'Wizz Air',
};

function lookupAirline(callsign) {
  if (!callsign || callsign.length < 2) return null;
  return (
    ICAO_AIRLINES[callsign.substring(0, 3).toUpperCase()] ??
    ICAO_AIRLINES[callsign.substring(0, 2).toUpperCase()] ??
    null
  );
}

// ── State-vector parser ───────────────────────────────────
function parseState(s) {
  if (!s || s[5] === null || s[6] === null || s[8]) return null;
  const altM = s[7] ?? s[13] ?? 0;
  if (altM < MIN_ALT_M) return null;

  const altFt    = Math.round(altM * 3.281);
  const speedKts = s[9] !== null ? Math.round(s[9] * 1.944) : 450;
  const heading  = s[10] ?? 0;
  const cs       = (s[1] ?? s[0]).trim().replace(/\s+/g, '') || s[0];
  const country  = s[2] ?? 'Unknown';
  const airline  = lookupAirline(cs) ?? country;

  return {
    id:           s[0],
    callsign:     cs,
    flightNumber: cs,
    airline,
    aircraft:     'Unknown',
    lat:          s[6],
    lng:          s[5],
    altitude:     altFt,
    speed:        speedKts,
    heading,
    isLive:       true,
    origin:      { code: '----', name: 'Live Aircraft', city: country, country, lat: 0, lng: 0 },
    destination: { code: '----', name: 'En Route',      city: '',      country: '', lat: 0, lng: 0 },
    progress:    0.5,
    routeDistance: 1000,
    routePoints: [],
    trail:       [],
  };
}

// ── OpenSkyService ────────────────────────────────────────
class OpenSkyService {
  constructor() {
    this._cache     = null;
    this._lastFetch = 0;
    this._inflight  = null;
    this.available  = null;
    this._bbox      = null;     // { lamin, lomin, lamax, lomax } — set by BoundsSync
    this._failCount = 0;        // consecutive failures for backoff
  }

  /**
   * Called by MapView's BoundsSync whenever the viewport changes.
   * Adds a 25% margin so aircraft near the edge aren't clipped.
   */
  setBounds(raw) {
    const latSpan = raw.lamax - raw.lamin;
    const lonSpan = raw.lomax - raw.lomin;
    const pad = 0.25;
    this._bbox = {
      lamin: Math.max(-90,  raw.lamin - latSpan * pad),
      lomin: Math.max(-180, raw.lomin - lonSpan * pad),
      lamax: Math.min(90,   raw.lamax + latSpan * pad),
      lomax: Math.min(180,  raw.lomax + lonSpan * pad),
    };
  }

  /** Returns cached data if fresh enough, otherwise fetches. Never throws. */
  async fetchOnce() {
    const now = Date.now();
    // Respect backoff after failures
    if (this._failCount > 0) {
      const backoff = Math.min(POLL_MS * 2 ** (this._failCount - 1), MAX_BACKOFF);
      if (now - this._lastFetch < backoff) return this._cache;
    }
    if (now - this._lastFetch < POLL_MS && this._cache) return this._cache;
    if (this._inflight) return this._inflight;

    this._lastFetch = now;
    this._inflight  = this._doFetch().finally(() => { this._inflight = null; });
    return this._inflight;
  }

  async _doFetch() {
    try {
      // Build URL — add bbox when viewport is narrow enough to be useful
      let url = OPENSKY_BASE;
      if (this._bbox) {
        const { lamin, lomin, lamax, lomax } = this._bbox;
        // Only filter by bbox when not viewing the full globe
        const latSpan = lamax - lamin;
        const lonSpan = lomax - lomin;
        if (latSpan < 150 && lonSpan < 300) {
          url += `?lamin=${lamin.toFixed(2)}&lomin=${lomin.toFixed(2)}` +
                 `&lamax=${lamax.toFixed(2)}&lomax=${lomax.toFixed(2)}`;
        }
      }

      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);

      const res = await fetch(url, {
        signal:  ctrl.signal,
        cache:   'no-store',
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timer);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json    = await res.json();
      const raw     = json.states ?? [];
      const flights = raw
        .sort((a, b) => (b[4] ?? 0) - (a[4] ?? 0))
        .map(parseState)
        .filter(Boolean)
        .slice(0, MAX_AIRCRAFT);

      this._cache     = flights;
      this._failCount = 0;
      this.available  = flights.length > 0;
      console.info(`[OpenSky] ${flights.length} aircraft (bbox: ${this._bbox ? 'yes' : 'global'})`);
      return flights;
    } catch (err) {
      if (err.name !== 'AbortError') {
        this._failCount++;
        console.warn(`[OpenSky] fetch failed (attempt ${this._failCount}):`, err.message);
      }
      this.available = false;
      return this._cache ?? null;   // return stale cache on failure rather than null
    }
  }
}

export const openSkyService = new OpenSkyService();
