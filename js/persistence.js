/*
 * pOS — js/persistence.js
 * ----------------------------------------------------------------------
 * localStorage persistence.
 *
 * Everything lives under a single JSON key, 'personal-os-state':
 *   { activeWorkspace, activeTheme, workspaces: {...}, moduleData: {...} }
 *
 * Modules persist their own data keyed by module id. Stale moduleData
 * slices whose module is no longer registered are pruned on load (and
 * thus drop out of the blob on the next save), so the persistence shape
 * never accumulates keys for removed modules.
 */

import { getAllModules } from './modules.js';

const STATE_KEY = 'personal-os-state';

/** Drop moduleData slices whose module is no longer registered. */
function pruneModuleData(state) {
  if (!state?.moduleData) return state;
  const known = new Set(getAllModules().map((m) => m.id));
  return {
    ...state,
    moduleData: Object.fromEntries(
      Object.entries(state.moduleData).filter(([id]) => known.has(id))
    ),
  };
}

/** Read + parse the persisted state (or null when absent/corrupt). */
export function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? pruneModuleData(JSON.parse(raw)) : null;
  } catch {
    return null; // corrupt JSON — treat as no saved state
  }
}

/** Persist the full app state as the single JSON blob. */
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

