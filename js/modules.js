/*
 * pOS — js/modules.js
 * ----------------------------------------------------------------------
 * Central module registry (Spec §8).
 *
 * The window manager core knows nothing about individual modules — it
 * only talks to this registry. Every module (e.g. js/modules/tasks.js)
 * registers itself here at import time by calling registerModule() with:
 *
 *   {
 *     id:        unique string, used for singleton lookup + persistence key,
 *     name:      display name (launcher, embedded window titles),
 *     icon:      Nerd Font glyph (launcher + window title),
 *     mount:     (containerEl, context) => void — inject DOM content,
 *     unmount:   optional (containerEl) => void — tear down timers/listeners,
 *   }
 *
 * Adding a new module later = adding a file under js/modules/ that calls
 * registerModule(), plus one side-effect import in wm-core.js. Zero
 * changes to the WM core or to this registry.
 */

/** id -> module definition */
const registry = new Map();

/**
 * Register a module. Throws on duplicate ids (singleton guarantee, Spec §5).
 */
export function registerModule(module) {
  if (!module || typeof module.id !== 'string' || !module.id) {
    throw new Error('registerModule: module must have a non-empty `id`');
  }
  if (registry.has(module.id)) {
    throw new Error(`registerModule: duplicate module id "${module.id}"`);
  }
  registry.set(module.id, module);
  return module;
}

/** Look up a module by id (or undefined). */
export function getModule(moduleId) {
  return registry.get(moduleId);
}

/** All registered modules, sorted by name — for the launcher list. */
export function getAllModules() {
  return [...registry.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}
