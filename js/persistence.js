/*
 * PersonalOS — js/persistence.js
 * ----------------------------------------------------------------------
 * localStorage persistence (Spec §9).
 *
 * Everything lives under a single JSON key, 'personal-os-state':
 *   { activeWorkspace, activeTheme, workspaces: {...}, moduleData: {...} }
 *
 * Right now this module serves the moduleData slice: modules persist
 * their own data keyed by module id (Spec §9 — modules own their data
 * independent of window/layout state). The loadState/saveState hooks
 * for full WM state (windows, workspaces, theme) are in place for the
 * upcoming persistence phase.
 */

const STATE_KEY = 'personal-os-state';

/** Read + parse the persisted state (or null when absent/corrupt). */
export function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // corrupt JSON — treat as no saved state
  }
}

/** Persist the full app state as the single JSON blob (Spec §9). */
export function saveState(state) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable/full — fail silently, app stays usable */
  }
  return state;
}

/** Read one module's data slice (or null). */
export function getModuleData(moduleId) {
  return loadState()?.moduleData?.[moduleId] ?? null;
}

/** Merge + persist one module's data slice under `moduleData`. */
export function setModuleData(moduleId, data) {
  const state = loadState() ?? {};
  state.moduleData = { ...state.moduleData, [moduleId]: data };
  saveState(state);
  return data;
}

