/*
 * pOS — js/modules/dashboard.js
 * ----------------------------------------------------------------------
 * Dashboard module — a read-only summary of every other module (Spec §8).
 *
 * This is the one module that breaks the self-containment rule, on
 * purpose: it reads the other modules' slices directly via
 * persistence.getModuleData() rather than keeping data of its own. It
 * never writes to them, and it has no moduleData slice of its own — the
 * summary is a snapshot taken at mount, and without a cross-module event
 * bus it doesn't live-update.
 *
 * Cards are clickable and launch/focus their module via
 * context.openModule (the same singleton-aware path the launcher uses).
 * The module also re-opens itself into workspace 1 on every page load
 * (bootstrap check in wm-core.js).
 */

import { registerModule, getModule } from '../modules.js';
import { getModuleData } from '../persistence.js';

const DASHBOARD_ICON = '\uf0e4'; // nf-fa-tachometer

// priority ranking for the "highest-priority open task" summary
// (same scale as the Tasks module)
const TASK_PRIORITY_RANK = { high: 3, medium: 2, low: 1, none: 0 };

// one summary builder per module — reads its slice (never writes) and
// returns { primary, preview? }: the headline line plus an optional
// muted secondary. A slice that was never saved gets the same empty
// state as an empty one.
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

/* ---- charts: hand-built inline SVG (no libraries, sharp corners) ---- */

const SVG_NS = 'http://www.w3.org/2000/svg';
const DAY_MS = 86400000;
const CHART_ROW_CAP = 5; // max rows in a horizontal bar chart

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  return el;
}

// a chart card: muted label, with content appended by the caller
function chartCard(labelText) {
  const wrap = document.createElement('div');
  wrap.className = 'dashboard-chart';
  const label = document.createElement('div');
  label.className = 'dashboard-chart-label';
  label.textContent = labelText;
  wrap.appendChild(label);
  return wrap;
}

function chartEmpty(wrap, text) {
  const empty = document.createElement('div');
  empty.className = 'dashboard-chart-empty';
  empty.textContent = text;
  wrap.appendChild(empty);
}

// midnight (local) of the day a timestamp falls in
function dayStart(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

// one bucket per day over the last 7 days (oldest -> today), trimmed to
// start at the first day that has data — a fresh install has no history
// to fabricate. Returns null when there is no data at all.
function dayBuckets(timestamps) {
  const today = dayStart(Date.now());
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const start = today - i * DAY_MS;
    days.push({
      count: timestamps.filter((ts) => ts >= start && ts < start + DAY_MS).length,
      label: new Date(start).toLocaleDateString('en-US', { weekday: 'short' }),
    });
  }
  const first = days.findIndex((day) => day.count > 0);
  return first === -1 ? null : days.slice(first);
}

// vertical bar chart, one bar per day (height = count, weekday label
// under each bar); zero-count days get a label but no bar
function dayBarChart(days) {
  const width = 140;
  const plotHeight = 56;
  const height = plotHeight + 10; // room for the day labels below
  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'dashboard-chart-svg',
  });
  const max = Math.max(...days.map((day) => day.count), 1);
  const slot = width / days.length;
  const barWidth = Math.min(18, slot * 0.6);
  days.forEach((day, i) => {
    const barHeight = Math.round((day.count / max) * (plotHeight - 4));
    if (day.count > 0) {
      svg.appendChild(svgEl('rect', {
        x: Math.round(i * slot + (slot - barWidth) / 2),
        y: plotHeight - barHeight,
        width: Math.round(barWidth),
        height: barHeight,
        class: 'chart-bar',
      }));
    }
    const label = svgEl('text', {
      x: Math.round(i * slot + slot / 2),
      y: height - 2,
      'text-anchor': 'middle',
      class: 'chart-label',
    });
    label.textContent = day.label;
    svg.appendChild(label);
  });
  return svg;
}

// horizontal bar chart, one row per entry: label over a bar whose width
// is value relative to the row max, value at the right end
function hBarChart(rows) {
  const width = 150;
  const rowHeight = 22;
  const height = rows.length * rowHeight;
  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'dashboard-chart-svg',
  });
  const max = Math.max(...rows.map((row) => row.value), 1);
  const plotWidth = width - 24; // room for the value text at the right
  rows.forEach((row, i) => {
    const y = i * rowHeight;
    const maxLabelChars = 20;
    const label = svgEl('text', { x: 0, y: y + 8, class: 'chart-label' });
    label.textContent = row.label.length > maxLabelChars
      ? row.label.slice(0, maxLabelChars - 1) + '…'
      : row.label;
    svg.appendChild(label);
    svg.appendChild(svgEl('rect', {
      x: 0,
      y: y + 12,
      width: Math.round((plotWidth * row.value) / max),
      height: 8,
      class: 'chart-bar',
    }));
    const value = svgEl('text', {
      x: width,
      y: y + 20,
      'text-anchor': 'end',
      class: 'chart-label',
    });
    value.textContent = String(row.value);
    svg.appendChild(value);
  });
  return svg;
}

// "+N more" note under a row-capped chart
function moreNote(count) {
  const note = document.createElement('div');
  note.className = 'dashboard-chart-label';
  note.textContent = `+${count} more`;
  return note;
}

const charts = {
  tasks() {
    const wrap = chartCard('completed — last 7 days');
    const completedAt = (getModuleData('tasks') ?? [])
      .filter((task) => task.done && task.completedAt)
      .map((task) => task.completedAt);
    const days = completedAt.length ? dayBuckets(completedAt) : null;
    if (!days) {
      chartEmpty(wrap, 'no completed tasks in the last 7 days');
      return wrap;
    }
    wrap.appendChild(dayBarChart(days));
    return wrap;
  },

  goals() {
    const wrap = chartCard('progress');
    const active = (getModuleData('goals') ?? []).filter((goal) => !goal.archived);
    if (!active.length) {
      chartEmpty(wrap, 'no active goals');
      return wrap;
    }
    const progress = (goal) =>
      goal.checkpoints.length
        ? Math.round(
            (goal.checkpoints.filter((c) => c.done).length / goal.checkpoints.length) * 100
          )
        : goal.manualProgress;
    const ranked = active
      .map((goal) => ({ title: goal.title, pct: progress(goal) }))
      .sort((a, b) => b.pct - a.pct);
    const shown = ranked.slice(0, CHART_ROW_CAP);
    wrap.appendChild(hBarChart(shown.map((row) => ({ label: row.title, value: row.pct }))));
    if (ranked.length > shown.length) {
      wrap.appendChild(moreNote(ranked.length - shown.length));
    }
    return wrap;
  },

  pomodoro() {
    const wrap = chartCard('work sessions — last 7 days');
    const sessionLog = getModuleData('pomodoro')?.sessionLog ?? [];
    const completedAt = sessionLog.map((session) => session.completedAt);
    const days = completedAt.length ? dayBuckets(completedAt) : null;
    if (!days) {
      chartEmpty(wrap, 'no sessions in the last 7 days');
      return wrap;
    }
    wrap.appendChild(dayBarChart(days));
    return wrap;
  },

  repositories() {
    const wrap = chartCard('by language');
    const data = getModuleData('repositories');
    const repos = Array.isArray(data) ? data : data?.repos;
    if (!repos?.length) {
      chartEmpty(wrap, 'no repos yet');
      return wrap;
    }
    // repos with no detected language (fetch failures, GitHub returning
    // null) group into an "Unknown" bucket instead of being dropped
    const counts = {};
    for (const repo of repos) {
      const language = repo.language || 'Unknown';
      counts[language] = (counts[language] ?? 0) + 1;
    }
    const rows = Object.entries(counts)
      .map(([language, count]) => ({ label: language, value: count }))
      .sort((a, b) => b.value - a.value);
    const shown = rows.slice(0, CHART_ROW_CAP);
    wrap.appendChild(hBarChart(shown));
    if (rows.length > shown.length) {
      wrap.appendChild(moreNote(rows.length - shown.length));
    }
    return wrap;
  },
};

// summary cards in curated order (mirrors the spec's per-module list;
// names/icons come from the module registry, data from the slices)
const SUMMARY_ORDER = [
  'tasks',
  'notes',
  'pomodoro',
  'weather',
  'bookmarks',
  'watchLater',
  'goals',
  'repositories',
];

// bento tier per module: chart-bearing summaries get larger cards
// (see .card-wide/.card-mid in style.css); everything else is 2x1
const CARD_SIZES = {
  tasks: 'card-wide',
  pomodoro: 'card-wide',
  goals: 'card-wide',
  repositories: 'card-wide',
  weather: 'card-mid',
  notes: 'card-mid',
  bookmarks: 'card-mid',
  watchLater: 'card-mid',
};

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
    card.className = `dashboard-card ${CARD_SIZES[moduleId] ?? ''}`.trim();
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
    const chart = charts[moduleId]?.();
    if (chart) card.appendChild(chart);

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