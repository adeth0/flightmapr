// ─────────────────────────────────────────────────────────
//  MapService — tile URLs and map configuration helpers
// ─────────────────────────────────────────────────────────

export const TILE_LAYERS = {
  // Night / dark mode — clean dark canvas, unchanged
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
    labelsUrl: 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
    subdomains: 'abcd',
  },
  // Day / light mode — CartoDB Voyager: full colour roads, labels, terrain
  // (Google Maps-style look, no API key required)
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png',
    labelsUrl: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
    subdomains: 'abcd',
  },
  // Detailed satellite imagery — Esri World Imagery. High-resolution
  // photographic tiles covering the globe at z18+ over urban areas.
  // No API key required, attribution required (Esri / Maxar / Earthstar).
  // We deliberately keep the existing labels layer on top so place names
  // and roads remain legible against the imagery — that's why this entry
  // doesn't ship its own labelsUrl: it inherits from dark/light depending
  // on the day/night state.
  detailed: {
    url:
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution:
      'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    maxZoom: 19,
    // Esri World Imagery doesn't use {s}-style subdomain sharding.
    subdomains: '',
  },
};

export const MAP_DEFAULTS = {
  center: [30, 10],
  zoom: 3,
  minZoom: 2,
  maxZoom: 14,
};

export const FLY_TO_ZOOM = 7;
