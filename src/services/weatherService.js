// ─────────────────────────────────────────────────────────
//  WeatherService — viewport-adaptive synthetic weather cells
//  The previous version placed a few random cells globally, which meant
//  weather could appear "broken" simply because no cell happened to be in
//  the current viewport. This version always seeds cells around the visible
//  map bounds while remaining fully zoom-safe and API-free.
// ─────────────────────────────────────────────────────────

const CELL_COUNT_BASE = 16;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(seed) {
  return function rand() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createSeededRandom(key) {
  const seed = xmur3(key)();
  return mulberry32(seed);
}

function randomBetween(rand, a, b) {
  return a + rand() * (b - a);
}

function generateCellsForViewport(bounds, zoom, previousTime = 0) {
  if (!bounds) return [];

  const south = bounds.getSouth();
  const west = bounds.getWest();
  const north = bounds.getNorth();
  const east = bounds.getEast();
  const latSpan = Math.max(4, north - south);
  const lngSpan = Math.max(4, east - west);
  const padLat = latSpan * 0.35;
  const padLng = lngSpan * 0.35;

  const center = bounds.getCenter();
  const zoomBucket = Math.max(2, Math.round(zoom));
  const seedKey = [
    center.lat.toFixed(1),
    center.lng.toFixed(1),
    zoomBucket,
  ].join(':');
  const rand = createSeededRandom(seedKey);
  const count = CELL_COUNT_BASE + Math.max(0, zoomBucket - 2);

  return Array.from({ length: count }, (_, i) => ({
    id: `${seedKey}-${i}`,
    lat: clamp(randomBetween(rand, south - padLat, north + padLat), -80, 80),
    lng: randomBetween(rand, west - padLng, east + padLng),
    radius: randomBetween(rand, latSpan * 0.08, latSpan * 0.24),
    intensity: randomBetween(rand, 0.24, 0.82),
    type: rand() < 0.58 ? 'cloud' : 'rain',
    dLat: randomBetween(rand, -0.05, 0.05),
    dLng: randomBetween(rand, -0.08, 0.08),
    phase: rand() * Math.PI * 2,
    pulseSpeed: randomBetween(rand, 0.55, 1.35),
    baseIntensity: randomBetween(rand, 0.24, 0.72),
    bornAt: previousTime,
  }));
}

class WeatherService {
  constructor() {
    this._cells = [];
    this._time = 0;
    this._viewportKey = null;
  }

  getCells() {
    return this._cells;
  }

  syncToViewport(bounds, zoom) {
    if (!bounds) return;
    const center = bounds.getCenter();
    const key = [
      center.lat.toFixed(1),
      center.lng.toFixed(1),
      Math.max(2, Math.round(zoom)),
    ].join(':');

    if (key === this._viewportKey && this._cells.length > 0) return;
    this._viewportKey = key;
    this._cells = generateCellsForViewport(bounds, zoom, this._time);
  }

  /** Call once per animation frame in WeatherLayer */
  tick(dt) {
    this._time += dt;
    this._cells.forEach((c) => {
      // Drift
      c.lat += c.dLat * dt;
      c.lng += c.dLng * dt;

      // Wrap around the world cleanly.
      if (c.lat > 80)  c.lat = -80;
      if (c.lat < -80) c.lat = 80;
      if (c.lng > 180) c.lng -= 360;
      if (c.lng < -180) c.lng += 360;

      // Pulse intensity
      c.intensity = clamp(
        c.baseIntensity + 0.18 * Math.sin(this._time * c.pulseSpeed + c.phase),
        0.18,
        0.88,
      );
    });
  }
}

export const weatherService = new WeatherService();
