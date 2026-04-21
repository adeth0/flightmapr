// ─────────────────────────────────────────────────────────
//  themeService — UI theme follows the map's day/night state.
//
//  Historically this module exposed a manual dark/light toggle
//  persisted to localStorage. The UX has since changed: the user
//  no longer picks a theme — the UI chrome automatically mirrors
//  whichever tile set the map is showing.
//
//    • dayNightEnabled = true  → NIGHT map → graphite + silver UI
//    • dayNightEnabled = false → DAY map  → chrome + white UI
//
//  We still drive everything through `data-theme="dark|light"` on
//  <html> so the existing CSS custom properties under :root and
//  [data-theme="light"] keep working untouched. In addition we
//  toggle a `dark-mode` class on <body> as a convenience hook for
//  any style that prefers a class selector.
//
//  API:
//    syncThemeWithMap(isNight)  — called from App.jsx whenever
//                                  dayNightEnabled changes.
//    getTheme()                 — current 'dark' | 'light' (read-only).
//    subscribeTheme(fn)         — listen for theme changes.
//    THEMES                     — named constants.
//
//  The legacy `initTheme`, `setTheme`, `toggleTheme` functions are
//  retained as no-op shims so any stale imports elsewhere won't
//  crash the build; they all route through syncThemeWithMap.
// ─────────────────────────────────────────────────────────

const DARK  = 'dark';
const LIGHT = 'light';

const listeners = new Set();
let current = DARK; // default matches product brief (graphite-first)

function apply(theme) {
  current = theme === LIGHT ? LIGHT : DARK;
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    if (root) {
      root.setAttribute('data-theme', current);
      // Native UI (scrollbars, form controls) picks this up immediately
      root.style.colorScheme = current;
    }
    // Convenience class hook for selectors like `body.dark-mode …`
    if (document.body) {
      document.body.classList.toggle('dark-mode',  current === DARK);
      document.body.classList.toggle('light-mode', current === LIGHT);
    }
  }
  listeners.forEach((fn) => { try { fn(current); } catch { /* swallow */ } });
}

// Public: called from App.jsx whenever `dayNightEnabled` flips.
// `isNight === true` → night map → dark UI chrome.
export function syncThemeWithMap(isNight) {
  apply(isNight ? DARK : LIGHT);
}

export function getTheme() {
  return current;
}

export function subscribeTheme(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── Legacy no-op shims ───────────────────────────────────
// Kept so any lingering imports elsewhere in the codebase don't
// break the build while the rest of the app migrates over.
export function initTheme()   { apply(current); return current; }
export function setTheme(t)   { apply(t); }
export function toggleTheme() { apply(current === DARK ? LIGHT : DARK); }

export const THEMES = Object.freeze({ DARK, LIGHT });
