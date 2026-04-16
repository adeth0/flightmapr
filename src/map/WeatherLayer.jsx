import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import { weatherService } from '../services/weatherService';

// ─────────────────────────────────────────────────────────
//  WeatherLayer
//  Zoom-safe adaptive rendering (canvas overlay only).
// ─────────────────────────────────────────────────────────

// ── Canvas simulation helpers ─────────────────────────────
function drawCanvas(canvas, map) {
  const size = map.getSize();
  if (canvas.width !== size.x) canvas.width = size.x;
  if (canvas.height !== size.y) canvas.height = size.y;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

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
  const canvasRef    = useRef(null);
  const rafRef       = useRef(null);
  const lastTimeRef  = useRef(null);
  const removeTimerRef = useRef(null);

  function cleanup(immediate = true) {
    cancelAnimationFrame(rafRef.current);
    clearTimeout(removeTimerRef.current);
    if (canvasRef.current) {
      const canvas = canvasRef.current;
      if (immediate) {
        canvas.remove();
      } else {
        canvas.style.opacity = '0';
        removeTimerRef.current = setTimeout(() => {
          canvas.remove();
        }, 220);
      }
      canvasRef.current = null;
    }
    lastTimeRef.current = null;
  }

  useEffect(() => {
    if (!enabled) {
      cleanup(false);
      return undefined;
    }

    let cancelled = false;

    function syncWeather() {
      weatherService.syncToViewport(map.getBounds(), map.getZoom());
      if (canvasRef.current) drawCanvas(canvasRef.current, map);
    }

    function startCanvasOverlay() {
      const canvas = document.createElement('canvas');
      canvas.style.cssText =
        'position:absolute;top:0;left:0;pointer-events:none;z-index:350;mix-blend-mode:screen;opacity:0;transition:opacity 180ms ease;';
      map.getPane('overlayPane').appendChild(canvas);
      canvasRef.current = canvas;
      syncWeather();
      requestAnimationFrame(() => {
        if (canvasRef.current === canvas) canvas.style.opacity = '1';
      });

      map.on('moveend zoomend resize', syncWeather);

      function tick(now) {
        if (cancelled) return;
        const dt = lastTimeRef.current ? (now - lastTimeRef.current) / 1000 : 0.016;
        lastTimeRef.current = now;
        weatherService.tick(dt);
        drawCanvas(canvas, map);
        rafRef.current = requestAnimationFrame(tick);
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    startCanvasOverlay();

    return () => {
      cancelled = true;
      map.off('moveend zoomend resize', syncWeather);
      cleanup(false);
    };
  }, [map, enabled]);

  return null;
}
