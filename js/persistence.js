/*
 * PersonalOS — js/persistence.js
 * ----------------------------------------------------------------------
 * localStorage persistence (Spec §9).
 *
 * Will eventually contain:
 *   - STATE_KEY = 'personal-os-state' — the single JSON key holding
 *     everything: activeWorkspace, activeTheme, per-workspace layout
 *     state (layoutMode, masterRatio, windows[]), and moduleData
 *     (keyed by module ID, owned by the modules themselves).
 *   - loadState(): read + JSON.parse + shape-validate/merge defaults,
 *     called once on page load before the WM initializes.
 *   - saveState(state): JSON.stringify + write, called on every
 *     meaningful change (window open/close/move/resize, workspace
 *     switch, theme change, module data updates).
 *   - patchModuleData(moduleId, data): helper letting modules persist
 *     their own slice of state under `moduleData` without knowing the
 *     overall shape.
 */

const STATE_KEY = 'personal-os-state';

/**
 * Load persisted state from localStorage (placeholder — real logic TBD).
 * Returns null until the real shape/defaults logic is implemented.
 */
export function loadState() {
  // TODO: read STATE_KEY, parse, validate, merge with defaults.
  return null;
}

/**
 * Persist the full app state (placeholder — real logic TBD).
 */
export function saveState(state) {
  // TODO: JSON.stringify(state) -> localStorage.setItem(STATE_KEY, ...).
  return state;
}

/**
 * Persist one module's data slice under `moduleData` (placeholder).
 */
export function patchModuleData(moduleId, data) {
  // TODO: load current state, merge moduleData[moduleId], save.
  return { moduleId, data };
}
