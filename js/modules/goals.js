/*
 * pOS — js/modules/goals.js
 * ----------------------------------------------------------------------
 * Goals module — goals with categories, target dates and checkpoints.
 *
 * A goal carries a title, an optional description (always visible in the
 * list view), a free-typed category tag (the editor suggests categories
 * already used on this device), an optional target date (display only,
 * no countdown) and an ordered flat checkpoint list. Progress is derived
 * from the checkpoints when any exist (completed/total, not editable) and
 * is a manually stepped 0-100 value otherwise; reaching 100% flags the
 * goal as archived. Archived goals stay in the list, dimmed, and can be
 * un-archived via their pill; a toggle hides them by default. Data
 * persists as an array of goal objects under the module's own
 * moduleData.goals slice (Spec §9); array order is the display order.
 * Entries saved before the extra fields existed are normalized on load.
 */

import { createModuleTitle, registerModule } from '../modules.js';

const GOALS_ICON = '\uf140';  // nf-fa-bullseye
const CHECK_GLYPH = '\uf00c'; // Nerd Font check, drawn inside the checkbox
const CARET_DOWN = '\uf0d7'; // nf-fa-caret_down
const CARET_UP = '\uf0d8';   // nf-fa-caret_up
const STEP = 10;             // manual progress step size

function clampManual(value) {
  return Math.min(100, Math.max(0, Number(value) || 0));
}

function normalizeCheckpoint(cp) {
  return {
    id: typeof cp?.id === 'string' ? cp.id : crypto.randomUUID(),
    label: typeof cp?.label === 'string' ? cp.label : '',
    done: !!cp?.done,
  };
}

// Tolerate old/partial saved entries: missing fields default to no
// category/date/description, no checkpoints and zero manual progress.
function normalize(list) {
  return (Array.isArray(list) ? list : []).map((goal) => ({
    id: typeof goal?.id === 'string' ? goal.id : crypto.randomUUID(),
    title: typeof goal?.title === 'string' ? goal.title : '',
    description: typeof goal?.description === 'string' ? goal.description : '',
    category: typeof goal?.category === 'string' ? goal.category : '',
    targetDate: typeof goal?.targetDate === 'string' ? goal.targetDate : '',
    checkpoints: (Array.isArray(goal?.checkpoints) ? goal.checkpoints : [])
      .map(normalizeCheckpoint),
    manualProgress: clampManual(goal?.manualProgress),
    createdAt: typeof goal?.createdAt === 'number' ? goal.createdAt : Date.now(),
    archived: !!goal?.archived,
  }));
}

function progress(goal) {
  if (goal.checkpoints.length) {
    const done = goal.checkpoints.filter((cp) => cp.done).length;
    return Math.round((done / goal.checkpoints.length) * 100);
  }
  return goal.manualProgress;
}

// any mutation that moves progress to 100 flags the goal as archived;
// un-archiving is always a manual action
function settleArchive(goal) {
  if (progress(goal) === 100) goal.archived = true;
}

// "2027-03-01" -> "by Mar 2027" (display only, no countdown logic)
function formatTarget(iso) {
  const date = new Date(iso + 'T00:00:00');
  return 'by ' + date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function mount(container, context) {
  let goals = normalize(context.load());
  const persist = () => context.persist(goals);

  // view state, deliberately not persisted: which goal's editor is open,
  // and whether archived goals are shown (hidden by default)
  let expanded = null;
  let showArchived = false;

  const title = createModuleTitle(GOALS_ICON, 'Goals');

  // add row (always visible, Notes-style): type a title, Enter or '+'
  const addRow = document.createElement('div');
  addRow.className = 'module-add-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'new goal…';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = '+';
  addRow.append(input, addBtn);

  // archived show/hide toggle (archived goals are hidden by default)
  const filterRow = document.createElement('div');
  filterRow.className = 'goals-filter';
  const filterLabel = document.createElement('span');
  filterLabel.textContent = 'archived:';
  const archivedToggle = document.createElement('button');
  archivedToggle.type = 'button';
  filterRow.append(filterLabel, archivedToggle);

  const list = document.createElement('ul');
  list.className = 'goals-list';

  container.append(title, addRow, filterRow, list);

  /* ---- events ---- */
  addBtn.addEventListener('click', addGoal);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addGoal();
  });
  archivedToggle.addEventListener('click', () => {
    showArchived = !showArchived;
    renderList();
  });

  /* ---- rendering ---- */
  function visibleGoals() {
    return showArchived ? goals : goals.filter((g) => !g.archived);
  }

  function renderList() {
    list.innerHTML = '';
    archivedToggle.textContent = showArchived ? 'hide archived' : 'show archived';
    archivedToggle.classList.toggle('active', showArchived);
    archivedToggle.title = showArchived ? 'hide archived goals' : 'show archived goals';
    if (!goals.length) {
      empty('nothing yet — add a goal above');
      return;
    }
    const visible = visibleGoals();
    if (!visible.length) {
      empty('all goals archived — un-archive one or show archived');
      return;
    }
    for (let i = 0; i < visible.length; i++) {
      list.appendChild(renderGoal(visible[i], i, visible.length));
      if (expanded === visible[i]) list.appendChild(renderEditor(visible[i]));
    }
  }

  function empty(text) {
    const li = document.createElement('li');
    li.className = 'goals-empty';
    li.textContent = text;
    list.appendChild(li);
  }

  function renderGoal(goal, index, visibleCount) {
    const li = document.createElement('li');
    li.className = 'goal-item' + (goal.archived ? ' archived' : '');

    const head = document.createElement('div');
    head.className = 'goal-head';

    const main = document.createElement('div');
    main.className = 'goal-main';

    const titleRow = document.createElement('div');
    titleRow.className = 'goal-titlerow';
    const titleEl = document.createElement('span');
    titleEl.className = 'goal-title';
    titleEl.textContent = goal.title;
    titleRow.appendChild(titleEl);

    if (goal.category) {
      const cat = document.createElement('span');
      cat.className = 'goal-category';
      cat.textContent = goal.category;
      titleRow.appendChild(cat);
    }

    // shown only while archived: click to un-archive (archiving itself
    // is automatic at 100% progress)
    if (goal.archived) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'goal-archived-pill';
      pill.textContent = 'archived';
      pill.title = 'un-archive';
      pill.addEventListener('click', () => {
        goal.archived = false;
        persist();
        renderList();
      });
      titleRow.appendChild(pill);
    }

    main.appendChild(titleRow);

    // description stays visible in the list view (Tasks convention):
    // render it only when non-empty, so goals without one get no empty line
    if (goal.description) {
      const desc = document.createElement('p');
      desc.className = 'goal-desc';
      desc.textContent = goal.description;
      main.appendChild(desc);
    }

    if (goal.targetDate) {
      const target = document.createElement('span');
      target.className = 'goal-target';
      target.textContent = formatTarget(goal.targetDate);
      main.appendChild(target);
    }

    const progressRow = document.createElement('div');
    progressRow.className = 'goal-progress-row';
    const bar = document.createElement('div');
    bar.className = 'goal-progress';
    const fill = document.createElement('div');
    fill.className = 'goal-progress-fill';
    fill.style.width = progress(goal) + '%';
    bar.appendChild(fill);
    const percent = document.createElement('span');
    percent.className = 'goal-percent';
    percent.textContent = progress(goal) + '%';
    progressRow.append(bar, percent);
    main.appendChild(progressRow);

    // checkpoints: nested flat list, plus the always-visible add row at
    // the bottom (present even with zero checkpoints, so adding the
    // first one needs no toggle)
    const cpList = document.createElement('ul');
    cpList.className = 'goal-checkpoints';
    for (const cp of goal.checkpoints) {
      cpList.appendChild(renderCheckpoint(goal, cp));
    }
    cpList.appendChild(renderCheckpointAdd(goal));
    main.appendChild(cpList);

    // no checkpoints: progress is manual, Pomodoro-style stepper
    if (!goal.checkpoints.length) main.appendChild(renderStepper(goal));

    const actions = document.createElement('div');
    actions.className = 'goal-actions';

    const moveUp = document.createElement('button');
    moveUp.type = 'button';
    moveUp.className = 'goal-move';
    moveUp.textContent = CARET_UP;
    moveUp.title = 'move up';
    moveUp.disabled = index === 0;
    moveUp.addEventListener('click', () => moveGoal(goal, -1));
    const moveDown = document.createElement('button');
    moveDown.type = 'button';
    moveDown.className = 'goal-move';
    moveDown.textContent = CARET_DOWN;
    moveDown.title = 'move down';
    moveDown.disabled = index === visibleCount - 1;
    moveDown.addEventListener('click', () => moveGoal(goal, +1));

    const expand = document.createElement('button');
    expand.type = 'button';
    expand.className = 'goal-expand';
    expand.textContent = expanded === goal ? CARET_UP : CARET_DOWN;
    expand.title = expanded === goal ? 'hide details' : 'edit details';
    expand.addEventListener('click', () => {
      expanded = expanded === goal ? null : goal;
      renderList();
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'goal-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'remove goal';
    removeBtn.addEventListener('click', () => {
      goals.splice(goals.indexOf(goal), 1);
      if (expanded === goal) expanded = null;
      persist();
      renderList();
    });

    actions.append(moveUp, moveDown, expand, removeBtn);
    head.append(main, actions);
    li.appendChild(head);
    return li;
  }

  function renderCheckpoint(goal, cp) {
    const li = document.createElement('li');
    li.className = 'goal-checkpoint' + (cp.done ? ' done' : '');

    // custom checkbox: theme-drawn box, NF check glyph when done
    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'goal-check';
    check.textContent = cp.done ? CHECK_GLYPH : '';
    check.title = cp.done ? 'mark uncomplete' : 'mark complete';
    check.addEventListener('click', () => {
      cp.done = !cp.done;
      settleArchive(goal);
      persist();
      renderList();
    });

    const label = document.createElement('span');
    label.className = 'goal-check-label';
    label.textContent = cp.label;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'goal-check-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'remove checkpoint';
    removeBtn.addEventListener('click', () => {
      goal.checkpoints.splice(goal.checkpoints.indexOf(cp), 1);
      settleArchive(goal);
      persist();
      renderList();
    });

    li.append(check, label, removeBtn);
    return li;
  }

  function renderCheckpointAdd(goal) {
    const li = document.createElement('li');
    li.className = 'goal-checkpoint-add';
    const cpInput = document.createElement('input');
    cpInput.type = 'text';
    cpInput.placeholder = 'add checkpoint…';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = '+';
    addBtn.title = 'add checkpoint';
    const add = () => {
      const label = cpInput.value.trim();
      if (!label) return;
      goal.checkpoints.push({ id: crypto.randomUUID(), label, done: false });
      cpInput.value = '';
      persist();
      renderList();
    };
    addBtn.addEventListener('click', add);
    cpInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') add();
    });
    li.append(cpInput, addBtn);
    return li;
  }

  function renderStepper(goal) {
    const wrap = document.createElement('div');
    wrap.className = 'goal-stepper';
    // label on its own line above the controls
    const label = document.createElement('span');
    label.className = 'goal-stepper-label';
    label.textContent = 'progress';
    const row = document.createElement('div');
    row.className = 'goal-step-controls';
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.className = 'goal-step-btn';
    minus.textContent = '\u2212'; // minus sign
    minus.title = 'decrease progress';
    const value = document.createElement('span');
    value.className = 'goal-step-value';
    value.textContent = goal.manualProgress + '%';
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'goal-step-btn';
    plus.textContent = '+';
    plus.title = 'increase progress';
    minus.addEventListener('click', () => {
      goal.manualProgress = Math.max(0, goal.manualProgress - STEP);
      settleArchive(goal);
      persist();
      renderList();
    });
    plus.addEventListener('click', () => {
      goal.manualProgress = Math.min(100, goal.manualProgress + STEP);
      settleArchive(goal);
      persist();
      renderList();
    });
    row.append(minus, value, plus);
    wrap.append(label, row);
    return wrap;
  }

  // per-goal editor: description, category (with suggestions), target date
  function renderEditor(goal) {
    const edit = document.createElement('div');
    edit.className = 'goal-edit';

    const description = document.createElement('textarea');
    description.placeholder = 'description…';
    description.value = goal.description;
    description.addEventListener('input', () => {
      goal.description = description.value;
      persist();
    });

    const catRow = document.createElement('div');
    catRow.className = 'goal-edit-row';
    const catLabel = document.createElement('span');
    catLabel.textContent = 'category';
    const catInput = document.createElement('input');
    catInput.type = 'text';
    catInput.value = goal.category;
    catInput.addEventListener('input', () => {
      goal.category = catInput.value;
      persist();
      renderSuggestions();
    });
    catRow.append(catLabel, catInput);

    // free-typed tag: suggestions are the categories already in use on
    // this device, filtered to what has been typed so far
    const suggestions = document.createElement('div');
    suggestions.className = 'goal-cat-suggestions';
    function renderSuggestions() {
      suggestions.innerHTML = '';
      const typed = catInput.value.trim().toLowerCase();
      for (const used of usedCategories()) {
        if (used.toLowerCase() === typed) continue;
        if (typed && !used.toLowerCase().includes(typed)) continue;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'goal-cat-chip';
        chip.textContent = used;
        chip.addEventListener('click', () => {
          goal.category = used;
          catInput.value = used;
          persist();
          renderList(); // refresh the title pill; the editor re-renders too
        });
        suggestions.appendChild(chip);
      }
    }
    renderSuggestions();

    const dateRow = document.createElement('div');
    dateRow.className = 'goal-edit-row';
    const dateLabel = document.createElement('span');
    dateLabel.textContent = 'target';
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = goal.targetDate;
    dateInput.addEventListener('change', () => {
      goal.targetDate = dateInput.value;
      persist();
      renderList();
    });
    dateRow.append(dateLabel, dateInput);

    edit.append(description, catRow, suggestions, dateRow);
    return edit;
  }

  function usedCategories() {
    return [...new Set(goals.map((g) => g.category).filter(Boolean))];
  }

  // manual reordering: array order IS the display order, so moving a
  // goal swaps its position with the neighbouring *visible* goal
  // (filter-aware: with archived goals hidden, the goal moves past the
  // nearest entry that is actually on screen)
  function moveGoal(goal, dir) {
    const visible = visibleGoals();
    const neighbor = visible[visible.indexOf(goal) + dir];
    if (!neighbor) return; // already at the edge of the (visible) list
    const from = goals.indexOf(goal);
    const to = goals.indexOf(neighbor);
    [goals[from], goals[to]] = [goals[to], goals[from]];
    persist();
    renderList();
  }

  function addGoal() {
    const titleText = input.value.trim();
    if (!titleText) return;
    goals.push(normalize([{ title: titleText }])[0]);
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
  id: 'goals',
  name: 'Goals',
  icon: GOALS_ICON,
  mount,
  unmount,
});