import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { weatherService } from '../services/weatherService';
import { MAP_DEFAULTS }   from '../services/mapService';

// ─────────────────────────────────────────────────────────
//  WeatherLayer
//  1. Tries RainViewer radar tiles (free, no key required)
//  2. Falls back to animated canvas simulation on failure
// ─────────────────────────────────────────────────────────

const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';
const RAINVIEWER_TTL = 10 * 60 * 1000; // refresh tiles every 10 min

// RainViewer radar tiles are available at zoom 0–12.
// Leaflet upscales z12 tiles for any higher zoom (no tile requests above z12).
const RV_MIN_NATIVE_ZOOM = 0;
const RV_MAX_NATIVE_ZOOM = 12;

// 1×1 transparent GIF — used as the errorTileUrl so any tile that fails
// to load (network hiccup, out-of-range zoom on first paint, etc.) is
// replaced silently with nothing rather than a broken image or error text.
const TRANSPARENT_TILE =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// ── RainViewer helpers ────────────────────────────────────
async function fetchRainViewerUrl() {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(RAINVIEWER_API, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const past = data.radar?.past;
    if (!past?.length) throw new Error('no radar data');
    const latest = past[past.length - 1];
    return `https://tilecache.rainviewer.com${latest.path}/256/{z}/{x}/{y}/2/1_1.png`;
  } catch (e) {
    clearTimeout(timer);
    console.warn('[RainViewer] unavailable:', e.message);
    return null;
  }
}

// ── Canvas simulation helpers ─────────────────────────────
function drawCanvas(canvas, map) {
  const size = map.getSize();
  canvas.width  = size.x;
  canvas.height = size.y;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size.x, size.y);

  weatherService.getCells().forEach((cell) => {
    const pt  = map.latLngToContainerPoint([cell.lat, cell.lng]);
    const ptR = map.latLngToContainerPoint([cell.lat + cell.radius, cell.lng]);
    const r   = Math.max(30, Math.abs(ptR.y - pt.y));

    if (pt.x < -r || pt.x > size.x + r || pt.y < -r || pt.y > size.y + r) return;

    const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r);
    if (cell.type === 'rain') {
      const a = cell.intensity * 0.38;
      grad.addColorStop(0,    `rgba(40,100,255,${a})`);
      grad.addColorStop(0.45, `rgba(30,80,200,${a * 0.5})`);
      grad.addColorStop(1,    'rgba(30,80,200,0)');
    } else {
      const a = cell.intensity * 0.28;
      grad.addColorStop(0,    `rgba(180,220,255,${a})`);
      grad.addColorStop(0.5,  `rgba(160,200,240,${a * 0.4})`);
      grad.addColorStop(1,    'rgba(160,200,240,0)');
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    ctx.fill();
  });
}

// ── Component ─────────────────────────────────────────────
export function WeatherLayer({ enabled }) {
  const map          = useMap();
  const tileRef      = useRef(null);  // RainViewer L.TileLayer
  const canvasRef    = useRef(null);  // canvas element (fallback)
  const rafRef       = useRef(null);
  const lastTimeRef  = useRef(null);
  const refreshTimer = useRef(null);

  function cleanup() {
    cancelAnimationFrame(rafRef.current);
    clearTimeout(refreshTimer.current);
    if (tileRef.current) {
      tileRef.current.off('tileerror');
      tileRef.current.remove();
      tileRef.current = null;
    }
    if (canvasRef.current) { canvasRef.current.remove(); canvasRef.current = null; }
    lastTimeRef.current = null;
  }

  useEffect(() => {
    if (!enabled) { cleanup(); return; }

    let cancelled = false;

    // ── Try RainViewer first ─────────────────────────────
    async function tryRainViewer() {
      const url = await fetchRainViewerUrl();
      if (cancelled) return;

      if (url) {
        // Real radar tile layer.
        // minNativeZoom/maxNativeZoom clamp all tile requests to the range
        // RainViewer supports (z0–z12). Leaflet upscales z12 tiles for any
        // higher zoom level, so the overlay renders at all map zoom levels
        // without ever requesting an unsupported tile.
        // errorTileUrl replaces any failed tile with a transparent pixel —
        // no broken images, no error text, no console tile-error spam.
        tileRef.current = L.tileLayer(url, {
          opacity:         0.6,
          interactive:     false,
          zIndex:          350,
          minNativeZoom:   RV_MIN_NATIVE_ZOOM,
          maxNativeZoom:   RV_MAX_NATIVE_ZOOM,
          maxZoom:         MAP_DEFAULTS.maxZoom,
          errorTileUrl:    TRANSPARENT_TILE,
          attribution:     'Radar © <a href="https://www.rainviewer.com">RainViewer</a>',
        }).addTo(map);

        // Belt-and-suspenders: if a tile errors for any reason (network,
        // server), replace it with the transparent tile rather than leaving
        // a broken image state visible on the map.
        tileRef.current.on('tileerror', (e) => {
          if (e.tile) e.tile.src = TRANSPARENT_TILE;
        });

        // Refresh URL periodically
        refreshTimer.current = setTimeout(() => {
          if (!cancelled) tryRainViewer();
        }, RAINVIEWER_TTL);
      } else {
        // ── Fallback: canvas simulation ──────────────────
        startCanvasSim();
      }
    }

    function startCanvasSim() {
      const canvas = document.createElement('canvas');
      canvas.style.cssText =
        'position:absolute;top:0;left:0;pointer-events:none;z-index:350;mix-blend-mode:screen;';
      map.getPane('overlayPane').appendChild(canvas);
      canvasRef.current = canvas;

      const onMapChange = () => drawCanvas(canvas, map);
      map.on('move zoom resize', onMapChange);

      function tick(now) {
        if (cancelled) return;
        const dt = lastTimeRef.current ? (now - lastTimeRef.current) / 1000 : 0.016;
        lastTimeRef.current = now;
        weatherService.tick(dt);
        drawCanvas(canvas, map);
        rafRef.current = requestAnimationFrame(tick);
      }
      rafRef.current = requestAnimationFrame(tick);

      // Store cleanup ref
      canvasRef._offFn = onMapChange;
    }

    tryRainViewer();

    return () => {
      cancelled = true;
      if (canvasRef._offFn) map.off('move zoom resize', canvasRef._offFn);
      cleanup();
    };
  }, [map, enabled]);

  return null;
}
