/*
 * pOS — js/modules/tasks.js
 * ----------------------------------------------------------------------
 * Tasks module — a checkbox to-do list (Spec §8, as amended).
 *
 * Registers itself with the module registry at import time; the WM core
 * only ever sees it through the registry. Each task carries a short
 * title, done flag, due date, priority (none/low/medium/high) and an
 * optional description; data persists as an array of those objects
 * under the module's own moduleData.tasks slice (Spec §9). Entries
 * saved before the extra fields existed are normalized on load.
 */

import { registerModule } from '../modules.js';

const TASKS_ICON = '\uf14a';  // Nerd Font check-square
const CHECK_GLYPH = '\uf00c'; // Nerd Font check, drawn inside the checkbox
const CARET_DOWN = '\uf0d7';
const CARET_UP = '\uf077';
const PRIORITIES = ['none', 'low', 'medium', 'high'];

// Tolerate old/partial saved entries: missing fields default to no due
// date, "none" priority and an empty description.
function normalize(list) {
  return (Array.isArray(list) ? list : []).map((it) => ({
    text: typeof it?.text === 'string' ? it.text : '',
    done: !!it?.done,
    dueDate: typeof it?.dueDate === 'string' ? it.dueDate : '',
    priority: PRIORITIES.includes(it?.priority) ? it.priority : 'none',
    description: typeof it?.description === 'string' ? it.description : '',
  }));
}

function mount(container, context) {
  let items = normalize(context.load());
  const persist = () => context.persist(items);

  // view state, deliberately not persisted: which task's editor is
  // open, and the active priority filter
  let expanded = null;
  let filter = 'all';

  // embedded title: icon + module name (Spec §2)
  const title = document.createElement('div');
  title.className = 'module-title';
  const titleIcon = document.createElement('span');
  titleIcon.className = 'module-title-icon';
  titleIcon.textContent = TASKS_ICON;
  const titleName = document.createElement('span');
  titleName.textContent = 'Tasks';
  title.append(titleIcon, titleName);

  // add row
  const addRow = document.createElement('div');
  addRow.className = 'tasks-add';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'new task…';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = '+';
  addRow.append(input, addBtn);

  // priority filter row
  const filterRow = document.createElement('div');
  filterRow.className = 'tasks-filter';
  const filterLabel = document.createElement('span');
  filterLabel.textContent = 'show priority:';
  const filterSelect = document.createElement('select');
  for (const p of ['all', ...PRIORITIES.slice(1)]) {
    const option = document.createElement('option');
    option.value = p;
    option.textContent = p;
    filterSelect.appendChild(option);
  }
  filterSelect.value = 'all';
  filterRow.append(filterLabel, filterSelect);

  const list = document.createElement('ul');
  list.className = 'tasks-list';

  container.append(title, addRow, filterRow, list);

  /* ---- events ---- */
  addBtn.addEventListener('click', addItem);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addItem();
  });
  filterSelect.addEventListener('change', () => {
    filter = filterSelect.value;
    renderList();
  });

  /* ---- rendering ---- */
  function renderList() {
    list.innerHTML = '';
    if (!items.length) {
      empty('nothing yet — add a task above');
      return;
    }
    const visible = filter === 'all'
      ? items
      : items.filter((it) => it.priority === filter);
    if (!visible.length) {
      empty(`no ${filter}-priority tasks`);
      return;
    }
    for (const item of visible) {
      list.appendChild(renderRow(item));
      if (expanded === item) list.appendChild(renderEditor(item));
    }
  }

  function empty(text) {
    const li = document.createElement('li');
    li.className = 'tasks-empty';
    li.textContent = text;
    list.appendChild(li);
  }

  function renderRow(item) {
    const li = document.createElement('li');
    li.className = 'task-item' + (item.done ? ' done' : '');

    // custom checkbox: theme-drawn box, NF check glyph when done
    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'task-check';
    check.textContent = item.done ? CHECK_GLYPH : '';
    check.title = item.done ? 'mark uncomplete' : 'mark complete';
    check.addEventListener('click', () => {
      item.done = !item.done;
      persist();
      renderList();
    });

    const main = document.createElement('div');
    main.className = 'task-main';
    const text = document.createElement('span');
    text.className = 'task-text';
    text.textContent = item.text;
    const meta = document.createElement('div');
    meta.className = 'task-meta';
    if (item.dueDate) {
      const due = document.createElement('span');
      due.className = 'task-due';
      due.textContent = item.dueDate;
      meta.appendChild(due);
    }
    if (item.priority !== 'none') {
      const prio = document.createElement('span');
      prio.className = 'task-priority prio-' + item.priority;
      prio.textContent = item.priority;
      meta.appendChild(prio);
    }
    main.append(text, meta);

    const expand = document.createElement('button');
    expand.type = 'button';
    expand.className = 'task-expand';
    expand.textContent = expanded === item ? CARET_UP : CARET_DOWN;
    expand.title = expanded === item ? 'hide details' : 'edit details';
    expand.addEventListener('click', () => {
      expanded = expanded === item ? null : item;
      renderList();
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'task-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'remove';
    removeBtn.addEventListener('click', () => {
      items.splice(items.indexOf(item), 1);
      if (expanded === item) expanded = null;
      persist();
      renderList();
    });

    li.append(check, main, expand, removeBtn);
    return li;
  }

  function renderEditor(item) {
    const edit = document.createElement('div');
    edit.className = 'task-edit';

    const dueRow = document.createElement('label');
    dueRow.className = 'task-edit-row';
    const dueLabel = document.createElement('span');
    dueLabel.textContent = 'due';
    const dueInput = document.createElement('input');
    dueInput.type = 'date';
    dueInput.value = item.dueDate;
    dueInput.addEventListener('change', () => {
      item.dueDate = dueInput.value;
      persist();
      renderList();
    });
    dueRow.append(dueLabel, dueInput);

    const prioRow = document.createElement('label');
    prioRow.className = 'task-edit-row';
    const prioLabel = document.createElement('span');
    prioLabel.textContent = 'priority';
    const prioSelect = document.createElement('select');
    for (const p of PRIORITIES) {
      const option = document.createElement('option');
      option.value = p;
      option.textContent = p;
      prioSelect.appendChild(option);
    }
    prioSelect.value = item.priority;
    prioSelect.addEventListener('change', () => {
      item.priority = prioSelect.value;
      persist();
      renderList();
    });
    prioRow.append(prioLabel, prioSelect);

    const description = document.createElement('textarea');
    description.placeholder = 'description…';
    description.value = item.description;
    description.addEventListener('input', () => {
      item.description = description.value;
      persist();
    });

    edit.append(dueRow, prioRow, description);
    return edit;
  }

  function addItem() {
    const text = input.value.trim();
    if (!text) return;
    items.push(normalize([{ text }])[0]);
    input.value = '';
    persist();
    renderList();
  }

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

