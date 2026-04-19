// ─────────────────────────────────────────────────────────
//  AirlineLogo
//  High-quality airline logo with a graceful letter-badge
//  fallback. Always renders a fixed-size square so row
//  heights stay consistent even before the CDN image loads.
//
//  Strategy:
//    1. Derive IATA + brand colours from airlineLogoService.
//    2. Attempt <img> against pics.avs.io/{w}/{h}/{IATA}.png.
//    3. On error (404 / offline / blocked), swap to a tinted
//       two-letter badge that matches the Sidebar's existing
//       AirlineBadge language so the fallback feels native.
// ─────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { getAirlineBrand } from '../services/airlineLogoService';

export function AirlineLogo({ callsign, airline, size = 32, rounded = 'rounded-lg' }) {
  const brand = useMemo(
    () => getAirlineBrand(callsign, airline, { w: Math.max(64, size * 2), h: Math.max(24, size) }),
    [callsign, airline, size],
  );
  const [broken, setBroken] = useState(false);

  const showImage = brand.logoUrl && !broken;

  if (showImage) {
    return (
      <div
        className={`airline-logo ${rounded} flex-shrink-0`}
        style={{ width: size, height: size }}
        title={airline || brand.iata || ''}
      >
        <img
          src={brand.logoUrl}
          alt={airline || brand.iata || 'Airline logo'}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setBroken(true)}
          className="w-full h-full object-contain"
        />
      </div>
    );
  }

  return (
    <div
      className={`airline-logo-fallback ${rounded} flex-shrink-0`}
      style={{
        width: size,
        height: size,
        background: `hsla(${brand.hue}, 65%, 30%, 0.35)`,
        border:     `1px solid hsla(${brand.hue}, 65%, 55%, 0.45)`,
        color:      `hsl(${brand.hue}, 80%, 75%)`,
        fontSize:   Math.max(9, Math.round(size * 0.32)),
      }}
      title={airline || brand.iata || ''}
      aria-label={airline || brand.iata || 'Airline'}
    >
      {brand.initials || '✈'}
    </div>
  );
}
