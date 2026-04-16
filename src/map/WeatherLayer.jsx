import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

const WEATHER_PROVIDERS = [
  'https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png?appid=4d347aea54c8d9a8e94c2bb6f13ed5cc',
  'https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=4d347aea54c8d9a8e94c2bb6f13ed5cc',
];

const ERROR_THRESHOLD = 6;

function createWeatherLayer(url) {
  return L.tileLayer(url, {
    attribution: '&copy; OpenWeatherMap',
    opacity: 0.52,
    pane: 'overlayPane',
    tileSize: 256,
    updateWhenIdle: false,
    updateWhenZooming: true,
    keepBuffer: 2,
    crossOrigin: true,
    noWrap: false,
  });
}

export function WeatherLayer({ enabled }) {
  const map = useMap();
  const layerRef = useRef(null);
  const providerIndexRef = useRef(0);
  const tileErrorsRef = useRef(0);

  useEffect(() => {
    function mountProvider(index) {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
      }

      providerIndexRef.current = index;
      tileErrorsRef.current = 0;

      const layer = createWeatherLayer(WEATHER_PROVIDERS[index]);
      layer.on('tileerror', () => {
        tileErrorsRef.current += 1;
        if (tileErrorsRef.current < ERROR_THRESHOLD) return;

        const nextIndex = providerIndexRef.current + 1;
        if (nextIndex < WEATHER_PROVIDERS.length) {
          mountProvider(nextIndex);
        } else if (layerRef.current) {
          map.removeLayer(layerRef.current);
          layerRef.current = null;
        }
      });

      layer.addTo(map);
      layerRef.current = layer;
    }

    if (!enabled) {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      return undefined;
    }

    mountProvider(0);

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [enabled, map]);

  return null;
}
