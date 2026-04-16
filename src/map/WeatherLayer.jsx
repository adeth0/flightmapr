import { Pane, TileLayer } from 'react-leaflet';

const WEATHER_TILE_URL =
  'https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png?appid=cd3e281bc7303afd1c264fb229cfdf05';

export function WeatherLayer({ enabled }) {
  if (!enabled) return null;

  return (
    <Pane name="weather-layer" style={{ zIndex: 330, pointerEvents: 'none' }}>
      <TileLayer
        key="openweather-clouds"
        url={WEATHER_TILE_URL}
        attribution="&copy; OpenWeatherMap"
        pane="weather-layer"
        opacity={0.5}
        tileSize={256}
        updateWhenIdle={false}
        updateWhenZooming={true}
        keepBuffer={2}
        crossOrigin
      />
    </Pane>
  );
}
