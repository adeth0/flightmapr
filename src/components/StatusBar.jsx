import { useState, useEffect } from 'react';

// Format the current time in the user's local timezone.
// Shows "HH:MM:SS TZ" — e.g. "14:35:22 BST" for someone in the UK.
function localTime() {
  const d  = new Date();
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  // Extract short timezone name (e.g. "BST", "GMT", "EST")
  const tz = d.toLocaleTimeString('en-GB', { timeZoneName: 'short' }).split(' ').pop() || '';
  return `${hh}:${mm}:${ss}${tz ? ' ' + tz : ''}`;
}

export function StatusBar({ flightCount, dataSource }) {
  const [time, setTime] = useState(localTime());

  useEffect(() => {
    const id = setInterval(() => setTime(localTime()), 1000);
    return () => clearInterval(id);
  }, []);

  const isLive    = dataSource === 'live';
  const isLoading = dataSource === 'loading';
  const isUnavail = dataSource === 'unavailable';
  const srcLabel  = isLive ? 'ADS-B Live' : isLoading ? 'Connecting…' : 'Unavailable';
  const srcColor  = isLive ? 'text-emerald-400' : isUnavail ? 'text-red-400' : 'text-white/40';

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
        {/* Local time — no more UTC offset confusion */}
        <Stat label="Time" value={time} className="hidden sm:flex" />
      </div>

      <div
        className="glass rounded-xl px-3 sm:px-4 py-1.5 flex items-center gap-2 sm:gap-3"
        style={{ pointerEvents: 'auto' }}
      >
        <a
          href="https://donate.stripe.com/8x27sMaIf3Cm5O0gFEc7u00"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] font-semibold text-[#00ffcc]/60 hover:text-[#00ffcc] transition-colors whitespace-nowrap"
        >
          Support FlightMapr ✈️
        </a>
        <span className="text-white/15 hidden sm:inline text-[10px]">·</span>
        <span className="text-[10px] text-white/25 hidden sm:inline">
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
