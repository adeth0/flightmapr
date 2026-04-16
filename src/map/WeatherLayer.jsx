import { useEffect, useMemo, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

const WEATHER_API_KEY = '4d347aea54c8d9a8e94c2bb6f13ed5cc';
const WEATHER_TTL_MS = 15 * 60 * 1_000;
const weatherCache = new Map();

function describeWeather(weatherId) {
  if (weatherId >= 200 && weatherId < 300) return { icon: '⛈', label: 'Storms' };
  if (weatherId >= 300 && weatherId < 600) return { icon: '🌧', label: 'Rain' };
  if (weatherId >= 600 && weatherId < 700) return { icon: '❄️', label: 'Snow' };
  if (weatherId >= 700 && weatherId < 800) return { icon: '🌫', label: 'Haze' };
  if (weatherId === 800) return { icon: '☀️', label: 'Clear' };
  return { icon: '☁️', label: 'Clouds' };
}

function getGridSize(zoom) {
  if (zoom >= 9) return { rows: 2, cols: 3 };
  if (zoom >= 6) return { rows: 2, cols: 2 };
  return { rows: 1, cols: 3 };
}

function buildSamplePoints(bounds, zoom) {
  const { rows, cols } = getGridSize(zoom);
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const west = bounds.getWest();
  const east = bounds.getEast();
  const latStep = (north - south) / (rows + 1);
  const lngStep = (east - west) / (cols + 1);
  const points = [];

  for (let row = 1; row <= rows; row += 1) {
    for (let col = 1; col <= cols; col += 1) {
      points.push({
        lat: south + (latStep * row),
        lng: west + (lngStep * col),
      });
    }
  }

  return points;
}

function cacheKey(lat, lng) {
  return `${lat.toFixed(2)}:${lng.toFixed(2)}`;
}

async function loadWeather(lat, lng) {
  const key = cacheKey(lat, lng);
  const cached = weatherCache.get(key);
  if (cached && (Date.now() - cached.ts) < WEATHER_TTL_MS) return cached.data;

  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat.toFixed(3)}&lon=${lng.toFixed(3)}&appid=${WEATHER_API_KEY}&units=metric`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Weather ${response.status}`);
  const json = await response.json();
  const summary = describeWeather(json.weather?.[0]?.id ?? 801);
  const data = {
    lat,
    lng,
    temp: Math.round(json.main?.temp ?? 0),
    ...summary,
  };
  weatherCache.set(key, { ts: Date.now(), data });
  return data;
}

function createWeatherIcon(weather, darkMode) {
  const bg = darkMode ? 'rgba(8,14,24,0.78)' : 'rgba(255,255,255,0.78)';
  const fg = darkMode ? '#ecfeff' : '#0f172a';
  const sub = darkMode ? 'rgba(236,254,255,0.68)' : 'rgba(15,23,42,0.62)';
  return L.divIcon({
    className: 'smart-weather-marker',
    html:
      `<div class="smart-weather-chip" style="background:${bg};color:${fg};">` +
      `<span class="smart-weather-icon">${weather.icon}</span>` +
      `<div class="smart-weather-copy">` +
      `<span class="smart-weather-label" style="color:${sub};">${weather.label}</span>` +
      `<strong>${weather.temp}°</strong>` +
      `</div></div>`,
    iconSize: [76, 34],
    iconAnchor: [38, 17],
  });
}

export function WeatherLayer({ enabled, dayNightEnabled }) {
  const map = useMap();
  const layerGroupRef = useRef(null);
  const requestIdRef = useRef(0);
  const darkMode = useMemo(() => dayNightEnabled, [dayNightEnabled]);

  useEffect(() => {
    async function syncWeather() {
      if (!enabled) return;

      const requestId = ++requestIdRef.current;
      const group = layerGroupRef.current ?? L.layerGroup().addTo(map);
      layerGroupRef.current = group;
      group.clearLayers();

      const points = buildSamplePoints(map.getBounds(), map.getZoom());
      const results = await Promise.allSettled(points.map((point) => loadWeather(point.lat, point.lng)));
      if (requestId !== requestIdRef.current) return;

      results
        .filter((result) => result.status === 'fulfilled')
        .forEach((result) => {
          const weather = result.value;
          L.marker([weather.lat, weather.lng], {
            icon: createWeatherIcon(weather, darkMode),
            interactive: false,
            keyboard: false,
            zIndexOffset: -200,
          }).addTo(group);
        });
    }

    if (!enabled) {
      if (layerGroupRef.current) {
        map.removeLayer(layerGroupRef.current);
        layerGroupRef.current = null;
      }
      return undefined;
    }

    syncWeather().catch(() => {});
    map.on('moveend', syncWeather);
    map.on('zoomend', syncWeather);

    return () => {
      map.off('moveend', syncWeather);
      map.off('zoomend', syncWeather);
      if (layerGroupRef.current) {
        map.removeLayer(layerGroupRef.current);
        layerGroupRef.current = null;
      }
    };
  }, [darkMode, enabled, map]);

  return null;
}
