/*
 * pOS — js/modules/dashboard.js
 * ----------------------------------------------------------------------
 * Dashboard module — a read-only summary of every other module (Spec §8).
 *
 * ARCHITECTURE EXCEPTION (explicit, documented in AGENT.md): every other
 * module is self-contained and touches only its own moduleData slice.
 * The Dashboard is inherently a cross-cutting overview, so it READS the
 * other modules' slices directly via persistence.getModuleData() — but
 * it NEVER writes to them, and it keeps no moduleData of its own: it is
 * a pure read view. The summary is a snapshot taken at mount time; there
 * is no cross-module event bus, so it does not live-update.
 *
 * Each summary card is clickable and launches/focuses that module via
 * context.openModule — the WM-provided, singleton-aware launch hook
 * (same path as the module launcher). The module also re-opens itself
 * into workspace 1 on every page load (bootstrap check in wm-core.js).
 */

import { registerModule, getModule } from '../modules.js';
import { getModuleData } from '../persistence.js';

const DASHBOARD_ICON = '\uf0e4'; // nf-fa-tachometer

// priority ranking for the "highest-priority open task" summary
// (same scale as the Tasks module)
const TASK_PRIORITY_RANK = { high: 3, medium: 2, low: 1, none: 0 };

// local calendar date as YYYY-MM-DD (the Agenda module's date format)
function todayIso() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

// one summary builder per module: reads that module's slice (READ-ONLY)
// and returns { primary, preview? } — primary is the headline line,
// preview an optional muted secondary line. Never-used slices (null)
// get the same sensible empty state as empty ones.
const summaries = {
  tasks() {
    const open = (getModuleData('tasks') ?? []).filter((task) => !task.done);
    if (!open.length) return { primary: 'no open tasks' };
    const top = open.reduce((best, task) =>
      TASK_PRIORITY_RANK[task.priority] > TASK_PRIORITY_RANK[best.priority]
        ? task
        : best);
    return { primary: `${open.length} open`, preview: top.text };
  },

  notes() {
    const data = getModuleData('notes');
    const notes = Array.isArray(data) ? data : data?.notes;
    return { primary: notes?.length ? `${notes.length} notes` : 'no notes yet' };
  },

  pomodoro() {
    // The Pomodoro is a live session timer that deliberately persists
    // nothing (Spec §9), so a running session is invisible here.
    return { primary: 'idle' };
  },

  weather() {
    const weather = getModuleData('weather');
    if (!weather?.city) return { primary: 'no city set' };
    const temp = weather.forecast?.current?.temperature;
    return {
      primary: weather.city,
      preview: temp == null ? undefined : `${Math.round(temp)}°C`,
    };
  },

  agenda() {
    const entries = getModuleData('agenda') ?? [];
    const upcoming = entries
      .map((entry) => entry.date)
      .filter((date) => date >= todayIso())
      .sort();
    if (!upcoming.length) return { primary: 'nothing scheduled' };
    const entry = entries.find((e) => e.date === upcoming[0]);
    return { primary: entry.date, preview: entry.note };
  },

  bookmarks() {
    const count = (getModuleData('bookmarks') ?? []).length;
    return { primary: count ? `${count} saved` : 'no bookmarks yet' };
  },

  watchLater() {
    const unwatched = (getModuleData('watchLater') ?? []).filter((e) => !e.watched);
    return {
      primary: unwatched.length ? `${unwatched.length} to watch` : 'all caught up',
    };
  },

  goals() {
    const active = (getModuleData('goals') ?? []).filter((goal) => !goal.archived);
    if (!active.length) return { primary: 'no active goals' };
    const progress = (goal) =>
      goal.checkpoints.length
        ? Math.round(
            (goal.checkpoints.filter((c) => c.done).length / goal.checkpoints.length) * 100
          )
        : goal.manualProgress;
    const top = active.reduce((best, goal) =>
      progress(goal) > progress(best) ? goal : best);
    return {
      primary: `${active.length} active`,
      preview: `${top.title} — ${progress(top)}%`,
    };
  },

  repositories() {
    // slice shape: a bare array today; the spec'd star-sync upgrade
    // wraps it as { sync, repos } — read both
    const data = getModuleData('repositories');
    const repos = Array.isArray(data) ? data : data?.repos;
    const count = repos?.length ?? 0;
    return { primary: count ? `${count} saved` : 'no repos yet' };
  },
};

// summary cards in curated order (mirrors the spec's per-module list;
// names/icons come from the module registry, data from the slices)
const SUMMARY_ORDER = [
  'tasks',
  'notes',
  'pomodoro',
  'weather',
  'agenda',
  'bookmarks',
  'watchLater',
  'goals',
  'repositories',
];

function mount(container, context) {
  // embedded title: icon + module name (Spec §2)
  const title = document.createElement('div');
  title.className = 'module-title';
  const titleIcon = document.createElement('span');
  titleIcon.className = 'module-title-icon';
  titleIcon.textContent = DASHBOARD_ICON;
  const titleName = document.createElement('span');
  titleName.textContent = 'Dashboard';
  title.append(titleIcon, titleName);

  const grid = document.createElement('ul');
  grid.className = 'dashboard-grid';

  for (const moduleId of SUMMARY_ORDER) {
    const mod = getModule(moduleId);
    const summary = summaries[moduleId]();

    // clickable card: launches/focuses the module (singleton-aware,
    // same path as the launcher)
    const card = document.createElement('li');
    card.className = 'dashboard-card';
    card.title = `open ${mod.name}`;
    card.addEventListener('click', () => context.openModule(moduleId));

    const head = document.createElement('div');
    head.className = 'dashboard-card-head';
    const icon = document.createElement('span');
    icon.className = 'dashboard-card-icon';
    icon.textContent = mod.icon;
    const name = document.createElement('span');
    name.className = 'dashboard-card-name';
    name.textContent = mod.name;
    head.append(icon, name);

    const primary = document.createElement('div');
    primary.className = 'dashboard-card-primary';
    primary.textContent = summary.primary;

    card.append(head, primary);
    if (summary.preview) {
      const preview = document.createElement('div');
      preview.className = 'dashboard-card-preview';
      preview.textContent = summary.preview;
      card.appendChild(preview);
    }

    grid.appendChild(card);
  }

  container.append(title, grid);
}

registerModule({
  id: 'dashboard',
  name: 'Dashboard',
  icon: DASHBOARD_ICON,
  mount,
});