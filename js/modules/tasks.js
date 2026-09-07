/*
 * PersonalOS — js/modules/tasks.js
 * ----------------------------------------------------------------------
 * Tasks module — the first "app" (Spec §8).
 *
 * Registers itself with the central module registry at import time.
 * The WM core never references this file — it only sees the definition
 * exposed via the registry, so adding this module required zero WM
 * changes: just this file + registration.
 *
 * Behaviour (Spec §8 "First Module" + §2):
 *   - Embedded title (Nerd Font icon + name) rendered inside the
 *     window's content — the WM provides no chrome (Spec §2).
 *   - Checkbox-style items: check to mark complete (struck through).
 *   - Add via the input (button or Enter key), remove via the × button.
 *   - Items persist under state.moduleData.tasks through the
 *     persistence context the WM hands to mount() (Spec §9).
 */

import { registerModule } from '../modules.js';

const TASKS_ICON = '\uf14a'; // Nerd Font / Font Awesome check-square

function mount(container, context) {
  // restore this module's own data slice (Spec §9)
  let items = context.load()?.items ?? [];
  let nextItemId = items.reduce((max, it) => Math.max(max, it.id), 0) + 1;

  const persist = () => context.persist({ items });

  /* ---- embedded title: icon + module name (Spec §2) ---- */
  const title = document.createElement('div');
  title.className = 'module-title';
  const titleIcon = document.createElement('span');
  titleIcon.className = 'module-title-icon';
  titleIcon.textContent = TASKS_ICON;
  const titleName = document.createElement('span');
  titleName.textContent = 'Tasks';
  title.append(titleIcon, titleName);

  /* ---- add row ---- */
  const addRow = document.createElement('div');
  addRow.className = 'tasks-add';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'new task…';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = '+';
  addRow.append(input, addBtn);

  /* ---- item list ---- */
  const list = document.createElement('ul');
  list.className = 'tasks-list';

  function renderList() {
    list.innerHTML = '';
    for (const item of items) {
      const li = document.createElement('li');
      li.className = item.done ? 'task-item done' : 'task-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = item.done;
      checkbox.addEventListener('change', () => {
        item.done = checkbox.checked;
        persist();
        renderList();
      });

      const text = document.createElement('span');
      text.className = 'task-text';
      text.textContent = item.text;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'task-remove';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        items = items.filter((t) => t.id !== item.id);
        persist();
        renderList();
      });

      li.append(checkbox, text, removeBtn);
      list.appendChild(li);
    }
  }

  function addItem() {
    const text = input.value.trim();
    if (!text) return;
    items = [...items, { id: nextItemId++, text, done: false }];
    input.value = '';
    persist();
    renderList();
  }

  addBtn.addEventListener('click', addItem);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addItem();
  });

  container.append(title, addRow, list);
  renderList();
}

function unmount(container) {
  container.innerHTML = ''; // listeners die with the elements
}

const tasksModule = {
  id: 'tasks',
  name: 'Tasks',
  icon: TASKS_ICON,
  mount,
  unmount,
};

registerModule(tasksModule);

export default tasksModule;
