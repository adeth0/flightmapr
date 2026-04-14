export function GlassCard({ children, className = '', onClick }) {
  return (
    <div
      className={`glass rounded-2xl ${onClick ? 'cursor-pointer hover:border-[rgba(0,255,204,0.25)] transition-colors' : ''} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export function StatChip({ label, value, unit }) {
  return (
    <div className="glass-lighter rounded-xl px-3 py-2.5 flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-widest text-white/40 font-medium">{label}</span>
      <span className="text-sm font-semibold text-white">
        {value}
        {unit && <span className="text-white/40 text-xs ml-1">{unit}</span>}
      </span>
    </div>
  );
}

export function Divider() {
  return <div className="w-full h-px bg-white/5 my-1" />;
}
