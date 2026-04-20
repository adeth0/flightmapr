// ─────────────────────────────────────────────────────────
//  ThemeToggle — fixed top-right glass capsule toggle.
//
//  Two-state switch (dark / light) with a metallic sliding
//  thumb. Styling + positioning lives in index.css under
//  `.theme-toggle*` so this component stays presentation-thin.
//
//  Behaviour:
//    • Click/tap flips the theme instantly via themeService.
//    • Aria-pressed + aria-label announce current state.
//    • Keyboard-friendly: native <button> handles Enter/Space.
//    • Subscribes to theme changes so external sources (e.g. OS
//      color-scheme follow-through) keep the thumb position
//      in sync.
// ─────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import {
  getTheme,
  toggleTheme,
  subscribeTheme,
  THEMES,
} from '../services/themeService';

export function ThemeToggle() {
  const [theme, setTheme] = useState(() => getTheme());

  useEffect(() => subscribeTheme(setTheme), []);

  const isLight = theme === THEMES.LIGHT;
  const label   = isLight ? 'Switch to dark mode' : 'Switch to light mode';

  return (
    <button
      type="button"
      className={`theme-toggle ${isLight ? 'is-light' : 'is-dark'}`}
      onClick={toggleTheme}
      aria-label={label}
      aria-pressed={isLight}
      title={label}
    >
      <span className="theme-toggle-track">
        <span className="theme-toggle-ic theme-toggle-ic-moon" aria-hidden="true">
          <Moon size={11} strokeWidth={2.4} />
        </span>
        <span className="theme-toggle-ic theme-toggle-ic-sun" aria-hidden="true">
          <Sun size={11} strokeWidth={2.4} />
        </span>
        <span className="theme-toggle-thumb" aria-hidden="true" />
      </span>
    </button>
  );
}

export default ThemeToggle;
