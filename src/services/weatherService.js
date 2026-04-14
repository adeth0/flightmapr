// ─────────────────────────────────────────────────────────
//  WeatherService — simulated cloud/precipitation cells
//  Replace getCells() with a real API (e.g. OpenWeatherMap)
//  to show live weather tile overlays.
// ─────────────────────────────────────────────────────────

const CELL_COUNT = 22;

function randomBetween(a, b) {
  return a + Math.random() * (b - a);
}

function generateCells() {
  return Array.from({ length: CELL_COUNT }, (_, i) => ({
    id: i,
    lat: randomBetween(-55, 65),
    lng: randomBetween(-170, 170),
    radius: randomBetween(6, 22),      // degrees
    intensity: randomBetween(0.2, 0.8),
    type: Math.random() < 0.55 ? 'cloud' : 'rain',
    dLat: randomBetween(-0.4, 0.4),   // degrees/min
    dLng: randomBetween(-0.6, 0.6),
    phase: Math.random() * Math.PI * 2,
    pulseSpeed: randomBetween(0.5, 1.5),
  }));
}

class WeatherService {
  constructor() {
    this._cells = generateCells();
    this._time = 0;
  }

  getCells() {
    return this._cells;
  }

  /** Call once per animation frame in WeatherLayer */
  tick(dt) {
    this._time += dt;
    this._cells.forEach((c) => {
      // Drift
      c.lat += c.dLat * dt * 0.016;
      c.lng += c.dLng * dt * 0.016;

      // Wrap around
      if (c.lat > 75)  c.lat = -60;
      if (c.lat < -60) c.lat = 70;
      if (c.lng > 180) c.lng -= 360;
      if (c.lng < -180) c.lng += 360;

      // Pulse intensity
      c.intensity = 0.35 + 0.35 * Math.sin(this._time * c.pulseSpeed + c.phase);
    });
  }
}

export const weatherService = new WeatherService();
