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
const CARET_DOWN = '\uf0d7'; // nf-fa-caret_down
const CARET_UP = '\uf0d8';   // nf-fa-caret_up
const SORT_OFF = '\uf0dc';   // nf-fa-sort (due-date sort inactive)
const SORT_ASC = '\uf160';   // nf-fa-sort-amount-asc (soonest due first)
const SORT_DESC = '\uf161';  // nf-fa-sort-amount-desc (latest due first)
const PRIORITIES = ['none', 'low', 'medium', 'high'];

// Tolerate old/partial saved entries: missing fields default to no due
// date, "none" priority, an empty description and no completion time.
function normalize(list) {
  return (Array.isArray(list) ? list : []).map((it) => ({
    text: typeof it?.text === 'string' ? it.text : '',
    done: !!it?.done,
    dueDate: typeof it?.dueDate === 'string' ? it.dueDate : '',
    priority: PRIORITIES.includes(it?.priority) ? it.priority : 'none',
    description: typeof it?.description === 'string' ? it.description : '',
    completedAt: typeof it?.completedAt === 'number' ? it.completedAt : null,
  }));
}

function mount(container, context) {
  let items = normalize(context.load());
  const persist = () => context.persist(items);

  // view state, deliberately not persisted: which task's editor is
  // open, the active priority filter, and the due-date sort direction
  // ('off' | 'asc' | 'desc' — a display-time sort that never rewrites
  // the underlying manual order)
  let expanded = null;
  let filter = 'all';
  let dueSort = 'off';

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

  // due-date sort toggle (display-time: flips soonest-first <-> latest-
  // first; the manual order underneath is never rewritten)
  const sortBtn = document.createElement('button');
  sortBtn.type = 'button';
  sortBtn.className = 'tasks-sort';
  filterRow.append(sortBtn);

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
  sortBtn.addEventListener('click', () => {
    dueSort = dueSort === 'off' ? 'asc' : dueSort === 'asc' ? 'desc' : 'off';
    renderList();
  });

  /* ---- rendering ---- */
  function renderList() {
    list.innerHTML = '';
    sortBtn.textContent =
      dueSort === 'off' ? SORT_OFF : dueSort === 'asc' ? SORT_ASC : SORT_DESC;
    sortBtn.classList.toggle('active', dueSort !== 'off');
    sortBtn.title =
      dueSort === 'off'
        ? 'sort by due date'
        : dueSort === 'asc'
          ? 'sorted by due date — soonest first (click for latest first)'
          : 'sorted by due date — latest first (click to turn sort off)';
    if (!items.length) {
      empty('nothing yet — add a task above');
      return;
    }
    let visible = filter === 'all'
      ? items
      : items.filter((it) => it.priority === filter);
    if (!visible.length) {
      empty(`no ${filter}-priority tasks`);
      return;
    }
    if (dueSort !== 'off') {
      // display-time sort: the underlying manual order is untouched.
      // Undated tasks always sort to the end, in either direction.
      visible = [...visible].sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return dueSort === 'asc'
          ? a.dueDate.localeCompare(b.dueDate)
          : b.dueDate.localeCompare(a.dueDate);
      });
    }
    for (let i = 0; i < visible.length; i++) {
      list.appendChild(renderRow(visible[i], i, visible.length));
      if (expanded === visible[i]) list.appendChild(renderEditor(visible[i]));
    }
  }

  function empty(text) {
    const li = document.createElement('li');
    li.className = 'tasks-empty';
    li.textContent = text;
    list.appendChild(li);
  }

  function renderRow(item, index, visibleCount) {
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
      // completion timestamp feeds the Dashboard's completion-trend chart
      item.completedAt = item.done ? Date.now() : null;
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
    main.append(text);
    // description stays visible in the list view (amendment #3): render it
    // only when non-empty, so tasks without one get no empty line
    if (item.description) {
      const desc = document.createElement('p');
      desc.className = 'task-desc';
      desc.textContent = item.description;
      main.append(desc);
    }
    main.append(meta);

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

    // manual reordering: array order IS the display order, so moving a
    // task swaps its position with the neighbouring *visible* task
    // (filter-aware: with a priority filter active, the task moves past
    // the nearest entry that is actually on screen)
    // manual reordering is disabled while the due-date sort dictates
    // the display order (the underlying manual order is untouched)
    const sorting = dueSort !== 'off';
    const moveUp = document.createElement('button');
    moveUp.type = 'button';
    moveUp.className = 'task-move';
    moveUp.textContent = CARET_UP;
    moveUp.title = sorting
      ? 'manual reorder is off while sorting by due date'
      : 'move up';
    moveUp.disabled = sorting || index === 0;
    moveUp.addEventListener('click', () => moveTask(item, -1));
    const moveDown = document.createElement('button');
    moveDown.type = 'button';
    moveDown.className = 'task-move';
    moveDown.textContent = CARET_DOWN;
    moveDown.title = sorting
      ? 'manual reorder is off while sorting by due date'
      : 'move down';
    moveDown.disabled = sorting || index === visibleCount - 1;
    moveDown.addEventListener('click', () => moveTask(item, +1));

    li.append(check, main, moveUp, moveDown, expand, removeBtn);
    return li;
  }

  function moveTask(item, dir) {
    const visible = filter === 'all'
      ? items
      : items.filter((it) => it.priority === filter);
    const neighbor = visible[visible.indexOf(item) + dir];
    if (!neighbor) return; // already at the edge of the (visible) list
    const from = items.indexOf(item);
    const to = items.indexOf(neighbor);
    if (from === -1 || to === -1) return;
    [items[from], items[to]] = [items[to], items[from]];
    persist();
    renderList();
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

