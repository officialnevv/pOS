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

/**
 * Append-only theme registry. Placeholder default entry; the full
 * canonical palettes will be filled in during implementation.
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
 * Apply a theme by id (placeholder — real logic TBD).
 * Will set CSS custom properties / data-theme attribute on <body>.
 */
export function applyTheme(themeId) {
  // TODO: look up theme in THEMES, apply its colors as CSS vars.
  return themeId;
}

/** Get a single theme by id (or undefined). */
export function getTheme(themeId) {
  return THEMES.find((t) => t.id === themeId);
}

/** All registered themes, for the theme picker popup. */
export function getAllThemes() {
  return THEMES;
}
