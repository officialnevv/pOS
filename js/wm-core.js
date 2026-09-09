/*
 * pOS — js/wm-core.js
 * ----------------------------------------------------------------------
 * Entry point + window manager core. A generic shell: it consumes the
 * module registry (modules.js), themes, persistence, and the lock
 * screen, but knows nothing about individual modules. To install one,
 * create js/modules/<name>.js that calls registerModule(), then import
 * it as a side effect below.
 *
 * Data model: 9 workspaces, each with its own windows and dwindle split
 * state (a per-workspace BSP tree). Tiled geometry is derived at render
 * time and never stored; floating geometry and the fullscreen flag live
 * on the window. One global focusedWindowId.
 */

// Side-effect imports: modules register themselves with the registry.
// Tasks and Notes are installed; add more by creating
// js/modules/<name>.js that calls registerModule(), then importing it
// here as a side effect.
import './themes.js';
import './persistence.js';
import './modules.js';
import './modules/tasks.js';
import './modules/notes.js';
import './modules/pomodoro.js';
import './modules/weather.js';
import './modules/bookmarks.js';
import './modules/watchlater.js';
import './modules/goals.js';
import './modules/repositories.js';
import './modules/dashboard.js';
import './modules/shoppingcart.js';

import { DEFAULT_THEME_ID, applyTheme, getAllThemes } from './themes.js';
import { loadState, saveState, getModuleData, setModuleData } from './persistence.js';
import { getAllModules, getModule } from './modules.js';
import { initLockScreen } from './lockscreen.js';

/* ---------- top bar clock ---------- */

const DATE_OPTS = { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' };

function tickClock() {
  const now = new Date();
  document.getElementById('top-pill-center').textContent = now
    .toLocaleDateString('en-GB', DATE_OPTS)
    .replace(/,/g, '');
  const timeEl = document.getElementById('top-pill-right');
  // 12-hour, minutes only; the exact time with seconds goes in the
  // hover tooltip (on the time pill itself), refreshed every tick.
  timeEl.textContent = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  timeEl.title = now.toLocaleTimeString('en-GB', { hour12: false });
}

function startClock() {
  tickClock();
  setInterval(tickClock, 1000);
}

/* ---------- favicon ---------- */

// The static favicon.svg draws the Nerd Font glyph as <text>, but SVG
// favicons render where document fonts may not apply. Once the font is
// loaded, redraw the glyph onto a canvas and swap in a PNG data URL.
const FAVICON_GLYPH = '\uf4ca'; // nf-oct-feed_person
// Neutral mid-gray on transparent: the favicon can't re-theme itself, and
// mid-gray stays legible on both light and dark browser tab bars.
const FAVICON_FG = '#8c8c8c';

function renderFavicon() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, 64, 64); // transparent background
  ctx.fillStyle = FAVICON_FG;
  ctx.font = '48px "Symbols Nerd Font"';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(FAVICON_GLYPH, 32, 34);
  const link = document.querySelector('link[rel="icon"]');
  if (link) link.href = canvas.toDataURL('image/png');
}

function initFavicon() {
  if (document.fonts?.ready) {
    document.fonts.ready.then(renderFavicon);
  } else {
    renderFavicon();
  }
}

/* ---------- state ---------- */

const WORKSPACE_COUNT = 9;
const MIN_SPLIT_RATIO = 0.2;
const MAX_SPLIT_RATIO = 0.8;
const MIN_FLOAT_W = 160;
const MIN_FLOAT_H = 100;
// One gap constant drives both: the workspace edge inset is WINDOW_GAP,
// and internal boundaries take HALF_GAP from each adjacent window, so
// inner gaps come out equal to the outer ones.
const WINDOW_GAP = 12;
const HALF_GAP = WINDOW_GAP / 2;

const state = {
  activeWorkspace: 0,
  workspaces: Array.from({ length: WORKSPACE_COUNT }, () => ({
    windows: [],
    dwindleTree: null, // BSP tree of window ids (dwindle split state)
  })),
};

let focusedWindowId = null;
let nextWindowId = 1;

let workspaceRoot = null;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const currentWorkspace = () => state.workspaces[state.activeWorkspace];
const findWindow = (id) => currentWorkspace().windows.find((w) => w.id === id);
const tiledWindows = (ws) => ws.windows.filter((w) => w.state === 'tiled');

/* ---------- window lifecycle ---------- */

function openWindow(moduleId, workspaceIndex = state.activeWorkspace) {
  const ws = state.workspaces[workspaceIndex];
  const prevFocusId = focusedWindowId;
  const win = {
    id: nextWindowId++,
    moduleId,
    state: 'tiled',
    floatingGeometry: null,
    isFullscreen: false,
  };
  // focus only follows for the active workspace (the Dashboard auto-open
  // targets workspace 1 and must not steal focus from another workspace)
  if (workspaceIndex === state.activeWorkspace) focusedWindowId = win.id;
  // Dwindle: the new window splits the focused window's space. The tree
  // is updated BEFORE the window is pushed, so the window enters the
  // tree exactly once (a tree-less legacy restore is rebuilt from the
  // existing tiled windows first; the very first window just becomes the
  // tree's leaf via treeInsert's null short-circuit).
  ensureDwindleTree(ws);
  const targetId = dwindleSplitTarget(ws, prevFocusId, win.id);
  ws.dwindleTree = treeInsert(
    ws.dwindleTree,
    targetId,
    win.id,
    measureSplitAxis(ws, targetId)
  );
  ws.windows.push(win);
  persistState();
  render();
  return win;
}

/** Singleton-aware launch (Spec §5/§7): if the module is already open
 * anywhere, switch to that workspace and focus it — never duplicate. */
function launchModule(moduleId) {
  for (let i = 0; i < state.workspaces.length; i++) {
    const win = state.workspaces[i].windows.find((w) => w.moduleId === moduleId);
    if (win) {
      if (i !== state.activeWorkspace) switchWorkspace(i);
      focusedWindowId = win.id;
      render();
      return win;
    }
  }
  return openWindow(moduleId);
}

function closeWindow(id) {
  if (id == null) return;
  const ws = currentWorkspace();
  const idx = ws.windows.findIndex((w) => w.id === id);
  if (idx === -1) return;
  const win = ws.windows[idx];
  ws.windows.splice(idx, 1);
  unmountWindow(win); // give the module a chance to tear down (Spec §8)
  if (win.state === 'tiled') {
    ws.dwindleTree = treeRemove(ws.dwindleTree, win.id); // sibling collapses in
  }
  // focus the window that took its place, if any
  focusedWindowId = ws.windows.length
    ? ws.windows[Math.min(idx, ws.windows.length - 1)].id
    : null;
  persistState();
  render(); // empty workspace falls back to the hint (Spec §3/§5)
}

/* ---------- focus ---------- */

function focusWindow(id) {
  if (focusedWindowId === id) return;
  focusedWindowId = id;
  applyFocusClasses();
}

function cycleFocus(step) {
  const ws = currentWorkspace();
  if (!ws.windows.length) return;
  // simple 1-D cycle through the workspace's windows in tiling order
  // (h/k = previous, j/l = next, wrapping)
  const idx = ws.windows.findIndex((w) => w.id === focusedWindowId);
  const next = ((idx === -1 ? 0 : idx + step) + ws.windows.length) % ws.windows.length;
  focusedWindowId = ws.windows[next].id;
  applyFocusClasses();
}

/** Update focused styling in place (no re-render churn). */
function applyFocusClasses() {
  for (const el of workspaceRoot.querySelectorAll('.window')) {
    el.classList.toggle('focused', Number(el.dataset.windowId) === focusedWindowId);
  }
}

/* ---------- window state toggles ---------- */

function toggleFloating(id) {
  const ws = currentWorkspace();
  const win = findWindow(id);
  if (!win || win.isFullscreen) return;
  if (win.state === 'tiled') {
    // Reuse the remembered floating geometry so position survives
    // round-trips through tiling; the first-ever float detaches "in
    // place" from the last tiled rect instead.
    if (!win.floatingGeometry) {
      win.floatingGeometry = win._lastRect ?? { x: 60, y: 60, w: 480, h: 320 };
    }
    win.state = 'floating';
    ws.dwindleTree = treeRemove(ws.dwindleTree, win.id); // collapse the node
  } else {
    win.state = 'tiled';
    // Keep floatingGeometry: it's inert while tiled (tiled geometry is
    // derived at render time) and restores the old floating position on
    // the next Alt+V.
    const targetId = dwindleSplitTarget(ws, focusedWindowId, win.id);
    ws.dwindleTree = treeInsert(
      ws.dwindleTree,
      targetId,
      win.id,
      measureSplitAxis(ws, targetId)
    );
  }
  persistState();
  render();
}

function toggleFullscreen(id) {
  const win = findWindow(id);
  if (!win) return;
  // overlay flag only: tiled slots and floating geometry underneath
  // are untouched, so restoring is exact
  win.isFullscreen = !win.isFullscreen;
  persistState();
  render();
}

/* ---------- tiled window resizing (amendment) ----------
   Two entry points, one behavior. Hovering the shared boundary between
   two adjacent tiles (no Alt needed) shows a resize cursor; Alt+RightClick
   works from anywhere in a tiled window. Every drag parameter is measured
   from the rendered rects at mousedown — the split's on-screen line
   position and which side of it the window sits on — never from tree
   child order (first/second child does not reliably describe left/right
   once a dwindle tree nests). During the drag the split line itself
   follows the mouse 1:1 along its axis: horizontal mouse movement moves
   the nearest vertical (left/right) line above the clicked window,
   vertical movement the nearest horizontal (top/bottom) line, diagonal
   movement both independently — the adjacent sibling window(s) sharing
   each split adjust inversely. There is no anchor/quadrant concept for
   tiled windows; that model is floating-only. */

function subtreeHas(node, id) {
  if (node == null) return false;
  if (typeof node === 'number') return node === id;
  return subtreeHas(node.left, id) || subtreeHas(node.right, id);
}

// pointer distance (px) from a shared boundary at which it can be grabbed
const EDGE_GRAB_PX = 7;

/**
 * Find the adjustable tiled boundary under a root-relative point.
 * Returns { a, b, axis } where axis 'v' = vertical boundary (drag
 * horizontally, col-resize) and 'h' = horizontal boundary, or null.
 * Geometry comes from the rects render() stored on each tiled window.
 */
function findBorderAt(px, py) {
  const ws = currentWorkspace();
  const tiled = tiledWindows(ws);
  if (tiled.length < 2) return null;
  const rects = tiled
    .map((w) => ({ win: w, r: w._lastRect }))
    .filter((x) => x.r);
  for (const { win: a, r: ra } of rects) {
    for (const { win: b, r: rb } of rects) {
      if (a.id === b.id) continue;
      // b directly right of a (a WINDOW_GAP between their edges)?
      if (
        Math.abs(rb.x - (ra.x + ra.w + WINDOW_GAP)) <= 2 &&
        Math.abs(px - (ra.x + ra.w + HALF_GAP)) <= EDGE_GRAB_PX &&
        py >= Math.max(ra.y, rb.y) - EDGE_GRAB_PX &&
        py <= Math.max(ra.y + ra.h, rb.y + rb.h) + EDGE_GRAB_PX
      ) {
        return { a, b, axis: 'v' };
      }
      // b directly below a?
      if (
        Math.abs(rb.y - (ra.y + ra.h + WINDOW_GAP)) <= 2 &&
        Math.abs(py - (ra.y + ra.h + HALF_GAP)) <= EDGE_GRAB_PX &&
        px >= Math.max(ra.x, rb.x) - EDGE_GRAB_PX &&
        px <= Math.max(ra.x + ra.w, rb.x + rb.w) + EDGE_GRAB_PX
      ) {
        return { a, b, axis: 'h' };
      }
    }
  }
  return null;
}

/**
 * Build the shared drag session for resizing a TILED window. The clicked
 * window's ancestor splits are resolved at mousedown, entirely from
 * measured on-screen geometry:
 *
 *   axisV -> the nearest vertical split (a left/right divide) — its line
 *            follows HORIZONTAL mouse movement
 *   axisH -> the nearest horizontal split (a top/bottom divide) — its
 *            line follows VERTICAL mouse movement
 *
 * For each engaged split the session records the split's on-screen line
 * position (container origin + ratio * extent — the same math
 * layoutDwindle renders with) and the window's side of that line,
 * measured from the leaf rect ("is the leaf's left/top edge before or
 * after the line"). During the drag the line itself follows the mouse
 * and the ratio is re-derived from it, so the boundary direction always
 * matches the mouse for every window and tree shape; the sibling side
 * sharing the split adjusts inversely. A null axisV/axisH means no split
 * of that axis exists above the window (e.g. it already spans the
 * workspace edge) and that axis is inert.
 */
function tiledSplitDrag(win, e) {
  const ws = currentWorkspace();
  const leaf = win._lastRect;
  if (!leaf) return null;

  // walk root -> leaf, recording every split node above the window
  const path = [];
  let node = ws.dwindleTree;
  while (node && typeof node !== 'number') {
    path.push(node);
    node = subtreeHas(node.left, win.id) ? node.left : node.right;
  }
  if (!path.length) return null; // single tiled window: nothing to split

  // a split node's container = bounding rect of its subtree's leaves
  // (render-time geometry); the axis comes from the node itself
  const containerOf = (n) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of treeLeaves(n)) {
      const r = ws.windows.find((w) => w.id === id)?._lastRect;
      if (!r) return null;
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w);
      y1 = Math.max(y1, r.y + r.h);
    }
    if (x1 <= x0 || y1 <= y0) return null;
    const w = x1 - x0;
    const h = y1 - y0;
    // the axis comes from the node (frozen at split creation) — the
    // container extent comes from the rendered leaves
    return { x0, y0, w, h, axis: n.axis === 'h' ? 'h' : 'v' };
  };

  // nearest (innermost) ancestor per axis: path runs outermost ->
  // innermost, so scan from the end
  let axisV = null; // vertical boundary -> follows horizontal mouse movement
  let axisH = null; // horizontal boundary -> follows vertical mouse movement
  for (let i = path.length - 1; i >= 0; i--) {
    const n = path[i];
    const c = containerOf(n);
    if (!c) return null;
    if (c.axis === 'v' ? axisV : axisH) continue;
    // the split's on-screen line, measured from the rendered container
    // and the current ratio (identical math to layoutDwindle's split)
    const startLine = c.axis === 'v'
      ? c.x0 + Math.round(c.w * n.ratio)
      : c.y0 + Math.round(c.h * n.ratio);
    // which side of the line the window renders on, measured from the
    // leaf rect (never inferred from which tree child it is): +1 = the
    // window is on the leading side, so its split-adjacent edge is its
    // right/bottom edge; -1 = trailing side, its left/top edge is the line
    const side = c.axis === 'v'
      ? (leaf.x < startLine ? 1 : -1)
      : (leaf.y < startLine ? 1 : -1);
    const info = {
      node: n,
      side, // measured orientation of the dragged window vs the line
      origin: c.axis === 'v' ? c.x0 : c.y0,
      size: Math.max(1, c.axis === 'v' ? c.w : c.h),
      startLine,
    };
    if (c.axis === 'v') axisV = info;
    else axisH = info;
  }
  if (!axisV && !axisH) return null;
  return {
    type: 'splitFollow',
    axisV,
    axisH,
    startX: e.clientX,
    startY: e.clientY,
  };
}

function swapWindows(aId, bId) {
  const ws = currentWorkspace();
  const i = ws.windows.findIndex((w) => w.id === aId);
  const j = ws.windows.findIndex((w) => w.id === bId);
  if (i === -1 || j === -1) return;
  [ws.windows[i], ws.windows[j]] = [ws.windows[j], ws.windows[i]];
  ws.dwindleTree = treeSwap(ws.dwindleTree, aId, bId);
  persistState();
  render();
}

function switchWorkspace(n) {
  state.activeWorkspace = clamp(n, 0, WORKSPACE_COUNT - 1);
  const ws = currentWorkspace();
  focusedWindowId = ws.windows.length
    ? ws.windows[ws.windows.length - 1].id
    : null;
  persistState();
  render();
}

/** Alt+Shift+1..9: move the focused window to workspace n; the view
 * follows, so you land there with the moved window focused. */
function moveFocusedToWorkspace(id, targetIdx) {
  const from = currentWorkspace();
  const to = state.workspaces[targetIdx];
  const idx = from.windows.findIndex((w) => w.id === id);
  if (to === from || idx === -1) return;
  const [win] = from.windows.splice(idx, 1);
  from.dwindleTree = treeRemove(from.dwindleTree, win.id); // collapse node
  to.windows.push(win); // newest dwindle leaf
  const targetId = treeFirstLeaf(to.dwindleTree);
  to.dwindleTree = treeInsert(
    to.dwindleTree,
    targetId,
    win.id,
    measureSplitAxis(to, targetId)
  );
  state.activeWorkspace = targetIdx;
  focusedWindowId = win.id;
  persistState();
  render(); // pill slot 4-9 visibility may change on either side
}

/* ---------- dwindle layout (Spec §4) ----------
   Hyprland-style BSP: a per-workspace binary tree whose leaves are
   window ids. Internal nodes store their split ratio (default 0.5) AND
   their split axis ('v' = left/right, 'h' = top/bottom), fixed when the
   split is created from the container's aspect ratio at that moment —
   exactly like Hyprland. The axis is never re-derived afterwards: a
   resize drag must only ever change the one ratio being dragged, never
   re-orient other splits (which would rearrange whole subtrees as a
   side effect). A new window splits the node of the currently focused
   window. */

function treeInsert(node, targetId, newId, axis = 'v') {
  if (node == null) return newId; // first window in the workspace
  if (typeof node === 'number') {
    return node === targetId
      ? { left: node, right: newId, ratio: 0.5, axis }
      : node;
  }
  return {
    left: treeInsert(node.left, targetId, newId, axis),
    right: treeInsert(node.right, targetId, newId, axis),
    ratio: node.ratio,
    axis: node.axis,
  };
}

function treeRemove(node, id) {
  if (node == null || typeof node === 'number') return node === id ? null : node;
  const left = treeRemove(node.left, id);
  const right = treeRemove(node.right, id);
  if (left === null) return right; // collapse: sibling takes the space
  if (right === null) return left;
  return { left, right, ratio: node.ratio, axis: node.axis };
}

function treeSwap(node, aId, bId) {
  if (typeof node === 'number') {
    return node === aId ? bId : node === bId ? aId : node;
  }
  return {
    left: treeSwap(node.left, aId, bId),
    right: treeSwap(node.right, aId, bId),
    ratio: node.ratio,
    axis: node.axis,
  };
}

function treeFirstLeaf(node) {
  if (node == null) return null;
  if (typeof node === 'number') return node;
  return treeFirstLeaf(node.left) ?? treeFirstLeaf(node.right);
}

function layoutDwindle(node, rect, out) {
  if (typeof node === 'number') {
    out.set(node, rect);
    return;
  }
  // the axis is frozen on the node at split creation (never re-derived
  // from the container's aspect — re-orientation mid-resize would
  // rearrange whole subtrees as a side effect of dragging one boundary)
  const vertical = node.axis !== 'h';
  // Each internal split leaves an INNER gap: HALF_GAP is trimmed from
  // each side of the boundary (outer edges get the full WINDOW_GAP from
  // the workspace-area inset applied by render()).
  if (vertical) {
    const split = Math.round(rect.w * node.ratio);
    layoutDwindle(node.left, { x: rect.x, y: rect.y, w: split - HALF_GAP, h: rect.h }, out);
    layoutDwindle(
      node.right,
      { x: rect.x + split + HALF_GAP, y: rect.y, w: rect.w - split - HALF_GAP, h: rect.h },
      out
    );
  } else {
    const split = Math.round(rect.h * node.ratio);
    layoutDwindle(node.left, { x: rect.x, y: rect.y, w: rect.w, h: split - HALF_GAP }, out);
    layoutDwindle(
      node.right,
      { x: rect.x, y: rect.y + split + HALF_GAP, w: rect.w, h: rect.h - split - HALF_GAP },
      out
    );
  }
}

/** Pick the tiled window whose space a new/retiled window should split. */
function dwindleSplitTarget(ws, preferredId, excludeId = null) {
  const preferred = ws.windows.find(
    (w) => w.id === preferredId && w.state === 'tiled' && w.id !== excludeId
  );
  if (preferred) return preferred.id;
  return (
    treeFirstLeaf(ws.dwindleTree) ??
    ws.windows.find((w) => w.state === 'tiled' && w.id !== excludeId)?.id ??
    null
  );
}

/** Frozen axis for a new split node created around `targetId`: the same
 * wide/tall rule the layout uses, measured from the target's current
 * rendered rect. Defaults to 'v' when no geometry exists yet (e.g. the
 * workspace has never been rendered). */
function measureSplitAxis(ws, targetId) {
  const r = ws.windows.find((w) => w.id === targetId)?._lastRect;
  return r && r.h > 0 ? (r.w >= r.h ? 'v' : 'h') : 'v';
}

/** Ensure the workspace has a BSP tree covering its tiled windows.
 * Rebuilds from tiling order when the tree is missing (legacy state
 * restored before dwindle became the only layout). */
function ensureDwindleTree(ws) {
  if (ws.dwindleTree) return;
  let prev = null;
  let depth = 0;
  for (const w of tiledWindows(ws)) {
    // alternate axes by depth — reproduces the classic dwindle pattern
    // (root splits left/right, the next container top/bottom, ...)
    ws.dwindleTree = treeInsert(
      ws.dwindleTree,
      prev,
      w.id,
      depth % 2 === 0 ? 'v' : 'h'
    );
    prev = w.id;
    depth++;
  }
}

/** Fill in missing split axes (legacy trees saved before axes were
 * persisted) by propagating the workspace's aspect down the tree with
 * the same wide/tall rule the old dynamic layout used, so a legacy
 * restore reproduces the layout that was on screen before the upgrade.
 * Trees saved in the current format already carry axes and pass through
 * untouched. */
function normalizeTreeAxes(node, w, h) {
  if (!node || typeof node === 'number') return;
  if (!node.axis) node.axis = w >= h ? 'v' : 'h';
  if (node.axis === 'v') {
    const split = w * node.ratio;
    normalizeTreeAxes(node.left, split, h);
    normalizeTreeAxes(node.right, w - split, h);
  } else {
    const split = h * node.ratio;
    normalizeTreeAxes(node.left, w, split);
    normalizeTreeAxes(node.right, w, h - split);
  }
}

/* ---------- rendering ----------
   Window elements are cached per window id and reused across renders:
   modules mount their DOM once, and layout changes only move/resize
   the existing element (re-appending preserves listeners), so module
   content is never remounted or reset by WM reflows. */

const windowEls = new Map(); // win.id -> { el, content }

function createWindowEl(win) {
  const el = document.createElement('div');
  el.className = 'window';
  el.dataset.windowId = String(win.id);

  const content = document.createElement('div');
  content.className = 'window-content';
  el.appendChild(content);

  // generic mount — the WM knows nothing about the module itself. The
  // context gives it its own slice of moduleData (Spec §8/§9).
  const mod = getModule(win.moduleId);
  if (mod) {
    mod.mount(content, {
      load: () => getModuleData(win.moduleId),
      persist: (slice) => setModuleData(win.moduleId, slice),
      openModule: launchModule, // singleton-aware launch (Dashboard cards)
    });
  } else {
    content.textContent = `unknown module: ${win.moduleId}`;
  }

  const entry = { el, content };
  windowEls.set(win.id, entry);
  return entry;
}

/** Unmount a module's DOM when its window closes (Spec §8). */
function unmountWindow(win) {
  const entry = windowEls.get(win.id);
  if (!entry) return;
  getModule(win.moduleId)?.unmount?.(entry.content);
  windowEls.delete(win.id);
}

function render() {
  const ws = currentWorkspace();

  // drop cached elements for windows that no longer exist anywhere
  const liveIds = new Set(
    state.workspaces.flatMap((w) => w.windows.map((x) => x.id))
  );
  for (const [id, entry] of windowEls) {
    if (!liveIds.has(id)) {
      entry.el.remove();
      windowEls.delete(id);
    }
  }

  workspaceRoot.innerHTML = '';

  if (!ws.windows.length) {
    const hint = document.createElement('div');
    hint.id = 'empty-workspace-hint';
    // keybind portion rendered as a small bordered <kbd>-style box
    const kbd = document.createElement('span');
    kbd.className = 'kbd';
    kbd.textContent = 'alt+w';
    hint.append(kbd, ' to launch a module');
    workspaceRoot.appendChild(hint);
    renderPill();
    return;
  }

  const W = workspaceRoot.clientWidth;
  const H = workspaceRoot.clientHeight;

  // Layout geometry, fully derived (Spec §4). All tiling happens inside
  // an area inset by WINDOW_GAP on every side (the outer gap); inner
  // gaps between adjacent windows come from HALF_GAP trims at each
  // internal boundary. Dwindle: walk the per-workspace BSP tree.
  const tiled = tiledWindows(ws);
  const rects = new Map();
  // skip the gap on tiny viewports where it would eat the layout
  const gap = W > 200 && H > 200 ? WINDOW_GAP : 0;
  const area = { x: gap, y: gap, w: W - 2 * gap, h: H - 2 * gap };
  if (ws.dwindleTree) {
    layoutDwindle(ws.dwindleTree, area, rects);
  } else if (tiled.length === 1) {
    rects.set(tiled[0].id, area);
  } else if (tiled.length > 1) {
    // defensive: rebuild a tree that's missing (legacy tree-less state)
    // from tiling order, then lay out
    ensureDwindleTree(ws);
    layoutDwindle(ws.dwindleTree, area, rects);
  }

  for (const win of ws.windows) {
    const entry = windowEls.get(win.id) ?? createWindowEl(win);
    const el = entry.el;

    // drop stale state classes first: elements are cached across renders,
    // so a window that stopped being floating/fullscreen/focused must not
    // keep its old class (re-added below when still applicable)
    el.classList.remove('fullscreen', 'floating', 'focused');

    if (win.isFullscreen) {
      el.classList.add('fullscreen');
      setRect(el, { x: 0, y: 0, w: W, h: H });
    } else if (win.state === 'floating' && win.floatingGeometry) {
      el.classList.add('floating');
      setRect(el, win.floatingGeometry);
    } else {
      const rect = rects.get(win.id) ?? { x: 0, y: 0, w: W, h: H };
      win._lastRect = rect; // remembered so Alt+V can detach "in place"
      setRect(el, rect);
    }

    if (win.id === focusedWindowId) el.classList.add('focused');

    workspaceRoot.appendChild(el);
  }

  renderPill();
}

function setRect(el, rect) {
  el.style.left = `${rect.x}px`;
  el.style.top = `${rect.y}px`;
  el.style.width = `${rect.w}px`;
  el.style.height = `${rect.h}px`;
}

/* ---------- persistence (Spec §9) ----------
   Everything lives under the single 'personal-os-state' JSON key:
   { activeWorkspace, activeTheme, workspaces: { "1".. "9" }, moduleData }
   persistState() merges the WM slice over the loaded blob so the
   moduleData section (owned by modules via persistence.js) survives.
   Saved window ids are kept on restore, so dwindle trees (which
   reference window ids) round-trip without remapping. */

function serializeWindows(ws) {
  return ws.windows.map((w) => ({
    id: w.id,
    moduleId: w.moduleId,
    state: w.state,
    floatingGeometry: w.floatingGeometry,
    isFullscreen: w.isFullscreen,
  }));
}

/** Save the full WM state (called on every meaningful change). */
function persistState() {
  const prev = loadState() ?? {};
  saveState({
    ...prev, // preserve moduleData (Spec §9: modules own their data)
    activeWorkspace: state.activeWorkspace + 1, // 1-based, per spec shape
    activeTheme: document.documentElement.dataset.theme || DEFAULT_THEME_ID,
    workspaces: Object.fromEntries(
      state.workspaces.map((ws, i) => [
        String(i + 1),
        {
          dwindleTree: ws.dwindleTree, // per-workspace dwindle split state
          windows: serializeWindows(ws),
        },
      ])
    ),
  });
}

/** Rebuild all workspaces from the saved blob; returns the theme id. */
function restoreState() {
  const saved = loadState();
  if (!saved) return DEFAULT_THEME_ID;

  if (typeof saved.activeWorkspace === 'number') {
    state.activeWorkspace = clamp(saved.activeWorkspace - 1, 0, WORKSPACE_COUNT - 1);
  }

  let maxId = 0;
  const savedWorkspaces = saved.workspaces ?? {};
  for (let i = 0; i < WORKSPACE_COUNT; i++) {
    const savedWs = savedWorkspaces[String(i + 1)];
    if (!savedWs) continue;
    const ws = state.workspaces[i];
    for (const w of Array.isArray(savedWs.windows) ? savedWs.windows : []) {
      // skip unknown modules (e.g. a module that was removed later)
      if (!w || typeof w.moduleId !== 'string' || !getModule(w.moduleId)) continue;
      const g = w.floatingGeometry;
      ws.windows.push({
        id: typeof w.id === 'number' ? w.id : nextWindowId++,
        moduleId: w.moduleId,
        state: w.state === 'floating' ? 'floating' : 'tiled',
        floatingGeometry:
          g && [g.x, g.y, g.w, g.h].every((n) => typeof n === 'number') ? g : null,
        isFullscreen: !!w.isFullscreen,
      });
      maxId = Math.max(maxId, ws.windows[ws.windows.length - 1].id);
    }
    if (savedWs.dwindleTree) {
      // drop tree leaves whose window no longer exists
      let tree = savedWs.dwindleTree;
      const ids = new Set(ws.windows.map((w) => w.id));
      for (const leaf of treeLeaves(tree)) {
        if (!ids.has(leaf)) tree = treeRemove(tree, leaf);
      }
      ws.dwindleTree = tree;
    }
    ensureDwindleTree(ws); // legacy tree-less states: rebuild from order
    // legacy trees persisted before splits carried an axis: derive each
    // missing axis symbolically from the workspace aspect (the same
    // wide/tall rule the old dynamic layout used), so the restored
    // layout matches what was on screen before the upgrade
    normalizeTreeAxes(
      ws.dwindleTree,
      workspaceRoot.clientWidth,
      workspaceRoot.clientHeight
    );
  }
  nextWindowId = maxId + 1;

  const ws = currentWorkspace();
  focusedWindowId = ws.windows.length
    ? ws.windows[ws.windows.length - 1].id
    : null;

  return typeof saved.activeTheme === 'string' ? saved.activeTheme : DEFAULT_THEME_ID;
}

/** All leaf window ids in a dwindle tree. */
function treeLeaves(node, out = []) {
  if (node == null) return out;
  if (typeof node === 'number') out.push(node);
  else {
    treeLeaves(node.left, out);
    treeLeaves(node.right, out);
  }
  return out;
}

/* ---------- keybinds (Spec §10) ---------- */

function bindKeybinds() {
  window.addEventListener('keydown', (e) => {
    if (!e.altKey) return;
    // don't hijack typing in inputs (launcher, module content)
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;

    const key = e.key.toLowerCase();
    let handled = true;

    if (key === 'h') cycleFocus(-1);
    else if (key === 'l') cycleFocus(+1);
    else if (key === 'j') cycleFocus(+1);
    else if (key === 'k') cycleFocus(-1);
    else if (key === 'w') toggleLauncher(); // open module launcher (Spec §7)
    else if (key === 'v' && !e.shiftKey) toggleFloating(focusedWindowId);
    else if (key === 'f' && !e.shiftKey) toggleFullscreen(focusedWindowId);
    else if (key === 'q' && !e.shiftKey) closeWindow(focusedWindowId);
    // Alt+1..9 switches workspaces; Alt+Shift+1..9 moves the focused
    // window there instead. With Shift held, e.key becomes shifted
    // punctuation ('!'/'@') on layouts like US-ANSI, so prefer the
    // layout-independent e.code.
    else {
      const digit = /^Digit([1-9])$/.exec(e.code)?.[1] ?? (/^[1-9]$/.test(key) ? key : null);
      if (digit != null) {
        const target = Number(digit) - 1;
        e.shiftKey ? moveFocusedToWorkspace(focusedWindowId, target) : switchWorkspace(target);
      } else {
        handled = false;
      }
    }

    // keep all Alt combos away from browser/OS menu behavior
    if (handled) e.preventDefault();
  });
}

/* ---------- mouse behavior (Spec §11) ---------- */

// active drag session: { type: 'move'|'resize'|'swap'|'ratio', ... }
let activeDrag = null;

function bindMouse() {
  // focus-follows-hover, but not while a drag is in progress
  workspaceRoot.addEventListener('mouseover', (e) => {
    if (activeDrag) return;
    const el = e.target.closest('.window');
    if (el) focusWindow(Number(el.dataset.windowId));
  });

  // direct border-drag: hovering a shared tiled boundary shows a resize
  // cursor (no Alt needed for this method — you're grabbing the boundary)
  workspaceRoot.addEventListener('mousemove', (e) => {
    if (activeDrag) return;
    const rootRect = workspaceRoot.getBoundingClientRect();
    const px = e.clientX - rootRect.left;
    const py = e.clientY - rootRect.top;
    const border = !e.altKey && findBorderAt(px, py);
    workspaceRoot.style.cursor = border
      ? border.axis === 'v' ? 'col-resize' : 'row-resize'
      : '';
  });

  workspaceRoot.addEventListener('mousedown', (e) => {
    // grab a shared tiled boundary directly — no Alt required (amendment)
    if (!e.altKey && e.button === 0) {
      const rootRect = workspaceRoot.getBoundingClientRect();
      const px = e.clientX - rootRect.left;
      const py = e.clientY - rootRect.top;
      const border = findBorderAt(px, py);
      if (border) {
        // resize the window under the pointer exactly like Alt+RightClick
        // would (shared split-follow session); the border is just the
        // grab affordance. Pointer in the gap -> fall back to border.a.
        const el = e.target.closest('.window');
        const grabWin = (el && findWindow(Number(el.dataset.windowId))) || border.a;
        const session = tiledSplitDrag(grabWin, e);
        if (session) {
          e.preventDefault();
          focusWindow(grabWin.id);
          activeDrag = session;
          return;
        }
      }
    }
    if (!e.altKey) return;
    const el = e.target.closest('.window');
    if (!el) return;
    e.preventDefault();
    const win = findWindow(Number(el.dataset.windowId));
    if (!win) return;
    focusWindow(win.id);
    const rootRect = workspaceRoot.getBoundingClientRect();

    if (e.button === 0) {
      if (win.state === 'floating') {
        // grab offset so the window follows the cursor without jumping
        const rect = el.getBoundingClientRect();
        activeDrag = {
          type: 'move',
          win,
          el,
          rootRect,
          offsetX: e.clientX - rect.left,
          offsetY: e.clientY - rect.top,
        };
      } else {
        activeDrag = { type: 'swap', win }; // drop target decided at mouseup
      }
    } else if (e.button === 2) {
      if (win.state === 'floating') {
        const rect = el.getBoundingClientRect();
        // quadrant-based dynamic anchor (amendment): the quadrant of the
        // mousedown (relative to the window's center) picks the corner
        // being dragged; the OPPOSITE corner stays fixed for the whole
        // gesture and the free corner follows the pointer
        const freeX = e.clientX < rect.left + rect.width / 2 ? 'left' : 'right';
        const freeY = e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom';
        activeDrag = {
          type: 'resize',
          win,
          el,
          rootRect,
          startX: e.clientX,
          startY: e.clientY,
          startLeft: rect.left - rootRect.left,
          startTop: rect.top - rootRect.top,
          startW: rect.width,
          startH: rect.height,
          grabX: freeX,
          grabY: freeY,
        };
      } else {
        // tiled: resize directly follows the mouse (amendment) — the
        // nearest vertical/horizontal splits track the horizontal/vertical
        // mouse axes respectively; sibling tiles adjust inversely
        activeDrag = tiledSplitDrag(win, e);
      }
    }
  });

  // suppress the native context menu during Alt+RightClick drags
  workspaceRoot.addEventListener('contextmenu', (e) => {
    if (e.altKey || activeDrag) e.preventDefault();
  });

  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);
}

function onDragMove(e) {
  if (!activeDrag) return;
  if (activeDrag.type === 'move') {
    const { rootRect, el, offsetX, offsetY } = activeDrag;
    const x = clamp(e.clientX - rootRect.left - offsetX, -el.offsetWidth + 80, rootRect.width - 80);
    const y = clamp(e.clientY - rootRect.top - offsetY, 0, rootRect.height - 40);
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
  } else if (activeDrag.type === 'resize') {
    // dynamic anchor: the grabbed edge/corner moves, the opposite one
    // stays fixed; middle grabs keep the classic top-left anchor
    const { el, startX, startY, startLeft, startTop, startW, startH, grabX, grabY } = activeDrag;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    let left = startLeft;
    let top = startTop;
    let w = startW;
    let h = startH;
    if (grabX === 'left') {
      w = Math.max(MIN_FLOAT_W, startW - dx);
      left = startLeft + (startW - w); // right edge stays fixed
    } else {
      w = Math.max(MIN_FLOAT_W, startW + dx); // 'right' or middle grab
    }
    if (grabY === 'top') {
      h = Math.max(MIN_FLOAT_H, startH - dy);
      top = startTop + (startH - h); // bottom edge stays fixed
    } else {
      h = Math.max(MIN_FLOAT_H, startH + dy); // 'bottom' or middle grab
    }
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.style.width = `${Math.round(w)}px`;
    el.style.height = `${Math.round(h)}px`;
  } else if (activeDrag.type === 'splitFollow') {
    // The split line (the dragged window's shared boundary) follows the
    // mouse 1:1 along its axis and the sibling side adjusts inversely.
    // The line was measured from the rendered rects at mousedown, so the
    // direction always matches the mouse regardless of tree shape; the
    // ratio is re-derived from the moved line (and clamped) each frame.
    const { axisV, axisH, startX, startY } = activeDrag;
    if (axisV) {
      const line = axisV.startLine + (e.clientX - startX);
      axisV.node.ratio = clamp(
        (line - axisV.origin) / axisV.size,
        MIN_SPLIT_RATIO,
        MAX_SPLIT_RATIO
      );
    }
    if (axisH) {
      const line = axisH.startLine + (e.clientY - startY);
      axisH.node.ratio = clamp(
        (line - axisH.origin) / axisH.size,
        MIN_SPLIT_RATIO,
        MAX_SPLIT_RATIO
      );
    }
    render();
  }
}

function onDragEnd(e) {
  if (!activeDrag) return;
  const drag = activeDrag;
  activeDrag = null;

  if (drag.type === 'move' || drag.type === 'resize') {
    // commit final geometry (root-relative, already applied to the
    // element's style by the drag handlers) and reflow
    const num = (v) => Math.round(parseFloat(v) || 0);
    drag.win.floatingGeometry = {
      x: num(drag.el.style.left),
      y: num(drag.el.style.top),
      w: num(drag.el.style.width),
      h: num(drag.el.style.height),
    };
    persistState();
    render();
  } else if (drag.type === 'swap') {
    // tiled Alt+Left-drag: swap with whichever window was dropped onto
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('.window');
    if (hit) {
      const target = findWindow(Number(hit.dataset.windowId));
      if (target && target.id !== drag.win.id && drag.win.state === 'tiled' && target.state === 'tiled') {
        swapWindows(drag.win.id, target.id);
      }
    }
  } else if (drag.type === 'splitFollow') {
    persistState(); // ratios were committed live during move; save the final values
  }
}

/* ---------- workspace indicator pill (Spec §3) ---------- */

const ICON_THEME = '\uf042'; // Nerd Font "adjust" glyph (half-filled circle)

function renderPill() {
  const pill = document.getElementById('workspace-pill');
  if (!pill) return;
  pill.innerHTML = '';

  // theme toggle icon sits right of the workspace numbers (Spec §3)
  const themeBtn = document.createElement('span');
  themeBtn.className = 'pill-icon';
  themeBtn.textContent = ICON_THEME;
  themeBtn.title = 'theme picker';
  themeBtn.addEventListener('click', toggleThemePicker);

  for (let n = 1; n <= WORKSPACE_COUNT; n++) {
    // slots 1-3 always visible; 4-9 only while populated (Spec §3)
    if (n > 3 && !state.workspaces[n - 1].windows.length) continue;
    const slot = document.createElement('span');
    slot.className = 'pill-slot' + (n - 1 === state.activeWorkspace ? ' active' : '');
    slot.textContent = String(n);
    slot.addEventListener('click', () => switchWorkspace(n - 1));
    pill.appendChild(slot);
  }

  pill.appendChild(themeBtn);
}

/* ---------- module launcher (Spec §7) ---------- */

let launcher = null; // { overlay, input, list, filtered, selected }

function toggleLauncher() {
  launcher ? closeLauncher() : openLauncher();
}

function openLauncher() {
  if (launcher) return;

  const overlay = document.createElement('div');
  overlay.id = 'launcher';

  const box = document.createElement('div');
  box.className = 'launcher-box';

  const input = document.createElement('input');
  input.className = 'launcher-input';
  input.type = 'text';
  input.placeholder = 'search modules…';

  const list = document.createElement('ul');
  list.className = 'launcher-list';

  box.append(input, list);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  launcher = { overlay, input, list, filtered: [], selected: 0 };

  input.addEventListener('input', () => filterLauncher(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { launcherMove(1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { launcherMove(-1); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); confirmLauncher(); }
    else if (e.key === 'Escape') closeLauncher();
  });
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closeLauncher(); // click outside closes
  });

  filterLauncher('');
  input.focus();
}

function closeLauncher() {
  launcher.overlay.remove();
  launcher = null;
}

/** Subsequence fuzzy match: every query char appears in order. */
function fuzzyMatch(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return i === q.length;
}

function filterLauncher(query) {
  launcher.filtered = getAllModules().filter((m) => fuzzyMatch(query, m.name));
  launcher.selected = 0;
  renderLauncherList();
}

function renderLauncherList() {
  const { list, filtered, selected } = launcher;
  list.innerHTML = '';
  if (!filtered.length) {
    const empty = document.createElement('li');
    empty.className = 'launcher-empty';
    empty.textContent = 'no matching modules';
    list.appendChild(empty);
    return;
  }
  filtered.forEach((mod, i) => {
    const item = document.createElement('li');
    item.className = 'launcher-item' + (i === selected ? ' selected' : '');

    const icon = document.createElement('span');
    icon.className = 'launcher-icon';
    icon.textContent = mod.icon;
    const name = document.createElement('span');
    name.textContent = mod.name;
    item.append(icon, name);

    item.addEventListener('click', () => confirmLauncher());
    item.addEventListener('mouseover', () => {
      if (launcher.selected !== i) {
        launcher.selected = i;
        renderLauncherList();
      }
    });
    list.appendChild(item);
  });
}

function launcherMove(delta) {
  const n = launcher.filtered.length;
  if (!n) return;
  launcher.selected = (launcher.selected + delta + n) % n;
  renderLauncherList();
}

function confirmLauncher() {
  const mod = launcher?.filtered[launcher.selected];
  if (!mod) return;
  closeLauncher();
  launchModule(mod.id); // singleton-aware (Spec §5/§7)
}

/* ---------- theme picker (Spec §6) ---------- */

let themePicker = null;

function toggleThemePicker() {
  themePicker ? closeThemePicker() : openThemePicker();
}

function openThemePicker() {
  if (themePicker) return;

  const overlay = document.createElement('div');
  overlay.id = 'theme-picker';
  const box = document.createElement('div');
  box.className = 'theme-box';
  const list = document.createElement('ul');
  list.className = 'theme-list';

  const currentThemeId = document.documentElement.dataset.theme;

  for (const theme of getAllThemes()) {
    const item = document.createElement('li');
    item.className = 'theme-item' + (theme.id === currentThemeId ? ' current' : '');

    const swatches = document.createElement('span');
    swatches.className = 'theme-swatches';
    for (const color of Object.values(theme.colors)) {
      const swatch = document.createElement('span');
      swatch.className = 'theme-swatch';
      swatch.style.background = color;
      swatches.appendChild(swatch);
    }

    const name = document.createElement('span');
    name.className = 'theme-name';
    name.textContent = theme.name;
    item.append(swatches, name);

    item.addEventListener('click', () => {
      applyTheme(theme.id); // instant via CSS custom properties
      persistState(); // theme change is a meaningful change (Spec §9)
      closeThemePicker();
    });
    list.appendChild(item);
  }

  box.appendChild(list);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  themePicker = { overlay };

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closeThemePicker();
  });
}

function closeThemePicker() {
  themePicker.overlay.remove();
  themePicker = null;
}

/* ---------- Dashboard auto-open (Spec §8, exception) ----------
 * The Dashboard re-opens itself into workspace 1 on every load:
 * closing it dismisses it for the current session only. */
function ensureDashboardOpen() {
  const isOpen = state.workspaces.some((ws) =>
    ws.windows.some((w) => w.moduleId === 'dashboard'));
  if (!isOpen) openWindow('dashboard', 0); // workspace 1
}

/**
 * App bootstrap.
 * Applies theme, starts the top-pills clock, binds WM keybinds + mouse
 * behavior. Workspaces start empty except the Dashboard, which
 * auto-opens into workspace 1 on every load.
 */
function init() {
  // Element refs FIRST: restoreState()'s legacy-axis migration measures
  // the workspace root (Spec §9), and render() needs it too.
  workspaceRoot = document.getElementById('workspace-root');
  applyTheme(restoreState()); // restore WM state + theme (Spec §9)
  startClock();

  bindKeybinds();
  bindMouse();
  window.addEventListener('resize', render);
  initLockScreen(); // lock on every page load (Spec §12)
  initFavicon();

  render(); // initial paint: empty-workspace hint + pill
  ensureDashboardOpen(); // Dashboard lives on workspace 1 (Spec §8)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
