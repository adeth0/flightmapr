// ─────────────────────────────────────────────────────────
//  FlightService — live-only mode via OpenSky Network
//  Dead-reckons aircraft positions between 15-second API polls.
//  No simulation fallback — if API is unavailable, dataSource
//  is set to 'unavailable' and an empty/stale list is held.
// ─────────────────────────────────────────────────────────

import { openSkyService }  from './openSkyService.js';
import { enrichFlight }    from './flightEnrichmentService.js';

const OPENSKY_POLL_MS = 15_000;

// ── Airports (used by AirportLayer) ──────────────────────
export const AIRPORTS = {
  JFK: { code: 'JFK', name: 'John F. Kennedy Intl',      city: 'New York',      country: 'US', lat: 40.6413,  lng: -73.7781  },
  LAX: { code: 'LAX', name: 'Los Angeles Intl',           city: 'Los Angeles',   country: 'US', lat: 33.9425,  lng: -118.4081 },
  ORD: { code: 'ORD', name: "O'Hare Intl",                city: 'Chicago',       country: 'US', lat: 41.9742,  lng: -87.9073  },
  DFW: { code: 'DFW', name: 'Dallas/Fort Worth Intl',     city: 'Dallas',        country: 'US', lat: 32.8998,  lng: -97.0403  },
  MIA: { code: 'MIA', name: 'Miami Intl',                  city: 'Miami',         country: 'US', lat: 25.7959,  lng: -80.2870  },
  SFO: { code: 'SFO', name: 'San Francisco Intl',          city: 'San Francisco', country: 'US', lat: 37.6213,  lng: -122.3790 },
  BOS: { code: 'BOS', name: 'Logan Intl',                  city: 'Boston',        country: 'US', lat: 42.3656,  lng: -71.0096  },
  ATL: { code: 'ATL', name: 'Hartsfield-Jackson Intl',    city: 'Atlanta',       country: 'US', lat: 33.6407,  lng: -84.4277  },
  SEA: { code: 'SEA', name: 'Seattle-Tacoma Intl',         city: 'Seattle',       country: 'US', lat: 47.4502,  lng: -122.3088 },
  DEN: { code: 'DEN', name: 'Denver Intl',                 city: 'Denver',        country: 'US', lat: 39.8561,  lng: -104.6737 },
  YYZ: { code: 'YYZ', name: 'Toronto Pearson Intl',        city: 'Toronto',       country: 'CA', lat: 43.6772,  lng: -79.6306  },
  YVR: { code: 'YVR', name: 'Vancouver Intl',              city: 'Vancouver',     country: 'CA', lat: 49.1967,  lng: -123.1815 },
  MEX: { code: 'MEX', name: 'Mexico City Intl',            city: 'Mexico City',   country: 'MX', lat: 19.4363,  lng: -99.0721  },
  GRU: { code: 'GRU', name: 'São Paulo-Guarulhos Intl',   city: 'São Paulo',     country: 'BR', lat: -23.4356, lng: -46.4731  },
  EZE: { code: 'EZE', name: 'Ministro Pistarini Intl',    city: 'Buenos Aires',  country: 'AR', lat: -34.8222, lng: -58.5358  },
  BOG: { code: 'BOG', name: 'El Dorado Intl',              city: 'Bogotá',        country: 'CO', lat: 4.7016,   lng: -74.1469  },
  SCL: { code: 'SCL', name: 'Arturo Merino Benítez',      city: 'Santiago',      country: 'CL', lat: -33.3929, lng: -70.7858  },
  LHR: { code: 'LHR', name: 'Heathrow',                    city: 'London',        country: 'GB', lat: 51.4700,  lng: -0.4543   },
  CDG: { code: 'CDG', name: 'Charles de Gaulle',           city: 'Paris',         country: 'FR', lat: 49.0097,  lng: 2.5479    },
  FRA: { code: 'FRA', name: 'Frankfurt Airport',           city: 'Frankfurt',     country: 'DE', lat: 50.0379,  lng: 8.5622    },
  AMS: { code: 'AMS', name: 'Amsterdam Schiphol',          city: 'Amsterdam',     country: 'NL', lat: 52.3105,  lng: 4.7683    },
  MAD: { code: 'MAD', name: 'Adolfo Suárez Barajas',      city: 'Madrid',        country: 'ES', lat: 40.4719,  lng: -3.5626   },
  FCO: { code: 'FCO', name: 'Leonardo da Vinci',           city: 'Rome',          country: 'IT', lat: 41.7999,  lng: 12.2462   },
  ZRH: { code: 'ZRH', name: 'Zurich Airport',              city: 'Zurich',        country: 'CH', lat: 47.4647,  lng: 8.5492    },
  DUB: { code: 'DUB', name: 'Dublin Airport',              city: 'Dublin',        country: 'IE', lat: 53.4213,  lng: -6.2700   },
  MUC: { code: 'MUC', name: 'Munich Airport',              city: 'Munich',        country: 'DE', lat: 48.3538,  lng: 11.7861   },
  BCN: { code: 'BCN', name: 'Barcelona El Prat',           city: 'Barcelona',     country: 'ES', lat: 41.2974,  lng: 2.0833    },
  DXB: { code: 'DXB', name: 'Dubai Intl',                  city: 'Dubai',         country: 'AE', lat: 25.2532,  lng: 55.3657   },
  DOH: { code: 'DOH', name: 'Hamad Intl',                  city: 'Doha',          country: 'QA', lat: 25.2731,  lng: 51.6080   },
  CAI: { code: 'CAI', name: 'Cairo Intl',                  city: 'Cairo',         country: 'EG', lat: 30.1219,  lng: 31.4056   },
  NBO: { code: 'NBO', name: 'Jomo Kenyatta Intl',          city: 'Nairobi',       country: 'KE', lat: -1.3192,  lng: 36.9275   },
  JNB: { code: 'JNB', name: 'O.R. Tambo Intl',             city: 'Johannesburg',  country: 'ZA', lat: -26.1392, lng: 28.2460   },
  NRT: { code: 'NRT', name: 'Narita Intl',                 city: 'Tokyo',         country: 'JP', lat: 35.7647,  lng: 140.3864  },
  ICN: { code: 'ICN', name: 'Incheon Intl',                city: 'Seoul',         country: 'KR', lat: 37.4691,  lng: 126.4510  },
  PEK: { code: 'PEK', name: 'Beijing Capital Intl',        city: 'Beijing',       country: 'CN', lat: 40.0799,  lng: 116.6031  },
  PVG: { code: 'PVG', name: 'Shanghai Pudong Intl',        city: 'Shanghai',      country: 'CN', lat: 31.1434,  lng: 121.8052  },
  HKG: { code: 'HKG', name: 'Hong Kong Intl',              city: 'Hong Kong',     country: 'HK', lat: 22.3080,  lng: 113.9185  },
  SIN: { code: 'SIN', name: 'Singapore Changi',            city: 'Singapore',     country: 'SG', lat: 1.3644,   lng: 103.9915  },
  BKK: { code: 'BKK', name: 'Suvarnabhumi Airport',        city: 'Bangkok',       country: 'TH', lat: 13.6900,  lng: 100.7501  },
  KUL: { code: 'KUL', name: 'Kuala Lumpur Intl',           city: 'Kuala Lumpur',  country: 'MY', lat: 2.7456,   lng: 101.7099  },
  SYD: { code: 'SYD', name: 'Sydney Kingsford Smith',      city: 'Sydney',        country: 'AU', lat: -33.9461, lng: 151.1772  },
  MEL: { code: 'MEL', name: 'Melbourne Airport',           city: 'Melbourne',     country: 'AU', lat: -37.6690, lng: 144.8410  },
  AKL: { code: 'AKL', name: 'Auckland Airport',            city: 'Auckland',      country: 'NZ', lat: -37.0082, lng: 174.7850  },
  DEL: { code: 'DEL', name: 'Indira Gandhi Intl',          city: 'New Delhi',     country: 'IN', lat: 28.5562,  lng: 77.1000   },
  BOM: { code: 'BOM', name: 'Chhatrapati Shivaji Intl',   city: 'Mumbai',        country: 'IN', lat: 19.0896,  lng: 72.8656   },
  // ── UK airports (required for regional visibility) ───────
  MAN: { code: 'MAN', name: 'Manchester Airport',             city: 'Manchester',  country: 'GB', lat: 53.3537,  lng: -2.2750   },
  LGW: { code: 'LGW', name: 'London Gatwick Airport',         city: 'London',      country: 'GB', lat: 51.1537,  lng: -0.1821   },
  STN: { code: 'STN', name: 'London Stansted Airport',        city: 'London',      country: 'GB', lat: 51.8850,  lng:  0.2350   },
  LTN: { code: 'LTN', name: 'London Luton Airport',           city: 'London',      country: 'GB', lat: 51.8747,  lng: -0.3683   },
  LCY: { code: 'LCY', name: 'London City Airport',            city: 'London',      country: 'GB', lat: 51.5053,  lng:  0.0553   },
  BHX: { code: 'BHX', name: 'Birmingham Airport',             city: 'Birmingham',  country: 'GB', lat: 52.4539,  lng: -1.7480   },
  EDI: { code: 'EDI', name: 'Edinburgh Airport',              city: 'Edinburgh',   country: 'GB', lat: 55.9508,  lng: -3.3725   },
  GLA: { code: 'GLA', name: 'Glasgow Airport',                city: 'Glasgow',     country: 'GB', lat: 55.8719,  lng: -4.4331   },
  LBA: { code: 'LBA', name: 'Leeds Bradford Airport',         city: 'Leeds',       country: 'GB', lat: 53.8659,  lng: -1.6606   },
  LPL: { code: 'LPL', name: 'Liverpool John Lennon Airport',  city: 'Liverpool',   country: 'GB', lat: 53.3336,  lng: -2.8497   },
  BRS: { code: 'BRS', name: 'Bristol Airport',                city: 'Bristol',     country: 'GB', lat: 51.3827,  lng: -2.7190   },
  NCL: { code: 'NCL', name: 'Newcastle Airport',              city: 'Newcastle',   country: 'GB', lat: 55.0375,  lng: -1.6917   },
  // ── Additional European hubs ─────────────────────────────
  VIE: { code: 'VIE', name: 'Vienna Intl Airport',            city: 'Vienna',      country: 'AT', lat: 48.1103,  lng: 16.5697   },
  CPH: { code: 'CPH', name: 'Copenhagen Airport',             city: 'Copenhagen',  country: 'DK', lat: 55.6180,  lng: 12.6508   },
  OSL: { code: 'OSL', name: 'Oslo Gardermoen Airport',        city: 'Oslo',        country: 'NO', lat: 60.1975,  lng: 11.1004   },
  ARN: { code: 'ARN', name: 'Stockholm Arlanda Airport',      city: 'Stockholm',   country: 'SE', lat: 59.6519,  lng: 17.9186   },
  HEL: { code: 'HEL', name: 'Helsinki Vantaa Airport',        city: 'Helsinki',    country: 'FI', lat: 60.3172,  lng: 24.9633   },
  LIS: { code: 'LIS', name: 'Humberto Delgado Airport',       city: 'Lisbon',      country: 'PT', lat: 38.7756,  lng: -9.1354   },
  ATH: { code: 'ATH', name: 'Athens Intl Airport',            city: 'Athens',      country: 'GR', lat: 37.9364,  lng: 23.9445   },
  WAW: { code: 'WAW', name: 'Warsaw Chopin Airport',          city: 'Warsaw',      country: 'PL', lat: 52.1657,  lng: 20.9671   },
  PRG: { code: 'PRG', name: 'Václav Havel Airport',           city: 'Prague',      country: 'CZ', lat: 50.1008,  lng: 14.2600   },
  BUD: { code: 'BUD', name: 'Budapest Ferenc Liszt Intl',     city: 'Budapest',    country: 'HU', lat: 47.4298,  lng: 19.2611   },
};

// ── Math helpers (dead-reckoning only) ───────────────────
const D2R = Math.PI / 180;

function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * D2R;
  const dLng = (lng2 - lng1) * D2R;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

// ── FlightService ─────────────────────────────────────────
class FlightService {
  constructor() {
    this.flights      = [];           // starts empty — populated by OpenSky
    this.dataSource   = 'loading';    // 'loading' | 'live' | 'unavailable'
    this._listeners   = new Set();
    this._rafId       = null;
    this._lastTime    = null;
    this._oskyTimer   = null;
    this._enrichedIds = new Set();    // tracks flights already background-enriched
  }

  // ── Public API ────────────────────────────────────────
  start() {
    if (this._rafId) return;

    this._tick = (now) => {
      if (this._lastTime !== null) {
        const dt = Math.min((now - this._lastTime) / 1000, 0.1);
        this._update(dt);
      }
      this._lastTime = now;
      this._rafId = requestAnimationFrame(this._tick);
    };
    this._rafId = requestAnimationFrame(this._tick);

    // Immediate poll, then every 15 s
    this._pollOpenSky();
    this._oskyTimer = setInterval(() => this._pollOpenSky(), OPENSKY_POLL_MS);

    // Pause RAF when tab is hidden to save CPU/battery
    this._visibilityHandler = () => {
      if (document.hidden) {
        if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
      } else if (!this._rafId && this._oskyTimer) {
        this._lastTime = null;
        this._rafId = requestAnimationFrame(this._tick);
      }
    };
    document.addEventListener('visibilitychange', this._visibilityHandler);
  }

  stop() {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    if (this._oskyTimer) { clearInterval(this._oskyTimer); this._oskyTimer = null; }
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  getFlight(id) { return this.flights.find((f) => f.id === id) ?? null; }

  search(query) {
    if (!query?.trim()) return [];
    const q = query.trim().toLowerCase();
    return this.flights.filter((f) =>
      f.callsign.toLowerCase().includes(q) ||
      f.airline.toLowerCase().includes(q) ||
      f.origin.code.toLowerCase().includes(q) ||
      f.origin.city.toLowerCase().includes(q) ||
      f.destination.code.toLowerCase().includes(q) ||
      f.destination.city.toLowerCase().includes(q)
    ).slice(0, 8);
  }

  // ── Animation tick ────────────────────────────────────
  _update(dt) {
    // Dead-reckon all live flights between API updates
    this.flights.forEach((flight) => this._deadReckon(flight, dt));
    this._listeners.forEach((fn) => fn(this.flights));
  }

  /** Dead-reckoning: advance position using last known heading + speed */
  _deadReckon(flight, dt) {
    const speedKph = flight.speed * 1.852;        // knots → km/h
    const hdgRad   = flight.heading * D2R;
    const dLat     = (speedKph / 111.32) * dt / 3600;
    const dLng     = (speedKph / (111.32 * Math.cos(flight.lat * D2R))) * dt / 3600;
    flight.lat    += dLat * Math.cos(hdgRad);
    flight.lng    += dLng * Math.sin(hdgRad);
    flight.lat     = Math.max(-85, Math.min(85, flight.lat));
    // Trail — append a point when the aircraft has moved ≥ 30 km since last point
    const last = flight.trail[flight.trail.length - 1];
    if (!last || haversineKm(last.lat, last.lng, flight.lat, flight.lng) > 30) {
      flight.trail.push({ lat: flight.lat, lng: flight.lng });
      if (flight.trail.length > 20) flight.trail.shift();
    }
  }

  // ── OpenSky integration ───────────────────────────────
  async _pollOpenSky() {
    const data = await openSkyService.fetchOnce();
    if (data && data.length > 0) {
      this._mergeOpenSkyData(data);
    } else if (openSkyService.available === false && this.flights.length === 0) {
      // API genuinely failed (not just "bounds not set yet") with no stale cache
      this.dataSource = 'unavailable';
      this._listeners.forEach((fn) => fn(this.flights));
    }
    // If available === null bounds aren't ready yet — stay in 'loading' state
  }

  /**
   * Merge OpenSky data into this.flights:
   * - Update positions of existing live flights in-place (preserves trail)
   * - Add newly seen aircraft
   * - Remove aircraft that left the feed / viewport
   */
  _mergeOpenSkyData(incoming) {
    const incomingMap = new Map(incoming.map((f) => [f.id, f]));
    const updatedIds  = new Set();

    // Update existing flights in-place
    this.flights = this.flights.map((f) => {
      const fresh = incomingMap.get(f.id);
      if (!fresh) return null;   // aircraft left the feed — remove
      updatedIds.add(f.id);
      return {
        ...f,
        lat:          fresh.lat,
        lng:          fresh.lng,
        heading:      fresh.heading,
        speed:        fresh.speed,
        altitude:     fresh.altitude,
        squawk:       fresh.squawk,
        vertRate:     fresh.vertRate,
      };
    }).filter(Boolean);

    // Add brand-new aircraft not yet tracked
    incoming.forEach((f) => {
      if (!updatedIds.has(f.id) && !this.flights.some((e) => e.id === f.id)) {
        this.flights.push({ ...f, trail: [{ lat: f.lat, lng: f.lng }] });
      }
    });

    this.dataSource = 'live';

    // Silently enrich a batch of flights so the routes layer has data
    this._backgroundEnrich(this.flights);
  }

  /**
   * Enrich up to 6 un-enriched flights per poll cycle, spaced 600 ms apart
   * so we never flood adsbdb.com. Results land in enrichFlight's cache and
   * are picked up by BusyRoutesLayer / getCachedEnrichment().
   */
  _backgroundEnrich(flights) {
    const batch = flights
      .filter(f => f.callsign && !this._enrichedIds.has(f.id))
      .slice(0, 6);

    batch.forEach((f, i) => {
      setTimeout(async () => {
        try {
          await enrichFlight(f.callsign);
        } catch { /* ignore */ }
        this._enrichedIds.add(f.id);   // mark regardless of result to avoid retries
      }, i * 600);
    });
  }
}

export const flightService = new FlightService();

// ── Formatting helpers ────────────────────────────────────
export function formatETA(_flight) { return 'Live'; }
export function formatAltitude(ft) { return ft.toLocaleString() + ' ft'; }
export function formatSpeed(kts)   { return kts + ' kts'; }
