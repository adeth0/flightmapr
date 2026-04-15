import { useState, useEffect } from 'react';

function utcTime() {
  return new Date().toUTCString().slice(17, 25) + ' UTC';
}

export function StatusBar({ flightCount, dataSource }) {
  const [time, setTime] = useState(utcTime());

  useEffect(() => {
    const id = setInterval(() => setTime(utcTime()), 1000);
    return () => clearInterval(id);
  }, []);

  const isLive       = dataSource === 'live';
  const isLoading    = dataSource === 'loading';
  const isUnavail    = dataSource === 'unavailable';
  const srcLabel     = isLive ? 'ADS-B Live' : isLoading ? 'Connecting…' : 'Unavailable';
  const srcColor     = isLive ? 'text-emerald-400' : isUnavail ? 'text-red-400' : 'text-white/40';

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-[900] flex items-center justify-between px-3 sm:px-5 py-2 pb-safe"
      style={{ pointerEvents: 'none' }}
    >
      <div className="glass rounded-xl flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-1.5">
        <Stat label="Tracked" value={flightCount} />
        <div className="w-px h-3 bg-white/10" />
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-widest text-white/25">Source</span>
          <span className={`text-[10px] font-semibold ${srcColor}`}>
            {srcLabel}
          </span>
        </div>
        <div className="w-px h-3 bg-white/10 hidden sm:block" />
        <Stat label="UTC" value={time} className="hidden sm:flex" />
      </div>

      <div className="glass rounded-xl px-3 sm:px-4 py-1.5 hidden sm:block">
        <span className="text-[10px] text-white/25">
          © 2025 FlightMapr · Map © OpenStreetMap / CARTO
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value, className = '' }) {
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <span className="text-[9px] uppercase tracking-widest text-white/25">{label}</span>
      <span className="text-[10px] font-semibold text-white/60">{value}</span>
    </div>
  );
}
