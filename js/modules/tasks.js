/*
 * PersonalOS — js/modules/tasks.js
 * ----------------------------------------------------------------------
 * Tasks module — the first "app" (Spec §8).
 *
 * A simple to-do list that registers itself with the central module
 * registry at import time. The WM core never references this file
 * directly; it only sees the definition exposed via the registry.
 *
 * Will eventually contain:
 *   - Self-contained rendering: an embedded title (Nerd Font icon +
 *     "Tasks") at the top of the window content, styled to look like
 *     part of the window (no WM-provided chrome — Spec §2).
 *   - Checkbox-style to-do items: check to mark complete, plus basic
 *     add/remove item functionality.
 *   - Own-data persistence: items are stored under
 *     state.moduleData.tasks (Spec §9) via persistence.js helpers,
 *     saved on every add/check/remove and restored on mount.
 *
 * NOTE: as more modules are added, each gets its own file (or folder)
 * under js/modules/ and registers the same way.
 */

import { registerModule } from '../modules.js';

/**
 * Tasks module definition.
 * mount/unmount bodies are placeholders — real logic TBD.
 */
const tasksModule = {
  id: 'tasks',
  name: 'Tasks',
  icon: '\uf274', // Nerd Font checklist glyph (placeholder; final glyph TBD)

  /**
   * Inject the Tasks UI into the given window content container.
   * @param {HTMLElement} container - the window's content area
   * @param {object} context - WM-provided services (persistence, etc.)
   */
  mount(container, context) {
    // TODO: render embedded title + item list + add/remove controls.
    container.dataset.moduleId = this.id;
  },

  /**
   * Optional teardown when the window closes.
   * @param {HTMLElement} container - the window's content area
   */
  unmount(container) {
    // TODO: remove listeners/timers if any are added.
    container.innerHTML = '';
  },
};

registerModule(tasksModule);

export default tasksModule;
