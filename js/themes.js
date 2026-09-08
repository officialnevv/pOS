/*
 * pOS — js/themes.js
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
 * Append-only theme registry (Spec §6) — structured like the module
 * registry: adding a theme = appending one entry here, no other file
 * changes. Each theme defines the 5 core colors:
 *   bg (background), fg (text), accent, border (focus-highlight),
 *   accentSecondary.
 * All values are the canonical, well-documented palette colors for
 * each scheme.
 */
export const THEMES = [
  {
    id: 'everforest',
    name: 'Everforest',
    colors: {
      bg: '#2d353b',
      fg: '#d3c6aa',
      accent: '#a7c080',
      border: '#4b5559',
      accentSecondary: '#e69875',
    },
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox',
    colors: {
      bg: '#282828',
      fg: '#ebdbb2',
      accent: '#fabd2f',
      border: '#504945',
      accentSecondary: '#fe8019',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    colors: {
      bg: '#2e3440',
      fg: '#d8dee9',
      accent: '#88c0d0',
      border: '#434c5e',
      accentSecondary: '#81a1c1',
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    colors: {
      bg: '#282a36',
      fg: '#f8f8f2',
      accent: '#bd93f9',
      border: '#44475a',
      accentSecondary: '#ff79c6',
    },
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    colors: {
      bg: '#1e1e2e',
      fg: '#cdd6f4',
      accent: '#cba6f7',
      border: '#45475a',
      accentSecondary: '#f5c2e7',
    },
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    colors: {
      bg: '#002b36',
      fg: '#93a1a1',
      accent: '#2aa198',
      border: '#073642',
      accentSecondary: '#b58900',
    },
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    colors: {
      bg: '#fdf6e3',
      fg: '#657b83',
      accent: '#268bd2',
      border: '#eee8d5',
      accentSecondary: '#cb4b16',
    },
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    colors: {
      bg: '#1a1b26',
      fg: '#a9b1d6',
      accent: '#7aa2f7',
      border: '#292e42',
      accentSecondary: '#bb9af7',
    },
  },
  {
    id: 'one-dark',
    name: 'One Dark',
    colors: {
      bg: '#282c34',
      fg: '#abb2bf',
      accent: '#61afef',
      border: '#3e4451',
      accentSecondary: '#98c379',
    },
  },
  {
    id: 'rose-pine',
    name: 'Rosé Pine',
    colors: {
      bg: '#191724',
      fg: '#e0def4',
      accent: '#ebbcba',
      border: '#26233a',
      accentSecondary: '#c4a7e7',
    },
  },
  {
    id: 'monokai',
    name: 'Monokai',
    colors: {
      bg: '#272822',
      fg: '#f8f8f2',
      accent: '#a6e22e',
      border: '#49483e',
      accentSecondary: '#fd971f',
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
