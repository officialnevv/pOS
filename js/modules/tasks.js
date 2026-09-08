/*
 * pOS — js/modules/tasks.js
 * ----------------------------------------------------------------------
 * Tasks module — a checkbox to-do list (Spec §8).
 *
 * Registers itself with the module registry at import time; the WM core
 * only ever sees it through the registry. Data persists as an array of
 * { text, done } under the module's own moduleData.tasks slice (Spec §9)
 * via the persistence context handed to mount().
 */

import { registerModule } from '../modules.js';

const TASKS_ICON = '\uf14a'; // Nerd Font check-square

function mount(container, context) {
  let items = context.load() ?? [];
  if (!Array.isArray(items)) items = [];

  const persist = () => context.persist(items);

  // embedded title: icon + module name (Spec §2)
  const title = document.createElement('div');
  title.className = 'module-title';
  const titleIcon = document.createElement('span');
  titleIcon.className = 'module-title-icon';
  titleIcon.textContent = TASKS_ICON;
  const titleName = document.createElement('span');
  titleName.textContent = 'Tasks';
  title.append(titleIcon, titleName);

  const addRow = document.createElement('div');
  addRow.className = 'tasks-add';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'new task…';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = '+';
  addRow.append(input, addBtn);

  const list = document.createElement('ul');
  list.className = 'tasks-list';

  function renderList() {
    list.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = 'tasks-empty';
      empty.textContent = 'nothing yet — add a task above';
      list.appendChild(empty);
      return;
    }
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
        items.splice(items.indexOf(item), 1);
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
    items.push({ text, done: false });
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

registerModule({
  id: 'tasks',
  name: 'Tasks',
  icon: TASKS_ICON,
  mount,
  unmount,
});
