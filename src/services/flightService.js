// ─────────────────────────────────────────────────────────
//  FlightService — live-only mode via OpenSky Network
//  Dead-reckons aircraft positions between 15-second API polls.
//  No simulation fallback — if API is unavailable, dataSource
//  is set to 'unavailable' and an empty/stale list is held.
// ─────────────────────────────────────────────────────────

import { openSkyService }  from './openSkyService.js';
import { enrichFlight }    from './flightEnrichmentService.js';

const OPENSKY_POLL_MS = 15_000;

// ── Airports (used by AirportLayer + AirportSidebar) ─────
// Lightweight global dataset — major international + regional airports.
// Each entry carries: IATA code, ICAO code, name, city, country, lat/lng.
// `tier` is rendered as an importance hint: 1 = global hub (shown at low
// zoom / long-range), 2 = major hub, 3 = regional. This lets AirportLayer
// render only top-tier markers when the viewport is zoomed far out to
// keep the map smooth even with a much larger list than the UK-only set.
export const AIRPORTS = {
  // ── North America — hubs ─────────────────────────────────
  JFK: { code: 'JFK', icao: 'KJFK', name: 'John F. Kennedy Intl',      city: 'New York',      country: 'US', lat: 40.6413,  lng: -73.7781,  tier: 1 },
  LAX: { code: 'LAX', icao: 'KLAX', name: 'Los Angeles Intl',          city: 'Los Angeles',   country: 'US', lat: 33.9425,  lng: -118.4081, tier: 1 },
  ORD: { code: 'ORD', icao: 'KORD', name: "O'Hare Intl",                city: 'Chicago',       country: 'US', lat: 41.9742,  lng: -87.9073,  tier: 1 },
  DFW: { code: 'DFW', icao: 'KDFW', name: 'Dallas/Fort Worth Intl',    city: 'Dallas',        country: 'US', lat: 32.8998,  lng: -97.0403,  tier: 1 },
  MIA: { code: 'MIA', icao: 'KMIA', name: 'Miami Intl',                 city: 'Miami',         country: 'US', lat: 25.7959,  lng: -80.2870,  tier: 1 },
  SFO: { code: 'SFO', icao: 'KSFO', name: 'San Francisco Intl',        city: 'San Francisco', country: 'US', lat: 37.6213,  lng: -122.3790, tier: 1 },
  BOS: { code: 'BOS', icao: 'KBOS', name: 'Logan Intl',                 city: 'Boston',        country: 'US', lat: 42.3656,  lng: -71.0096,  tier: 2 },
  ATL: { code: 'ATL', icao: 'KATL', name: 'Hartsfield-Jackson Intl',   city: 'Atlanta',       country: 'US', lat: 33.6407,  lng: -84.4277,  tier: 1 },
  SEA: { code: 'SEA', icao: 'KSEA', name: 'Seattle-Tacoma Intl',       city: 'Seattle',       country: 'US', lat: 47.4502,  lng: -122.3088, tier: 1 },
  DEN: { code: 'DEN', icao: 'KDEN', name: 'Denver Intl',                city: 'Denver',        country: 'US', lat: 39.8561,  lng: -104.6737, tier: 1 },
  LAS: { code: 'LAS', icao: 'KLAS', name: 'Harry Reid Intl',           city: 'Las Vegas',     country: 'US', lat: 36.0840,  lng: -115.1537, tier: 2 },
  PHX: { code: 'PHX', icao: 'KPHX', name: 'Phoenix Sky Harbor Intl',   city: 'Phoenix',       country: 'US', lat: 33.4342,  lng: -112.0116, tier: 2 },
  IAH: { code: 'IAH', icao: 'KIAH', name: 'George Bush Intercontinental', city: 'Houston',    country: 'US', lat: 29.9902,  lng: -95.3368,  tier: 2 },
  EWR: { code: 'EWR', icao: 'KEWR', name: 'Newark Liberty Intl',        city: 'Newark',        country: 'US', lat: 40.6895,  lng: -74.1745,  tier: 2 },
  MSP: { code: 'MSP', icao: 'KMSP', name: 'Minneapolis-St Paul Intl',  city: 'Minneapolis',   country: 'US', lat: 44.8820,  lng: -93.2218,  tier: 2 },
  DTW: { code: 'DTW', icao: 'KDTW', name: 'Detroit Metropolitan',      city: 'Detroit',       country: 'US', lat: 42.2162,  lng: -83.3554,  tier: 2 },
  PHL: { code: 'PHL', icao: 'KPHL', name: 'Philadelphia Intl',         city: 'Philadelphia',  country: 'US', lat: 39.8729,  lng: -75.2437,  tier: 2 },
  CLT: { code: 'CLT', icao: 'KCLT', name: 'Charlotte Douglas Intl',    city: 'Charlotte',     country: 'US', lat: 35.2140,  lng: -80.9431,  tier: 2 },
  HNL: { code: 'HNL', icao: 'PHNL', name: 'Daniel K. Inouye Intl',     city: 'Honolulu',      country: 'US', lat: 21.3187,  lng: -157.9225, tier: 2 },
  ANC: { code: 'ANC', icao: 'PANC', name: 'Ted Stevens Anchorage Intl', city: 'Anchorage',    country: 'US', lat: 61.1742,  lng: -149.9962, tier: 3 },
  YYZ: { code: 'YYZ', icao: 'CYYZ', name: 'Toronto Pearson Intl',      city: 'Toronto',       country: 'CA', lat: 43.6772,  lng: -79.6306,  tier: 1 },
  YVR: { code: 'YVR', icao: 'CYVR', name: 'Vancouver Intl',             city: 'Vancouver',     country: 'CA', lat: 49.1967,  lng: -123.1815, tier: 2 },
  YUL: { code: 'YUL', icao: 'CYUL', name: 'Montréal-Trudeau Intl',     city: 'Montréal',      country: 'CA', lat: 45.4706,  lng: -73.7408,  tier: 2 },
  YYC: { code: 'YYC', icao: 'CYYC', name: 'Calgary Intl',               city: 'Calgary',       country: 'CA', lat: 51.1139,  lng: -114.0203, tier: 2 },
  MEX: { code: 'MEX', icao: 'MMMX', name: 'Mexico City Intl',           city: 'Mexico City',   country: 'MX', lat: 19.4363,  lng: -99.0721,  tier: 1 },
  CUN: { code: 'CUN', icao: 'MMUN', name: 'Cancún Intl',                city: 'Cancún',        country: 'MX', lat: 21.0365,  lng: -86.8771,  tier: 2 },

  // ── South America ────────────────────────────────────────
  GRU: { code: 'GRU', icao: 'SBGR', name: 'São Paulo-Guarulhos Intl',   city: 'São Paulo',     country: 'BR', lat: -23.4356, lng: -46.4731,  tier: 1 },
  GIG: { code: 'GIG', icao: 'SBGL', name: 'Rio de Janeiro-Galeão Intl', city: 'Rio de Janeiro', country: 'BR', lat: -22.8100, lng: -43.2506, tier: 2 },
  EZE: { code: 'EZE', icao: 'SAEZ', name: 'Ministro Pistarini Intl',    city: 'Buenos Aires',  country: 'AR', lat: -34.8222, lng: -58.5358,  tier: 1 },
  BOG: { code: 'BOG', icao: 'SKBO', name: 'El Dorado Intl',             city: 'Bogotá',        country: 'CO', lat: 4.7016,   lng: -74.1469,  tier: 2 },
  LIM: { code: 'LIM', icao: 'SPJC', name: 'Jorge Chávez Intl',          city: 'Lima',          country: 'PE', lat: -12.0219, lng: -77.1143,  tier: 2 },
  SCL: { code: 'SCL', icao: 'SCEL', name: 'Arturo Merino Benítez',      city: 'Santiago',      country: 'CL', lat: -33.3929, lng: -70.7858,  tier: 2 },
  PTY: { code: 'PTY', icao: 'MPTO', name: 'Tocumen Intl',               city: 'Panama City',   country: 'PA', lat: 9.0714,   lng: -79.3835,  tier: 2 },

  // ── Europe — major hubs ─────────────────────────────────
  LHR: { code: 'LHR', icao: 'EGLL', name: 'Heathrow',                   city: 'London',        country: 'GB', lat: 51.4700,  lng: -0.4543,   tier: 1 },
  CDG: { code: 'CDG', icao: 'LFPG', name: 'Charles de Gaulle',          city: 'Paris',         country: 'FR', lat: 49.0097,  lng: 2.5479,    tier: 1 },
  ORY: { code: 'ORY', icao: 'LFPO', name: 'Paris Orly',                 city: 'Paris',         country: 'FR', lat: 48.7233,  lng: 2.3794,    tier: 2 },
  FRA: { code: 'FRA', icao: 'EDDF', name: 'Frankfurt Airport',          city: 'Frankfurt',     country: 'DE', lat: 50.0379,  lng: 8.5622,    tier: 1 },
  AMS: { code: 'AMS', icao: 'EHAM', name: 'Amsterdam Schiphol',         city: 'Amsterdam',     country: 'NL', lat: 52.3105,  lng: 4.7683,    tier: 1 },
  MAD: { code: 'MAD', icao: 'LEMD', name: 'Adolfo Suárez Barajas',      city: 'Madrid',        country: 'ES', lat: 40.4719,  lng: -3.5626,   tier: 1 },
  FCO: { code: 'FCO', icao: 'LIRF', name: 'Leonardo da Vinci',          city: 'Rome',          country: 'IT', lat: 41.7999,  lng: 12.2462,   tier: 1 },
  MXP: { code: 'MXP', icao: 'LIMC', name: 'Milan Malpensa',             city: 'Milan',         country: 'IT', lat: 45.6306,  lng: 8.7281,    tier: 2 },
  ZRH: { code: 'ZRH', icao: 'LSZH', name: 'Zurich Airport',             city: 'Zurich',        country: 'CH', lat: 47.4647,  lng: 8.5492,    tier: 2 },
  DUB: { code: 'DUB', icao: 'EIDW', name: 'Dublin Airport',             city: 'Dublin',        country: 'IE', lat: 53.4213,  lng: -6.2700,   tier: 2 },
  MUC: { code: 'MUC', icao: 'EDDM', name: 'Munich Airport',             city: 'Munich',        country: 'DE', lat: 48.3538,  lng: 11.7861,   tier: 1 },
  BER: { code: 'BER', icao: 'EDDB', name: 'Berlin Brandenburg',         city: 'Berlin',        country: 'DE', lat: 52.3667,  lng: 13.5033,   tier: 2 },
  BCN: { code: 'BCN', icao: 'LEBL', name: 'Barcelona El Prat',          city: 'Barcelona',     country: 'ES', lat: 41.2974,  lng: 2.0833,    tier: 2 },
  BRU: { code: 'BRU', icao: 'EBBR', name: 'Brussels Airport',           city: 'Brussels',      country: 'BE', lat: 50.9014,  lng: 4.4844,    tier: 2 },
  IST: { code: 'IST', icao: 'LTFM', name: 'Istanbul Airport',           city: 'Istanbul',      country: 'TR', lat: 41.2750,  lng: 28.7519,   tier: 1 },
  SAW: { code: 'SAW', icao: 'LTFJ', name: 'Istanbul Sabiha Gökçen',     city: 'Istanbul',      country: 'TR', lat: 40.8983,  lng: 29.3092,   tier: 2 },
  SVO: { code: 'SVO', icao: 'UUEE', name: 'Sheremetyevo Intl',          city: 'Moscow',        country: 'RU', lat: 55.9726,  lng: 37.4146,   tier: 2 },
  DME: { code: 'DME', icao: 'UUDD', name: 'Domodedovo Intl',            city: 'Moscow',        country: 'RU', lat: 55.4088,  lng: 37.9062,   tier: 3 },

  // ── Middle East / Africa ────────────────────────────────
  DXB: { code: 'DXB', icao: 'OMDB', name: 'Dubai Intl',                 city: 'Dubai',         country: 'AE', lat: 25.2532,  lng: 55.3657,   tier: 1 },
  AUH: { code: 'AUH', icao: 'OMAA', name: 'Abu Dhabi Intl',             city: 'Abu Dhabi',     country: 'AE', lat: 24.4330,  lng: 54.6511,   tier: 2 },
  DOH: { code: 'DOH', icao: 'OTHH', name: 'Hamad Intl',                 city: 'Doha',          country: 'QA', lat: 25.2731,  lng: 51.6080,   tier: 1 },
  RUH: { code: 'RUH', icao: 'OERK', name: 'King Khalid Intl',           city: 'Riyadh',        country: 'SA', lat: 24.9576,  lng: 46.6988,   tier: 2 },
  JED: { code: 'JED', icao: 'OEJN', name: 'King Abdulaziz Intl',        city: 'Jeddah',        country: 'SA', lat: 21.6796,  lng: 39.1565,   tier: 2 },
  TLV: { code: 'TLV', icao: 'LLBG', name: 'Ben Gurion Airport',         city: 'Tel Aviv',      country: 'IL', lat: 32.0114,  lng: 34.8867,   tier: 2 },
  CAI: { code: 'CAI', icao: 'HECA', name: 'Cairo Intl',                 city: 'Cairo',         country: 'EG', lat: 30.1219,  lng: 31.4056,   tier: 2 },
  NBO: { code: 'NBO', icao: 'HKJK', name: 'Jomo Kenyatta Intl',         city: 'Nairobi',       country: 'KE', lat: -1.3192,  lng: 36.9275,   tier: 2 },
  ADD: { code: 'ADD', icao: 'HAAB', name: 'Addis Ababa Bole Intl',      city: 'Addis Ababa',   country: 'ET', lat: 8.9779,   lng: 38.7993,   tier: 2 },
  LOS: { code: 'LOS', icao: 'DNMM', name: 'Murtala Muhammed Intl',      city: 'Lagos',         country: 'NG', lat: 6.5774,   lng: 3.3212,    tier: 3 },
  CMN: { code: 'CMN', icao: 'GMMN', name: 'Mohammed V Intl',            city: 'Casablanca',    country: 'MA', lat: 33.3675,  lng: -7.5900,   tier: 2 },
  JNB: { code: 'JNB', icao: 'FAOR', name: 'O.R. Tambo Intl',            city: 'Johannesburg',  country: 'ZA', lat: -26.1392, lng: 28.2460,   tier: 2 },
  CPT: { code: 'CPT', icao: 'FACT', name: 'Cape Town Intl',             city: 'Cape Town',     country: 'ZA', lat: -33.9715, lng: 18.6021,   tier: 3 },

  // ── Asia ────────────────────────────────────────────────
  NRT: { code: 'NRT', icao: 'RJAA', name: 'Narita Intl',                city: 'Tokyo',         country: 'JP', lat: 35.7647,  lng: 140.3864,  tier: 1 },
  HND: { code: 'HND', icao: 'RJTT', name: 'Tokyo Haneda',               city: 'Tokyo',         country: 'JP', lat: 35.5494,  lng: 139.7798,  tier: 1 },
  KIX: { code: 'KIX', icao: 'RJBB', name: 'Kansai Intl',                city: 'Osaka',         country: 'JP', lat: 34.4342,  lng: 135.2328,  tier: 2 },
  ICN: { code: 'ICN', icao: 'RKSI', name: 'Incheon Intl',               city: 'Seoul',         country: 'KR', lat: 37.4691,  lng: 126.4510,  tier: 1 },
  GMP: { code: 'GMP', icao: 'RKSS', name: 'Gimpo Intl',                 city: 'Seoul',         country: 'KR', lat: 37.5583,  lng: 126.7906,  tier: 3 },
  PEK: { code: 'PEK', icao: 'ZBAA', name: 'Beijing Capital Intl',       city: 'Beijing',       country: 'CN', lat: 40.0799,  lng: 116.6031,  tier: 1 },
  PKX: { code: 'PKX', icao: 'ZBAD', name: 'Beijing Daxing Intl',        city: 'Beijing',       country: 'CN', lat: 39.5098,  lng: 116.4105,  tier: 2 },
  PVG: { code: 'PVG', icao: 'ZSPD', name: 'Shanghai Pudong Intl',       city: 'Shanghai',      country: 'CN', lat: 31.1434,  lng: 121.8052,  tier: 1 },
  CAN: { code: 'CAN', icao: 'ZGGG', name: 'Guangzhou Baiyun Intl',      city: 'Guangzhou',     country: 'CN', lat: 23.3924,  lng: 113.2988,  tier: 2 },
  SZX: { code: 'SZX', icao: 'ZGSZ', name: "Shenzhen Bao'an Intl",       city: 'Shenzhen',      country: 'CN', lat: 22.6393,  lng: 113.8108,  tier: 2 },
  CTU: { code: 'CTU', icao: 'ZUUU', name: 'Chengdu Shuangliu Intl',     city: 'Chengdu',       country: 'CN', lat: 30.5785,  lng: 103.9471,  tier: 3 },
  HKG: { code: 'HKG', icao: 'VHHH', name: 'Hong Kong Intl',             city: 'Hong Kong',     country: 'HK', lat: 22.3080,  lng: 113.9185,  tier: 1 },
  TPE: { code: 'TPE', icao: 'RCTP', name: 'Taiwan Taoyuan Intl',        city: 'Taipei',        country: 'TW', lat: 25.0777,  lng: 121.2328,  tier: 2 },
  SIN: { code: 'SIN', icao: 'WSSS', name: 'Singapore Changi',           city: 'Singapore',     country: 'SG', lat: 1.3644,   lng: 103.9915,  tier: 1 },
  BKK: { code: 'BKK', icao: 'VTBS', name: 'Suvarnabhumi Airport',       city: 'Bangkok',       country: 'TH', lat: 13.6900,  lng: 100.7501,  tier: 1 },
  DMK: { code: 'DMK', icao: 'VTBD', name: 'Don Mueang Intl',            city: 'Bangkok',       country: 'TH', lat: 13.9126,  lng: 100.6067,  tier: 3 },
  KUL: { code: 'KUL', icao: 'WMKK', name: 'Kuala Lumpur Intl',          city: 'Kuala Lumpur',  country: 'MY', lat: 2.7456,   lng: 101.7099,  tier: 2 },
  CGK: { code: 'CGK', icao: 'WIII', name: 'Soekarno-Hatta Intl',        city: 'Jakarta',       country: 'ID', lat: -6.1275,  lng: 106.6537,  tier: 2 },
  MNL: { code: 'MNL', icao: 'RPLL', name: 'Ninoy Aquino Intl',          city: 'Manila',        country: 'PH', lat: 14.5086,  lng: 121.0197,  tier: 2 },
  HAN: { code: 'HAN', icao: 'VVNB', name: 'Noi Bai Intl',               city: 'Hanoi',         country: 'VN', lat: 21.2212,  lng: 105.8072,  tier: 3 },
  SGN: { code: 'SGN', icao: 'VVTS', name: 'Tan Son Nhat Intl',          city: 'Ho Chi Minh',   country: 'VN', lat: 10.8188,  lng: 106.6520,  tier: 3 },
  DEL: { code: 'DEL', icao: 'VIDP', name: 'Indira Gandhi Intl',         city: 'New Delhi',     country: 'IN', lat: 28.5562,  lng: 77.1000,   tier: 1 },
  BOM: { code: 'BOM', icao: 'VABB', name: 'Chhatrapati Shivaji Intl',   city: 'Mumbai',        country: 'IN', lat: 19.0896,  lng: 72.8656,   tier: 2 },
  BLR: { code: 'BLR', icao: 'VOBL', name: 'Kempegowda Intl',            city: 'Bengaluru',     country: 'IN', lat: 13.1986,  lng: 77.7066,   tier: 2 },
  MAA: { code: 'MAA', icao: 'VOMM', name: 'Chennai Intl',               city: 'Chennai',       country: 'IN', lat: 12.9941,  lng: 80.1709,   tier: 3 },
  HYD: { code: 'HYD', icao: 'VOHS', name: 'Rajiv Gandhi Intl',          city: 'Hyderabad',     country: 'IN', lat: 17.2403,  lng: 78.4294,   tier: 3 },
  KHI: { code: 'KHI', icao: 'OPKC', name: 'Jinnah Intl',                city: 'Karachi',       country: 'PK', lat: 24.9008,  lng: 67.1681,   tier: 3 },

  // ── Oceania ─────────────────────────────────────────────
  SYD: { code: 'SYD', icao: 'YSSY', name: 'Sydney Kingsford Smith',     city: 'Sydney',        country: 'AU', lat: -33.9461, lng: 151.1772,  tier: 1 },
  MEL: { code: 'MEL', icao: 'YMML', name: 'Melbourne Airport',          city: 'Melbourne',     country: 'AU', lat: -37.6690, lng: 144.8410,  tier: 2 },
  BNE: { code: 'BNE', icao: 'YBBN', name: 'Brisbane Airport',           city: 'Brisbane',      country: 'AU', lat: -27.3842, lng: 153.1175,  tier: 2 },
  PER: { code: 'PER', icao: 'YPPH', name: 'Perth Airport',              city: 'Perth',         country: 'AU', lat: -31.9403, lng: 115.9669,  tier: 3 },
  AKL: { code: 'AKL', icao: 'NZAA', name: 'Auckland Airport',           city: 'Auckland',      country: 'NZ', lat: -37.0082, lng: 174.7850,  tier: 2 },
  CHC: { code: 'CHC', icao: 'NZCH', name: 'Christchurch Airport',       city: 'Christchurch',  country: 'NZ', lat: -43.4894, lng: 172.5322,  tier: 3 },

  // ── UK airports (required for regional visibility) ───────
  MAN: { code: 'MAN', icao: 'EGCC', name: 'Manchester Airport',             city: 'Manchester',  country: 'GB', lat: 53.3537,  lng: -2.2750,   tier: 2 },
  LGW: { code: 'LGW', icao: 'EGKK', name: 'London Gatwick Airport',         city: 'London',      country: 'GB', lat: 51.1537,  lng: -0.1821,   tier: 2 },
  STN: { code: 'STN', icao: 'EGSS', name: 'London Stansted Airport',        city: 'London',      country: 'GB', lat: 51.8850,  lng:  0.2350,   tier: 3 },
  LTN: { code: 'LTN', icao: 'EGGW', name: 'London Luton Airport',           city: 'London',      country: 'GB', lat: 51.8747,  lng: -0.3683,   tier: 3 },
  LCY: { code: 'LCY', icao: 'EGLC', name: 'London City Airport',            city: 'London',      country: 'GB', lat: 51.5053,  lng:  0.0553,   tier: 3 },
  BHX: { code: 'BHX', icao: 'EGBB', name: 'Birmingham Airport',             city: 'Birmingham',  country: 'GB', lat: 52.4539,  lng: -1.7480,   tier: 3 },
  EDI: { code: 'EDI', icao: 'EGPH', name: 'Edinburgh Airport',              city: 'Edinburgh',   country: 'GB', lat: 55.9508,  lng: -3.3725,   tier: 3 },
  GLA: { code: 'GLA', icao: 'EGPF', name: 'Glasgow Airport',                city: 'Glasgow',     country: 'GB', lat: 55.8719,  lng: -4.4331,   tier: 3 },
  LBA: { code: 'LBA', icao: 'EGNM', name: 'Leeds Bradford Airport',         city: 'Leeds',       country: 'GB', lat: 53.8659,  lng: -1.6606,   tier: 3 },
  LPL: { code: 'LPL', icao: 'EGGP', name: 'Liverpool John Lennon Airport',  city: 'Liverpool',   country: 'GB', lat: 53.3336,  lng: -2.8497,   tier: 3 },
  BRS: { code: 'BRS', icao: 'EGGD', name: 'Bristol Airport',                city: 'Bristol',     country: 'GB', lat: 51.3827,  lng: -2.7190,   tier: 3 },
  NCL: { code: 'NCL', icao: 'EGNT', name: 'Newcastle Airport',              city: 'Newcastle',   country: 'GB', lat: 55.0375,  lng: -1.6917,   tier: 3 },

  // ── Additional European hubs ─────────────────────────────
  VIE: { code: 'VIE', icao: 'LOWW', name: 'Vienna Intl Airport',            city: 'Vienna',      country: 'AT', lat: 48.1103,  lng: 16.5697,   tier: 2 },
  CPH: { code: 'CPH', icao: 'EKCH', name: 'Copenhagen Airport',             city: 'Copenhagen',  country: 'DK', lat: 55.6180,  lng: 12.6508,   tier: 2 },
  OSL: { code: 'OSL', icao: 'ENGM', name: 'Oslo Gardermoen Airport',        city: 'Oslo',        country: 'NO', lat: 60.1975,  lng: 11.1004,   tier: 2 },
  ARN: { code: 'ARN', icao: 'ESSA', name: 'Stockholm Arlanda Airport',      city: 'Stockholm',   country: 'SE', lat: 59.6519,  lng: 17.9186,   tier: 2 },
  HEL: { code: 'HEL', icao: 'EFHK', name: 'Helsinki Vantaa Airport',        city: 'Helsinki',    country: 'FI', lat: 60.3172,  lng: 24.9633,   tier: 2 },
  LIS: { code: 'LIS', icao: 'LPPT', name: 'Humberto Delgado Airport',       city: 'Lisbon',      country: 'PT', lat: 38.7756,  lng: -9.1354,   tier: 2 },
  ATH: { code: 'ATH', icao: 'LGAV', name: 'Athens Intl Airport',            city: 'Athens',      country: 'GR', lat: 37.9364,  lng: 23.9445,   tier: 2 },
  WAW: { code: 'WAW', icao: 'EPWA', name: 'Warsaw Chopin Airport',          city: 'Warsaw',      country: 'PL', lat: 52.1657,  lng: 20.9671,   tier: 3 },
  PRG: { code: 'PRG', icao: 'LKPR', name: 'Václav Havel Airport',           city: 'Prague',      country: 'CZ', lat: 50.1008,  lng: 14.2600,   tier: 3 },
  BUD: { code: 'BUD', icao: 'LHBP', name: 'Budapest Ferenc Liszt Intl',     city: 'Budapest',    country: 'HU', lat: 47.4298,  lng: 19.2611,   tier: 3 },
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

  /**
   * Insert or merge a single aircraft into the live feed. Used when a
   * tracked flight is focused from the alerts panel but its ICAO hex is
   * outside the current viewport — we fetch its state globally via
   * openSkyService.fetchByHex / fetchByCallsign and hand it here so the
   * existing flyTo + follow logic in MapView works unchanged.
   *
   * Notes:
   *  • Preserves any trail / enrichment already attached to the flight.
   *  • Emits to listeners so follow mode pans on the next subscribe tick.
   *  • Idempotent — calling with the same id twice just refreshes fields.
   */
  upsertFlight(incoming) {
    if (!incoming?.id) return null;
    // Protect upserted flights from being dropped by the next OpenSky
    // merge before the viewport has had a chance to shift to cover the
    // aircraft's position (flyTo animates for ~1.2 s, BoundsSync fires
    // on moveend, then a 15 s poll cycle runs). A 45 s grace is plenty.
    const preservedUntil = Date.now() + 45_000;
    const existing = this.flights.find((f) => f.id === incoming.id);
    if (existing) {
      if (Number.isFinite(incoming.lat)) existing.lat = incoming.lat;
      if (Number.isFinite(incoming.lng)) existing.lng = incoming.lng;
      if (Number.isFinite(incoming.heading)) existing.heading = incoming.heading;
      if (Number.isFinite(incoming.speed))   existing.speed   = incoming.speed;
      if (Number.isFinite(incoming.altitude)) existing.altitude = incoming.altitude;
      if (incoming.vertRate != null) existing.vertRate = incoming.vertRate;
      if (incoming.squawk  != null)  existing.squawk   = incoming.squawk;
      existing._preservedUntil = preservedUntil;
      this._listeners.forEach((fn) => fn(this.flights));
      return existing;
    }
    const seeded = {
      ...incoming,
      trail: Array.isArray(incoming.trail) && incoming.trail.length > 0
        ? incoming.trail
        : [{ lat: incoming.lat, lng: incoming.lng }],
      _preservedUntil: preservedUntil,
    };
    this.flights.push(seeded);
    this._listeners.forEach((fn) => fn(this.flights));
    return seeded;
  }

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
    const now = Date.now();
    this.flights = this.flights.map((f) => {
      const fresh = incomingMap.get(f.id);
      if (!fresh) {
        // Normally we drop aircraft that fell out of the viewport feed,
        // but preserve flights just upserted via upsertFlight() so that
        // a freshly-focused tracked aircraft isn't yanked from under
        // follow mode before the viewport has had time to shift.
        if (f._preservedUntil && f._preservedUntil > now) return f;
        return null;
      }
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
        _preservedUntil: undefined,
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
