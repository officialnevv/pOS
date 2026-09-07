/*
 * PersonalOS — js/themes.js
 * ----------------------------------------------------------------------
 * Theme definitions and switching (Spec §6).
 *
 * Will eventually contain:
 *   - THEMES: an append-only registry of theme objects. Each theme has:
 *       { id, name, colors: { bg, fg, accent, border, accentSecondary } }
 *     shipped themes: Everforest (default), Gruvbox, Nord, Dracula,
 *     Catppuccin Mocha, Solarized Dark/Light, Tokyo Night, One Dark,
 *     Rosé Pine, Monokai.
 *   - applyTheme(id): writes the theme's colors as CSS custom properties
 *     onto the root (or toggles a data-theme attribute) so all styling
 *     via var(--color-*) updates instantly.
 *   - getTheme(id) / getAllThemes() helpers for the theme picker popup.
 *
 * Adding a new theme = appending one entry here. No other file changes.
 */

/** Default theme used on first load and as a fallback. */
export const DEFAULT_THEME_ID = 'everforest';

/**
 * Append-only theme registry. Everforest dark (canonical palette).
 */
export const THEMES = [
  {
    id: 'everforest',
    name: 'Everforest',
    colors: {
      bg: '#2d353b',
      fg: '#d3c6aa',
      accent: '#a7c080',
      border: '#475258',
      accentSecondary: '#e69875',
    },
  },
];

/**
 * Apply a theme by id: writes its 5 core colors as CSS custom
 * properties on the root element (<html>) and mirrors the theme id as
 * a data-theme attribute for any attribute-based styling hooks.
 * Falls back to the default theme if the id is unknown.
 */
export function applyTheme(themeId) {
  const theme = getTheme(themeId) ?? getTheme(DEFAULT_THEME_ID);
  const root = document.documentElement;

  root.style.setProperty('--color-bg', theme.colors.bg);
  root.style.setProperty('--color-fg', theme.colors.fg);
  root.style.setProperty('--color-accent', theme.colors.accent);
  root.style.setProperty('--color-border', theme.colors.border);
  root.style.setProperty('--color-accent-secondary', theme.colors.accentSecondary);
  root.dataset.theme = theme.id;

  return theme.id;
}

/** Get a single theme by id (or undefined). */
export function getTheme(themeId) {
  return THEMES.find((t) => t.id === themeId);
}

/** All registered themes, for the theme picker popup. */
export function getAllThemes() {
  return THEMES;
}
