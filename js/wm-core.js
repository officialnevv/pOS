/*
 * PersonalOS — js/wm-core.js
 * ----------------------------------------------------------------------
 * Window manager core + app bootstrap (entry point).
 *
 * This file is the generic tiling-WM shell (Spec §3–5, §10–11). It knows
 * nothing about individual modules — it only consumes the registry
 * (modules.js), themes (themes.js), and persistence (persistence.js).
 * Individual modules are pulled in as side-effect imports below so they
 * register themselves at load time.
 *
 * Will eventually contain:
 *   - Workspace state: 9 workspaces, each with its own open windows,
 *     layout mode (master-stack / dwindle), masterRatio, and dwindle
 *     split state (Spec §3–4).
 *   - Tiling engines: master-stack (55/45 default, adjustable) and
 *     Hyprland-style dwindle BSP, with live reflow on open/close/swap.
 *   - Window lifecycle: launch (singleton-aware via the registry),
 *     close (Alt+Q), promote to master (Alt+W), toggle floating
 *     (Alt+V, detaches in place), fullscreen overlay (Alt+F).
 *   - Keybind handling (Alt+H/J/K/L focus, Alt+Shift+H/J/K/L resize,
 *     Alt+1..9 workspaces, Alt+Enter launcher — all with
 *     event.preventDefault(), Spec §10).
 *   - Mouse behavior: focus-follows-hover, Alt+LeftClick drag
 *     (move/swap), Alt+RightClick drag (resize/ratio, with
 *     contextmenu suppressed, Spec §11).
 *   - Shell chrome: live top-bar clock/date, workspace indicator pill
 *     (slots 1-3 always, 4-9 when non-empty), empty-workspace hint.
 *   - Popups: module launcher (Alt+Enter, fuzzy filter) and theme
 *     picker — both rendered by this core but driven by modules.js /
 *     themes.js registries.
 *   - Init: load persisted state (persistence.js), apply saved theme,
 *     restore windows, start clock.
 */

// Side-effect imports: modules register themselves with the registry.
import './themes.js';
import './persistence.js';
import './modules.js';
import './modules/tasks.js';

// Registry/theme/persistence APIs used during init (real usage TBD).
import { DEFAULT_THEME_ID, applyTheme } from './themes.js';
import { loadState } from './persistence.js';

/* ---------------------------------------------------------------
   Top bar clock (Spec §2) — live date (center) + time (right).
   Part of the shell chrome, not the WM proper.
   --------------------------------------------------------------- */

const DATE_OPTS = { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' };

function tickClock() {
  const now = new Date();
  const dateEl = document.getElementById('top-bar-center');
  const timeEl = document.getElementById('top-bar-right');
  if (dateEl) dateEl.textContent = now.toLocaleDateString('en-GB', DATE_OPTS).replace(/,/g, '');
  if (timeEl) timeEl.textContent = now.toLocaleTimeString('en-GB', { hour12: false });
}

function startClock() {
  tickClock();
  setInterval(tickClock, 1000);
}

/**
 * App bootstrap (placeholder — real init logic TBD).
 * Will: restore state, apply theme, rebuild workspaces/windows,
 * bind keybinds + mouse handlers.
 * Currently: applies the theme and starts the top-bar clock.
 */
function init() {
  const restored = loadState();
  applyTheme(restored?.activeTheme ?? DEFAULT_THEME_ID);
  startClock();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
