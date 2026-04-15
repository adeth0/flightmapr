// ─────────────────────────────────────────────────────────
//  MapService — tile URLs and map configuration helpers
// ─────────────────────────────────────────────────────────

export const TILE_LAYERS = {
  // Night / dark mode — clean dark canvas, unchanged
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
    subdomains: 'abcd',
  },
  // Day / light mode — CartoDB Voyager: full colour roads, labels, terrain
  // (Google Maps-style look, no API key required)
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
    subdomains: 'abcd',
  },
};

export const MAP_DEFAULTS = {
  center: [30, 10],
  zoom: 3,
  minZoom: 2,
  maxZoom: 14,
};

export const FLY_TO_ZOOM = 7;
