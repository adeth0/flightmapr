import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

// ─────────────────────────────────────────────────────────
//  Day / Night terminator overlay
//  Draws a semi-transparent polygon over the night hemisphere,
//  updated every 60 seconds. Pure math — no external API.
// ─────────────────────────────────────────────────────────

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/**
 * Approximate subsolar point (where the sun is directly overhead).
 * Accuracy: ±1° — sufficient for a visual overlay.
 */
function getSubsolarPoint(date) {
  const JD = date.getTime() / 86_400_000 + 2_440_587.5;
  const n  = JD - 2_451_545.0; // days since J2000.0

  // Mean longitude & mean anomaly
  const L      = ((280.460 + 0.985_647_4 * n) % 360 + 360) % 360;
  const g      = ((357.528 + 0.985_600_3 * n) % 360 + 360) % 360 * D2R;
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
  const eps    = 23.439 * D2R; // obliquity of ecliptic

  // Declination + right ascension
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda)) * R2D;
  const ra  = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) * R2D;

  // Greenwich Mean Sidereal Time → subsolar longitude
  const utcH = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const GMST = ((6.697_375 + 0.065_709_824_2 * n + utcH) * 15 % 360 + 360) % 360;

  let lng = ((ra - GMST + 360) % 360);
  if (lng > 180) lng -= 360;

  return { lat: dec, lng };
}

/**
 * Build a Leaflet-compatible polygon (array of [lat,lng]) covering the night side.
 *
 * The terminator latitude for a given longitude θ is:
 *   tan(termLat) = -cos(θ - sLng) / tan(sDec)
 *
 * We then close the polygon by adding the night pole.
 */
function buildNightPolygon(date) {
  const ss    = getSubsolarPoint(date);
  const sDecR = ss.lat * D2R;
  const sLng  = ss.lng;

  const termPts = [];

  for (let lng = -180; lng <= 180; lng += 1) {
    const lngDiff = (lng - sLng) * D2R;
    let lat;

    if (Math.abs(ss.lat) < 0.3) {
      // Near-equinox: terminator lies close to the 90°-meridians from subsolar lng
      lat = Math.cos(lngDiff) >= 0 ? 89 : -89;
    } else {
      lat = Math.atan(-Math.cos(lngDiff) / Math.tan(sDecR)) * R2D;
    }

    lat = Math.max(-89, Math.min(89, lat));
    termPts.push([lat, lng]);
  }

  // Night pole: south when northern summer (sDec > 0), north otherwise
  const nightPoleLat = ss.lat >= 0 ? -90 : 90;

  // Polygon: terminator west→east, then close through the night pole
  return [
    ...termPts,
    [nightPoleLat, 180],
    [nightPoleLat, -180],
  ];
}

// ── Component ─────────────────────────────────────────────
export function DayNightLayer({ enabled = true }) {
  const map    = useMap();
  const polyRef  = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!enabled) {
      if (polyRef.current) { polyRef.current.remove(); polyRef.current = null; }
      clearInterval(timerRef.current);
      return;
    }

    function update() {
      const pts = buildNightPolygon(new Date());
      if (polyRef.current) {
        polyRef.current.setLatLngs(pts);
      } else {
        polyRef.current = L.polygon(pts, {
          color:       'transparent',
          fillColor:   '#000018',
          fillOpacity: 0.32,
          interactive: false,
          className:   'day-night-layer',
          smoothFactor: 1,
        }).addTo(map);
      }
    }

    update();
    timerRef.current = setInterval(update, 60_000);

    return () => {
      clearInterval(timerRef.current);
      if (polyRef.current) { polyRef.current.remove(); polyRef.current = null; }
    };
  }, [map, enabled]);

  return null;
}
