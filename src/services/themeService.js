// ─────────────────────────────────────────────────────────
//  themeService — dual-theme state (graphite / chrome silver)
//
//  Applies `data-theme="dark|light"` to <html> so CSS custom
//  properties under :root and [data-theme="light"] flip.
//  Persists user choice in localStorage, with a graceful
//  fall-back to the system preference for first-time visitors.
//
//  API:
//    initTheme()          — call once at boot (before first paint)
//    getTheme()           — 'dark' | 'light'
//    setTheme(theme)      — explicit set + persist
//    toggleTheme()        — flip dark ↔ light
//    subscribeTheme(fn)   — returns unsubscribe
//
//  Design notes:
//    • No React dependency — works anywhere (even in workers).
//    • Writes inline `color-scheme` so native form controls + the
//      browser's scrollbar match the active theme immediately.
//    • Listens to `prefers-color-scheme` changes only when the
//      user has never made an explicit choice.
// ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'flightmapr_theme_v1';
const DARK  = 'dark';
const LIGHT = 'light';

const listeners = new Set();
let current     = null;   // cached value to avoid repeated storage reads
let initialised = false;

function readStored() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function writeStored(theme) {
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* private mode */ }
}

function systemPref() {
  try {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? LIGHT : DARK;
    }
  } catch { /* no-op */ }
  return DARK;
}

function apply(theme) {
  current = theme === LIGHT ? LIGHT : DARK;
  if (typeof document !== 'undefined' && document.documentElement) {
    const root = document.documentElement;
    root.setAttribute('data-theme', current);
    // Native UI (scrollbars, form controls) picks this up immediately
    root.style.colorScheme = current;
  }
  listeners.forEach(fn => { try { fn(current); } catch { /* swallow */ } });
}

export function getTheme() {
  if (current) return current;
  current = readStored() === LIGHT ? LIGHT : (readStored() === DARK ? DARK : null);
  if (!current) current = DARK; // default per product brief
  return current;
}

export function setTheme(theme) {
  if (theme !== DARK && theme !== LIGHT) return;
  writeStored(theme);
  apply(theme);
}

export function toggleTheme() {
  setTheme(getTheme() === LIGHT ? DARK : LIGHT);
}

export function subscribeTheme(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initTheme() {
  if (initialised) return current;
  initialised = true;

  const stored = readStored();
  const initial = stored === LIGHT ? LIGHT
                : stored === DARK  ? DARK
                : systemPref();
  apply(initial);

  // Respond to OS-level changes only if the user hasn't pinned a choice
  try {
    if (!stored && typeof window !== 'undefined' && window.matchMedia) {
      const mql = window.matchMedia('(prefers-color-scheme: light)');
      const handler = (e) => {
        // Re-check stored value in case the user picked one mid-session
        if (!readStored()) apply(e.matches ? LIGHT : DARK);
      };
      if (mql.addEventListener) mql.addEventListener('change', handler);
      else if (mql.addListener) mql.addListener(handler); // Safari <14
    }
  } catch { /* no-op */ }

  return current;
}

// Convenience named constants for consumers
export const THEMES = Object.freeze({ DARK, LIGHT });
