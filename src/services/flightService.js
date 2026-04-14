// ─────────────────────────────────────────────────────────
//  FlightService — dual-mode: live (OpenSky) + simulation
//  Live mode: fetches OpenSky every 15 s, dead-reckons between.
//  Sim  mode: great-circle interpolation (always-on fallback).
// ─────────────────────────────────────────────────────────

import { openSkyService } from './openSkyService.js';

const TIME_MULTIPLIER = 180; // sim: 1 real second = 3 sim-minutes
const OPENSKY_POLL_MS = 15_000;

// ── Airports ──────────────────────────────────────────────
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
};

const ROUTE_DEFS = [
  { o: 'JFK', d: 'LHR', cs: 'BA178',  al: 'British Airways',      ac: 'Boeing 777',   spd: 905 },
  { o: 'LHR', d: 'JFK', cs: 'AA100',  al: 'American Airlines',    ac: 'Boeing 787',   spd: 890 },
  { o: 'LAX', d: 'LHR', cs: 'VS22',   al: 'Virgin Atlantic',       ac: 'Airbus A350',  spd: 915 },
  { o: 'JFK', d: 'CDG', cs: 'AF007',  al: 'Air France',            ac: 'Boeing 777',   spd: 900 },
  { o: 'ORD', d: 'LHR', cs: 'UA901',  al: 'United Airlines',       ac: 'Boeing 767',   spd: 880 },
  { o: 'LHR', d: 'ORD', cs: 'AA93',   al: 'American Airlines',     ac: 'Boeing 787',   spd: 895 },
  { o: 'JFK', d: 'FRA', cs: 'LH400',  al: 'Lufthansa',             ac: 'Airbus A340',  spd: 890 },
  { o: 'MIA', d: 'MAD', cs: 'IB6123', al: 'Iberia',                ac: 'Airbus A330',  spd: 875 },
  { o: 'BOS', d: 'DUB', cs: 'EI105',  al: 'Aer Lingus',            ac: 'Airbus A321',  spd: 840 },
  { o: 'YYZ', d: 'LHR', cs: 'AC848',  al: 'Air Canada',            ac: 'Boeing 787',   spd: 895 },
  { o: 'ATL', d: 'CDG', cs: 'DL402',  al: 'Delta Air Lines',       ac: 'Airbus A350',  spd: 910 },
  { o: 'LHR', d: 'AMS', cs: 'KL1010', al: 'KLM',                   ac: 'Boeing 737',   spd: 820 },
  { o: 'CDG', d: 'FCO', cs: 'AZ310',  al: 'ITA Airways',           ac: 'Airbus A320',  spd: 810 },
  { o: 'FRA', d: 'BCN', cs: 'LH1810', al: 'Lufthansa',             ac: 'Airbus A319',  spd: 815 },
  { o: 'ZRH', d: 'LHR', cs: 'LX326',  al: 'Swiss Air Lines',       ac: 'Airbus A320',  spd: 820 },
  { o: 'MUC', d: 'CDG', cs: 'LH2230', al: 'Lufthansa',             ac: 'Airbus A320',  spd: 815 },
  { o: 'LHR', d: 'SIN', cs: 'SQ322',  al: 'Singapore Airlines',   ac: 'Airbus A380',  spd: 920 },
  { o: 'LHR', d: 'HKG', cs: 'CX250',  al: 'Cathay Pacific',        ac: 'Boeing 777',   spd: 910 },
  { o: 'CDG', d: 'BKK', cs: 'TG930',  al: 'Thai Airways',          ac: 'Airbus A380',  spd: 905 },
  { o: 'FRA', d: 'NRT', cs: 'LH714',  al: 'Lufthansa',             ac: 'Boeing 747',   spd: 915 },
  { o: 'AMS', d: 'PVG', cs: 'KL895',  al: 'KLM',                   ac: 'Boeing 777',   spd: 905 },
  { o: 'MUC', d: 'PEK', cs: 'LH724',  al: 'Lufthansa',             ac: 'Airbus A340',  spd: 900 },
  { o: 'LHR', d: 'DXB', cs: 'EK003',  al: 'Emirates',              ac: 'Airbus A380',  spd: 920 },
  { o: 'DXB', d: 'LHR', cs: 'EK004',  al: 'Emirates',              ac: 'Airbus A380',  spd: 915 },
  { o: 'JFK', d: 'DXB', cs: 'EK201',  al: 'Emirates',              ac: 'Airbus A380',  spd: 920 },
  { o: 'DXB', d: 'SIN', cs: 'EK357',  al: 'Emirates',              ac: 'Boeing 777',   spd: 910 },
  { o: 'CDG', d: 'DOH', cs: 'QR038',  al: 'Qatar Airways',         ac: 'Airbus A350',  spd: 910 },
  { o: 'LHR', d: 'DOH', cs: 'QR001',  al: 'Qatar Airways',         ac: 'Boeing 787',   spd: 905 },
  { o: 'NRT', d: 'HKG', cs: 'JL701',  al: 'Japan Airlines',        ac: 'Boeing 737',   spd: 840 },
  { o: 'SIN', d: 'SYD', cs: 'SQ211',  al: 'Singapore Airlines',   ac: 'Airbus A380',  spd: 900 },
  { o: 'HKG', d: 'SYD', cs: 'CX101',  al: 'Cathay Pacific',        ac: 'Boeing 777',   spd: 905 },
  { o: 'ICN', d: 'SIN', cs: 'SQ601',  al: 'Singapore Airlines',   ac: 'Airbus A330',  spd: 885 },
  { o: 'BKK', d: 'MEL', cs: 'TG475',  al: 'Thai Airways',          ac: 'Boeing 777',   spd: 895 },
  { o: 'SYD', d: 'AKL', cs: 'QF109',  al: 'Qantas',                ac: 'Boeing 737',   spd: 845 },
  { o: 'KUL', d: 'NRT', cs: 'MH88',   al: 'Malaysia Airlines',     ac: 'Airbus A350',  spd: 895 },
  { o: 'LAX', d: 'NRT', cs: 'UA837',  al: 'United Airlines',       ac: 'Boeing 777',   spd: 920 },
  { o: 'NRT', d: 'LAX', cs: 'NH106',  al: 'ANA',                   ac: 'Boeing 777',   spd: 910 },
  { o: 'SFO', d: 'HKG', cs: 'UA863',  al: 'United Airlines',       ac: 'Boeing 787',   spd: 915 },
  { o: 'LAX', d: 'SYD', cs: 'QF11',   al: 'Qantas',                ac: 'Airbus A380',  spd: 920 },
  { o: 'SYD', d: 'LAX', cs: 'QF12',   al: 'Qantas',                ac: 'Airbus A380',  spd: 910 },
  { o: 'YVR', d: 'NRT', cs: 'AC001',  al: 'Air Canada',            ac: 'Boeing 787',   spd: 905 },
  { o: 'LAX', d: 'JFK', cs: 'AA102',  al: 'American Airlines',     ac: 'Boeing 737',   spd: 860 },
  { o: 'JFK', d: 'LAX', cs: 'DL1',    al: 'Delta Air Lines',       ac: 'Boeing 757',   spd: 855 },
  { o: 'ORD', d: 'LAX', cs: 'UA200',  al: 'United Airlines',       ac: 'Boeing 737',   spd: 850 },
  { o: 'JFK', d: 'ORD', cs: 'UA678',  al: 'United Airlines',       ac: 'Airbus A320',  spd: 840 },
  { o: 'LAX', d: 'SEA', cs: 'AS300',  al: 'Alaska Airlines',       ac: 'Boeing 737',   spd: 830 },
  { o: 'ATL', d: 'DFW', cs: 'AA1234', al: 'American Airlines',     ac: 'Airbus A319',  spd: 830 },
  { o: 'SFO', d: 'ORD', cs: 'UA400',  al: 'United Airlines',       ac: 'Boeing 737',   spd: 855 },
  { o: 'YYZ', d: 'JFK', cs: 'AC720',  al: 'Air Canada',            ac: 'Embraer E190', spd: 820 },
  { o: 'MEX', d: 'MIA', cs: 'AM400',  al: 'Aeromexico',            ac: 'Boeing 737',   spd: 835 },
  { o: 'DFW', d: 'JFK', cs: 'AA2001', al: 'American Airlines',     ac: 'Boeing 737',   spd: 845 },
  { o: 'GRU', d: 'JFK', cs: 'AA261',  al: 'American Airlines',     ac: 'Boeing 777',   spd: 895 },
  { o: 'GRU', d: 'LHR', cs: 'BA247',  al: 'British Airways',       ac: 'Boeing 777',   spd: 905 },
  { o: 'EZE', d: 'MAD', cs: 'IB6846', al: 'Iberia',                ac: 'Airbus A340',  spd: 890 },
  { o: 'BOG', d: 'MIA', cs: 'AV042',  al: 'Avianca',               ac: 'Airbus A320',  spd: 840 },
  { o: 'SCL', d: 'JFK', cs: 'LA600',  al: 'LATAM Airlines',        ac: 'Boeing 787',   spd: 895 },
  { o: 'JNB', d: 'LHR', cs: 'SA234',  al: 'South African Airways', ac: 'Airbus A340',  spd: 895 },
  { o: 'NBO', d: 'LHR', cs: 'KQ100',  al: 'Kenya Airways',         ac: 'Boeing 787',   spd: 880 },
  { o: 'CAI', d: 'LHR', cs: 'MS779',  al: 'EgyptAir',              ac: 'Boeing 777',   spd: 875 },
  { o: 'JNB', d: 'DXB', cs: 'EK762',  al: 'Emirates',              ac: 'Boeing 777',   spd: 900 },
  { o: 'DEL', d: 'LHR', cs: 'AI111',  al: 'Air India',             ac: 'Boeing 787',   spd: 895 },
  { o: 'BOM', d: 'DXB', cs: 'EK503',  al: 'Emirates',              ac: 'Airbus A380',  spd: 865 },
  { o: 'DEL', d: 'SIN', cs: 'SQ407',  al: 'Singapore Airlines',   ac: 'Airbus A330',  spd: 880 },
];

// ── Math helpers ──────────────────────────────────────────
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * D2R;
  const dLng = (lng2 - lng1) * D2R;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

function interpolateGreatCircle(lat1, lng1, lat2, lng2, t) {
  const φ1 = lat1 * D2R, λ1 = lng1 * D2R;
  const φ2 = lat2 * D2R, λ2 = lng2 * D2R;
  const x1 = Math.cos(φ1) * Math.cos(λ1), y1 = Math.cos(φ1) * Math.sin(λ1), z1 = Math.sin(φ1);
  const x2 = Math.cos(φ2) * Math.cos(λ2), y2 = Math.cos(φ2) * Math.sin(λ2), z2 = Math.sin(φ2);
  const dot = Math.max(-1, Math.min(1, x1 * x2 + y1 * y2 + z1 * z2));
  const θ = Math.acos(dot);
  if (Math.abs(θ) < 1e-10) return { lat: lat1, lng: lng1 };
  const s = Math.sin(θ);
  const a = Math.sin((1 - t) * θ) / s, b = Math.sin(t * θ) / s;
  return {
    lat: Math.atan2(a * z1 + b * z2, Math.sqrt((a * x1 + b * x2) ** 2 + (a * y1 + b * y2) ** 2)) * R2D,
    lng: Math.atan2(a * y1 + b * y2, a * x1 + b * x2) * R2D,
  };
}

function bearing(lat1, lng1, lat2, lng2) {
  const φ1 = lat1 * D2R, φ2 = lat2 * D2R, dλ = (lng2 - lng1) * D2R;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return ((Math.atan2(y, x) * R2D) + 360) % 360;
}

function buildRoutePoints(lat1, lng1, lat2, lng2, steps = 80) {
  const pts = [];
  for (let i = 0; i <= steps; i++) pts.push(interpolateGreatCircle(lat1, lng1, lat2, lng2, i / steps));
  return pts;
}

// ── Simulation flight factory ─────────────────────────────
function generateSimFlights() {
  return ROUTE_DEFS.map((r) => {
    const origin = AIRPORTS[r.o], dest = AIRPORTS[r.d];
    if (!origin || !dest) return null;
    const distance = haversineKm(origin.lat, origin.lng, dest.lat, dest.lng);
    const progress = Math.random();
    const routePoints = buildRoutePoints(origin.lat, origin.lng, dest.lat, dest.lng);
    const pos  = interpolateGreatCircle(origin.lat, origin.lng, dest.lat, dest.lng, progress);
    const posN = interpolateGreatCircle(origin.lat, origin.lng, dest.lat, dest.lng, Math.min(progress + 0.005, 1));
    return {
      id: r.cs, callsign: r.cs,
      flightNumber: r.cs.replace(/(\D+)(\d+)/, '$1 $2'),
      airline: r.al, aircraft: r.ac,
      origin, destination: dest,
      progress, routeDistance: distance, routePoints,
      lat: pos.lat, lng: pos.lng,
      heading: bearing(pos.lat, pos.lng, posN.lat, posN.lng),
      altitude: 28000 + Math.round(Math.random() * 14000 / 1000) * 1000,
      speed: r.spd + Math.round((Math.random() - 0.5) * 40),
      trail: [{ lat: pos.lat, lng: pos.lng }],
      isLive: false,
    };
  }).filter(Boolean);
}

// ── FlightService ─────────────────────────────────────────
class FlightService {
  constructor() {
    this.flights     = generateSimFlights();
    this.dataSource  = 'sim';          // 'sim' | 'live'
    this._listeners  = new Set();
    this._rafId      = null;
    this._lastTime   = null;
    this._oskyTimer  = null;           // OpenSky polling interval
    this._liveIds    = new Set();      // IDs currently from OpenSky
  }

  // ── Public API ────────────────────────────────────────
  start() {
    if (this._rafId) return;

    // Store tick on the instance so the visibility handler can restart it
    this._tick = (now) => {
      if (this._lastTime !== null) {
        const dt = Math.min((now - this._lastTime) / 1000, 0.1);
        this._update(dt);
      }
      this._lastTime = now;
      this._rafId = requestAnimationFrame(this._tick);
    };
    this._rafId = requestAnimationFrame(this._tick);

    // Start OpenSky polling in parallel (non-blocking)
    this._pollOpenSky();
    this._oskyTimer = setInterval(() => this._pollOpenSky(), OPENSKY_POLL_MS);

    // Pause RAF when the browser tab is hidden; resume when visible again.
    // Saves CPU / battery and prevents dt spikes when the user returns.
    this._visibilityHandler = () => {
      if (document.hidden) {
        if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
      } else if (!this._rafId && this._oskyTimer) {
        this._lastTime = null; // reset dt so first resume tick isn't huge
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
    this.flights.forEach((flight) => {
      if (flight.isLive) {
        this._deadReckon(flight, dt);
      } else {
        this._simUpdate(flight, dt);
      }
    });
    this._listeners.forEach((fn) => fn(this.flights));
  }

  /** Great-circle progress interpolation for simulated flights */
  _simUpdate(flight, dt) {
    const dProgress = (flight.speed / flight.routeDistance) * dt * TIME_MULTIPLIER / 3600;
    flight.progress = (flight.progress + dProgress) % 1;
    const t = flight.progress, tN = Math.min(t + 0.002, 1);
    const pos  = interpolateGreatCircle(flight.origin.lat, flight.origin.lng, flight.destination.lat, flight.destination.lng, t);
    const posN = interpolateGreatCircle(flight.origin.lat, flight.origin.lng, flight.destination.lat, flight.destination.lng, tN);
    flight.lat     = pos.lat;
    flight.lng     = pos.lng;
    flight.heading = bearing(pos.lat, pos.lng, posN.lat, posN.lng);
    const last = flight.trail[flight.trail.length - 1];
    if (!last || haversineKm(last.lat, last.lng, pos.lat, pos.lng) > 80) {
      flight.trail.push({ lat: pos.lat, lng: pos.lng });
      if (flight.trail.length > 30) flight.trail.shift();
    }
    flight.altitude += Math.round((Math.random() - 0.5) * 20);
    flight.altitude  = Math.max(28000, Math.min(45000, flight.altitude));
  }

  /** Dead-reckoning for live OpenSky flights between API updates */
  _deadReckon(flight, dt) {
    const speedKph = flight.speed * 1.852;        // knots → km/h
    const hdgRad   = flight.heading * D2R;
    const dLat     = (speedKph / 111.32) * dt / 3600;
    const dLng     = (speedKph / (111.32 * Math.cos(flight.lat * D2R))) * dt / 3600;
    flight.lat    += dLat * Math.cos(hdgRad);
    flight.lng    += dLng * Math.sin(hdgRad);
    flight.lat     = Math.max(-85, Math.min(85, flight.lat));
    // Trail
    const last = flight.trail[flight.trail.length - 1];
    if (!last || haversineKm(last.lat, last.lng, flight.lat, flight.lng) > 30) {
      flight.trail.push({ lat: flight.lat, lng: flight.lng });
      if (flight.trail.length > 20) flight.trail.shift();
    }
  }

  // ── OpenSky integration ───────────────────────────────
  async _pollOpenSky() {
    try {
      const data = await openSkyService.fetchOnce();
      if (data && data.length > 0) {
        this._mergeOpenSkyData(data);
      }
    } catch { /* silently fall back */ }
  }

  /**
   * Merge OpenSky data into this.flights:
   * - Update positions of existing live flights
   * - Add newly seen live flights
   * - Remove live flights no longer in the feed
   * - Sim flights are always preserved
   */
  _mergeOpenSkyData(incoming) {
    const incomingMap = new Map(incoming.map((f) => [f.id, f]));
    const updatedIds  = new Set();

    // Update existing live flights in-place (preserves trail)
    this.flights = this.flights.map((f) => {
      if (!f.isLive) return f;             // keep sim flights untouched
      const fresh = incomingMap.get(f.id);
      if (!fresh) return null;             // aircraft left the feed — remove
      updatedIds.add(f.id);
      return {
        ...f,
        lat:      fresh.lat,
        lng:      fresh.lng,
        heading:  fresh.heading,
        speed:    fresh.speed,
        altitude: fresh.altitude,
      };
    }).filter(Boolean);

    // Add brand-new live aircraft not already tracked
    incoming.forEach((f) => {
      if (!updatedIds.has(f.id) && !this.flights.some((e) => e.id === f.id)) {
        this.flights.push({ ...f, trail: [{ lat: f.lat, lng: f.lng }] });
      }
    });

    this._liveIds  = new Set(incoming.map((f) => f.id));
    this.dataSource = 'live';
  }
}

export const flightService = new FlightService();

// ── Formatting helpers (unchanged) ────────────────────────
export function formatETA(flight) {
  if (flight.isLive) return 'Live';
  const remaining = (1 - flight.progress) * flight.routeDistance;
  const hours = remaining / flight.speed;
  const totalMin = Math.round(hours * 60);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
export function formatAltitude(ft) { return ft.toLocaleString() + ' ft'; }
export function formatSpeed(kts)   { return kts + ' kts'; }
