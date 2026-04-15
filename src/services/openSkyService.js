// ─────────────────────────────────────────────────────────
//  ADS-B data via airplanes.live
//  Free · No API key · access-control-allow-origin: *
//  (OpenSky blocks browser fetches: ACAO locked to opensky-network.org)
//
//  Endpoint: https://api.airplanes.live/v2/point/{lat}/{lon}/{radius_nm}
//  Polling : every 15 s
//  Docs    : https://airplanes.live/api-access/
// ─────────────────────────────────────────────────────────

const BASE_URL      = 'https://api.airplanes.live/v2/point';
const POLL_MS       = 15_000;
const MAX_AIRCRAFT  = 250;
const MIN_ALT_FT    = 1_000;   // filter ground vehicles / taxiing aircraft
const MAX_RADIUS_NM = 500;     // cap so we never request the whole globe
const MAX_BACKOFF   = 120_000;

// ── ICAO 3-letter operator prefix → airline name ──────────
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

// ── airplanes.live state-vector parser ────────────────────
// Response fields: hex, flight, lat, lon, alt_baro, alt_geom,
//   gs (knots), track (true track °), t (type code), desc, r (reg)
function parseState(ac) {
  if (!ac || ac.lat == null || ac.lon == null) return null;

  const altFt = typeof ac.alt_baro === 'number' ? ac.alt_baro
              : typeof ac.alt_geom === 'number' ? ac.alt_geom : null;
  if (altFt === null || altFt < MIN_ALT_FT) return null;

  const cs      = ((ac.flight ?? ac.hex ?? '').trim().replace(/\s+/g, '')) || ac.hex;
  const airline = lookupAirline(cs) ?? 'Unknown';

  return {
    id:           ac.hex,
    callsign:     cs,
    flightNumber: cs,
    airline,
    aircraft:     ac.desc ?? ac.t ?? 'Unknown',
    lat:          ac.lat,
    lng:          ac.lon,
    altitude:     Math.round(altFt),
    speed:        ac.gs != null ? Math.round(ac.gs) : 0,
    heading:      ac.track ?? ac.true_heading ?? 0,
    isLive:       true,
    origin:      { code: '----', name: 'Live Aircraft', city: '', country: '', lat: 0, lng: 0 },
    destination: { code: '----', name: 'En Route',      city: '', country: '', lat: 0, lng: 0 },
    progress:    0.5,
    routeDistance: 1000,
    routePoints: [],
    trail:       [],
  };
}

// ── OpenSkyService ────────────────────────────────────────
// (name kept for compatibility — now backed by airplanes.live)
class OpenSkyService {
  constructor() {
    this._cache     = null;
    this._lastFetch = 0;
    this._inflight  = null;
    this.available  = null;     // null=unknown, true=ok, false=failed
    this._bbox      = null;     // { lamin, lomin, lamax, lomax }
    this._failCount = 0;
  }

  /**
   * Called by MapView's BoundsSync whenever the viewport changes.
   * Adds a 25 % margin so aircraft near the edge stay visible.
   * On first call, triggers an immediate fetch so the map populates
   * without waiting for the 15-second interval.
   */
  setBounds(raw) {
    const latSpan = raw.lamax - raw.lamin;
    const lonSpan = raw.lomax - raw.lomin;
    const pad     = 0.25;
    const isFirst = !this._bbox;

    this._bbox = {
      lamin: Math.max(-90,  raw.lamin - latSpan * pad),
      lomin: Math.max(-180, raw.lomin - lonSpan * pad),
      lamax: Math.min(90,   raw.lamax + latSpan * pad),
      lomax: Math.min(180,  raw.lomax + lonSpan * pad),
    };

    if (isFirst) {
      // Reset the poll timer so fetchOnce() fires immediately
      this._lastFetch = 0;
      this.fetchOnce().catch(() => {});
    }
  }

  /** Returns cached data if fresh enough, otherwise fetches. Never throws. */
  async fetchOnce() {
    if (!this._bbox) return this._cache;   // bounds not yet available
    const now = Date.now();
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
      const { lamin, lomin, lamax, lomax } = this._bbox;

      // Convert bbox → center + radius (nm) for the airplanes.live endpoint
      const centerLat    = (lamin + lamax) / 2;
      const centerLon    = (lomin + lomax) / 2;
      const latRadiusNm  = (lamax - lamin) / 2 * 60;
      const lonRadiusNm  = (lomax - lomin) / 2 * 60 * Math.cos(centerLat * Math.PI / 180);
      const radiusNm     = Math.min(
        Math.ceil(Math.max(latRadiusNm, lonRadiusNm)),
        MAX_RADIUS_NM
      );

      const url = `${BASE_URL}/${centerLat.toFixed(4)}/${centerLon.toFixed(4)}/${radiusNm}`;

      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);

      const res = await fetch(url, {
        signal:  ctrl.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timer);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json    = await res.json();
      const raw     = json.ac ?? [];
      const flights = raw
        .map(parseState)
        .filter(Boolean)
        .slice(0, MAX_AIRCRAFT);

      this._cache     = flights;
      this._failCount = 0;
      this.available  = true;
      console.info(`[AirplanesLive] ${flights.length} aircraft (r=${radiusNm} nm)`);
      return flights;
    } catch (err) {
      if (err.name !== 'AbortError') {
        this._failCount++;
        console.warn(`[AirplanesLive] fetch failed (attempt ${this._failCount}):`, err.message);
      }
      this.available = false;
      return this._cache ?? null;
    }
  }
}

export const openSkyService = new OpenSkyService();
