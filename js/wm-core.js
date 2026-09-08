/*
 * pOS — js/wm-core.js
 * ----------------------------------------------------------------------
 * Entry point + window manager core. A generic shell: it consumes the
 * module registry (modules.js), themes, persistence, and the lock
 * screen, but knows nothing about individual modules. To install one,
 * create js/modules/<name>.js that calls registerModule(), then import
 * it as a side effect below.
 *
 * Data model: 9 workspaces, each with its own windows, layout mode and
 * split state. Array order of `windows` is the tiling order (the first
 * tiled window is the master). Tiled geometry is derived at render time
 * and never stored; floating geometry and the fullscreen flag live on
 * the window. One global focusedWindowId.
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
import './modules/agenda.js';
import './modules/bookmarks.js';
import './modules/watchlater.js';

import { DEFAULT_THEME_ID, applyTheme, getAllThemes } from './themes.js';
import { loadState, saveState, getModuleData, setModuleData } from './persistence.js';
import { getAllModules, getModule } from './modules.js';
import { initLockScreen } from './lockscreen.js';

/* ---------- top bar clock ---------- */

const DATE_OPTS = { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' };

function tickClock() {
  const now = new Date();
  document.getElementById('top-bar-center').textContent = now
    .toLocaleDateString('en-GB', DATE_OPTS)
    .replace(/,/g, '');
  const timeEl = document.getElementById('top-bar-right');
  // 12-hour, minutes only; the exact time with seconds goes in the
  // hover tooltip, refreshed every tick.
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
const DEFAULT_LAYOUT = 'dwindle'; // dwindle by default; master-stack via the pill icon
const DEFAULT_MASTER_RATIO = 0.55;
const RATIO_STEP = 0.05;
const MIN_MASTER_RATIO = 0.2;
const MAX_MASTER_RATIO = 0.8;
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
    layoutMode: DEFAULT_LAYOUT,
    masterRatio: DEFAULT_MASTER_RATIO,
    windows: [],
    dwindleTree: null, // BSP tree of window ids; null in master-stack mode
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

function openWindow(moduleId) {
  const ws = currentWorkspace();
  const prevFocusId = focusedWindowId;
  const win = {
    id: nextWindowId++,
    moduleId,
    state: 'tiled',
    floatingGeometry: null,
    isFullscreen: false,
  };
  // Master-stack: new windows spawn as master, pushing the previous one
  // to the top of the stack. Dwindle: the new window splits the focused
  // window's space.
  const firstTiledIdx = ws.windows.findIndex((w) => w.state === 'tiled');
  if (firstTiledIdx === -1) ws.windows.push(win);
  else ws.windows.splice(firstTiledIdx, 0, win);
  focusedWindowId = win.id;
  if (ws.layoutMode === 'dwindle') {
    ws.dwindleTree = treeInsert(
      ws.dwindleTree,
      dwindleSplitTarget(ws, prevFocusId),
      win.id
    );
  }
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
  if (ws.layoutMode === 'dwindle' && win.state === 'tiled') {
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
    if (ws.layoutMode === 'dwindle') {
      ws.dwindleTree = treeRemove(ws.dwindleTree, win.id); // collapse the node
    }
  } else {
    win.state = 'tiled';
    // Keep floatingGeometry: it's inert while tiled (tiled geometry is
    // derived at render time) and restores the old floating position on
    // the next Alt+V.
    if (ws.layoutMode === 'dwindle') {
      const targetId = dwindleSplitTarget(ws, focusedWindowId, win.id);
      ws.dwindleTree = treeInsert(ws.dwindleTree, targetId, win.id);
    }
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

function promoteToMaster(id) {
  const ws = currentWorkspace();
  if (ws.layoutMode !== 'master-stack') return; // no "master" in dwindle
  const idx = ws.windows.findIndex((w) => w.id === id);
  const masterIdx = ws.windows.findIndex((w) => w.state === 'tiled');
  if (idx === -1 || masterIdx === -1 || idx === masterIdx) return;
  if (ws.windows[idx].state !== 'tiled') return; // promotion is for tiled windows
  [ws.windows[idx], ws.windows[masterIdx]] = [ws.windows[masterIdx], ws.windows[idx]];
  persistState();
  render();
}

/** Adjust the active layout's split: the master ratio in master-stack,
 * the focused window's parent split in dwindle. */
function resizeSplit(delta, axis) {
  const ws = currentWorkspace();
  if (ws.layoutMode === 'dwindle') {
    const parent = findParentNode(ws.dwindleTree, focusedWindowId);
    if (!parent) return;
    parent.ratio = clamp(parent.ratio + delta, MIN_MASTER_RATIO, MAX_MASTER_RATIO);
  } else {
    if (axis !== 'h') return; // stack slices are fixed height
    ws.masterRatio = clamp(ws.masterRatio + delta, MIN_MASTER_RATIO, MAX_MASTER_RATIO);
  }
  persistState();
  render();
}

function swapWindows(aId, bId) {
  const ws = currentWorkspace();
  const i = ws.windows.findIndex((w) => w.id === aId);
  const j = ws.windows.findIndex((w) => w.id === bId);
  if (i === -1 || j === -1) return;
  [ws.windows[i], ws.windows[j]] = [ws.windows[j], ws.windows[i]];
  if (ws.layoutMode === 'dwindle') {
    ws.dwindleTree = treeSwap(ws.dwindleTree, aId, bId);
  }
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
  if (from.layoutMode === 'dwindle') {
    from.dwindleTree = treeRemove(from.dwindleTree, win.id); // collapse node
  }
  to.windows.push(win); // last stack slice / newest dwindle leaf
  if (to.layoutMode === 'dwindle') {
    to.dwindleTree = treeInsert(
      to.dwindleTree,
      treeFirstLeaf(to.dwindleTree),
      win.id
    );
  }
  state.activeWorkspace = targetIdx;
  focusedWindowId = win.id;
  persistState();
  render(); // pill slot 4-9 visibility may change on either side
}

/* ---------- dwindle layout (Spec §4) ----------
   Hyprland-style BSP: a per-workspace binary tree whose leaves are
   window ids. Internal nodes store their split ratio (default 0.5);
   the split *axis* is chosen at layout time from the container's
   aspect ratio (wide = left/right, tall = top/bottom), so the same
   tree reflows correctly when the viewport resizes. A new window
   splits the node of the currently focused window. */

function treeInsert(node, targetId, newId) {
  if (node == null) return newId; // first window in the workspace
  if (typeof node === 'number') {
    return node === targetId ? { left: node, right: newId, ratio: 0.5 } : node;
  }
  return {
    left: treeInsert(node.left, targetId, newId),
    right: treeInsert(node.right, targetId, newId),
    ratio: node.ratio,
  };
}

function treeRemove(node, id) {
  if (node == null || typeof node === 'number') return node === id ? null : node;
  const left = treeRemove(node.left, id);
  const right = treeRemove(node.right, id);
  if (left === null) return right; // collapse: sibling takes the space
  if (right === null) return left;
  return { left, right, ratio: node.ratio };
}

function treeSwap(node, aId, bId) {
  if (typeof node === 'number') {
    return node === aId ? bId : node === bId ? aId : node;
  }
  return {
    left: treeSwap(node.left, aId, bId),
    right: treeSwap(node.right, aId, bId),
    ratio: node.ratio,
  };
}

function treeFirstLeaf(node) {
  if (node == null) return null;
  if (typeof node === 'number') return node;
  return treeFirstLeaf(node.left) ?? treeFirstLeaf(node.right);
}

/** The internal node whose direct child is the focused leaf. */
function findParentNode(node, id) {
  if (node == null || typeof node === 'number') return null;
  if (node.left === id || node.right === id) return node;
  return findParentNode(node.left, id) ?? findParentNode(node.right, id);
}

function layoutDwindle(node, rect, out) {
  if (typeof node === 'number') {
    out.set(node, rect);
    return;
  }
  const vertical = rect.w >= rect.h; // wide container -> split left/right
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

/** Toggle the current workspace's tiling mode (pill icon, Spec §3/§4). */
function toggleLayout() {
  const ws = currentWorkspace();
  if (ws.layoutMode === 'master-stack') {
    ws.layoutMode = 'dwindle';
    // build the BSP tree from the current tiled order
    ws.dwindleTree = null;
    let prev = null;
    for (const w of tiledWindows(ws)) {
      ws.dwindleTree = treeInsert(ws.dwindleTree, prev, w.id);
      prev = w.id;
    }
  } else {
    ws.layoutMode = 'master-stack'; // array order already reflects swaps
    ws.dwindleTree = null;
  }
  persistState();
  render();
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
    kbd.textContent = 'alt+enter';
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
  // internal boundary. master-stack: first tiled window is master
  // (masterRatio width, full height); the rest split the right column
  // into equal-height slices. dwindle: walk the per-workspace BSP tree.
  const tiled = tiledWindows(ws);
  const rects = new Map();
  // skip the gap on tiny viewports where it would eat the layout
  const gap = W > 200 && H > 200 ? WINDOW_GAP : 0;
  const area = { x: gap, y: gap, w: W - 2 * gap, h: H - 2 * gap };
  if (ws.layoutMode === 'dwindle' && ws.dwindleTree) {
    layoutDwindle(ws.dwindleTree, area, rects);
  } else if (tiled.length === 1) {
    rects.set(tiled[0].id, area);
  } else if (tiled.length > 1) {
    const masterW = Math.round(area.w * ws.masterRatio);
    rects.set(tiled[0].id, {
      x: area.x,
      y: area.y,
      w: masterW - HALF_GAP,
      h: area.h,
    });
    const stackX = area.x + masterW + HALF_GAP;
    const stackW = area.w - masterW - HALF_GAP;
    const stack = tiled.slice(1);
    const sliceH = area.h / stack.length;
    stack.forEach((w, i) => {
      // inner gaps between stack slices: HALF_GAP above/below, except
      // at the area's outer top/bottom edges (already inset)
      const padTop = i > 0 ? HALF_GAP : 0;
      const padBottom = i < stack.length - 1 ? HALF_GAP : 0;
      const y = Math.round(i * sliceH) + padTop;
      rects.set(w.id, {
        x: stackX,
        y,
        w: stackW,
        // rounding-aware slice height (avoids 1px gaps from rounding)
        h: Math.round((i + 1) * sliceH) - Math.round(i * sliceH) - padTop - padBottom,
      });
    });
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
  const firstTiledId = tiledWindows(ws)[0]?.id ?? null;
  return ws.windows.map((w) => ({
    id: w.id,
    moduleId: w.moduleId,
    state: w.state,
    floatingGeometry: w.floatingGeometry,
    isFullscreen: w.isFullscreen,
    isMaster: w.state === 'tiled' && w.id === firstTiledId,
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
          layoutMode: ws.layoutMode,
          masterRatio: ws.masterRatio,
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
    ws.layoutMode = savedWs.layoutMode === 'master-stack' ? 'master-stack' : DEFAULT_LAYOUT;
    ws.masterRatio = clamp(
      typeof savedWs.masterRatio === 'number' ? savedWs.masterRatio : DEFAULT_MASTER_RATIO,
      MIN_MASTER_RATIO,
      MAX_MASTER_RATIO
    );
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
    if (ws.layoutMode === 'dwindle' && savedWs.dwindleTree) {
      // drop tree leaves whose window no longer exists
      let tree = savedWs.dwindleTree;
      const ids = new Set(ws.windows.map((w) => w.id));
      for (const leaf of treeLeaves(tree)) {
        if (!ids.has(leaf)) tree = treeRemove(tree, leaf);
      }
      ws.dwindleTree = tree;
    }
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

    if (key === 'h') e.shiftKey ? resizeSplit(-RATIO_STEP, 'h') : cycleFocus(-1);
    else if (key === 'l') e.shiftKey ? resizeSplit(+RATIO_STEP, 'h') : cycleFocus(+1);
    // Shift+J/K resize vertically: dwindle splits only (master-stack
    // stack slices are fixed height)
    else if (key === 'j') e.shiftKey ? resizeSplit(-RATIO_STEP, 'v') : cycleFocus(+1);
    else if (key === 'k') e.shiftKey ? resizeSplit(+RATIO_STEP, 'v') : cycleFocus(-1);
    else if (key === 'w' && !e.shiftKey) promoteToMaster(focusedWindowId);
    else if (key === 'v' && !e.shiftKey) toggleFloating(focusedWindowId);
    else if (key === 'f' && !e.shiftKey) toggleFullscreen(focusedWindowId);
    else if (key === 'q' && !e.shiftKey) closeWindow(focusedWindowId);
    else if (key === 'enter') toggleLauncher();
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

  workspaceRoot.addEventListener('mousedown', (e) => {
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
      activeDrag = win.state === 'floating'
        ? {
            type: 'resize',
            win,
            el,
            startX: e.clientX,
            startY: e.clientY,
            startW: el.offsetWidth,
            startH: el.offsetHeight,
          }
        : { type: 'ratio', rootRect };
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
    const { el, startX, startY, startW, startH } = activeDrag;
    el.style.width = `${Math.max(MIN_FLOAT_W, startW + (e.clientX - startX))}px`;
    el.style.height = `${Math.max(MIN_FLOAT_H, startH + (e.clientY - startY))}px`;
  } else if (activeDrag.type === 'ratio') {
    // live master/stack ratio follows the pointer (Spec §11), measured
    // against the gapped tiling area (not the raw root width)
    const { rootRect } = activeDrag;
    const usableW = Math.max(1, rootRect.width - 2 * WINDOW_GAP);
    currentWorkspace().masterRatio = clamp(
      (e.clientX - rootRect.left - WINDOW_GAP) / usableW,
      MIN_MASTER_RATIO,
      MAX_MASTER_RATIO
    );
    render();
  }
}

function onDragEnd(e) {
  if (!activeDrag) return;
  const drag = activeDrag;
  activeDrag = null;

  if (drag.type === 'move' || drag.type === 'resize') {
    // commit final geometry (root-relative) and reflow
    const rect = drag.el.getBoundingClientRect();
    drag.win.floatingGeometry = {
      x: Math.round(rect.left - drag.rootRect.left),
      y: Math.round(rect.top - drag.rootRect.top),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
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
  } else if (drag.type === 'ratio') {
    persistState(); // ratio was committed live during move; save the final value
  }
}

/* ---------- workspace indicator pill (Spec §3) ---------- */

// Layout icons reflect the workspace's active mode (amendment #1):
// "columns" (vertical split) = master-stack, "th-large" (4-pane grid) = dwindle.
const ICON_LAYOUT_MASTER = '\uf0db';  // Nerd Font "columns" glyph
const ICON_LAYOUT_DWINDLE = '\uf009'; // Nerd Font "th-large" glyph
const ICON_THEME = '\uf042';          // Nerd Font "adjust" glyph (half-filled circle)

function renderPill() {
  const pill = document.getElementById('workspace-pill');
  if (!pill) return;
  pill.innerHTML = '';

  // icons flank the numbers: layout toggle left, theme toggle right
  // (Spec §3 amendment — numbers in the middle, one icon per side)
  const ws = currentWorkspace();
  const layoutBtn = document.createElement('span');
  layoutBtn.className = 'pill-icon';
  // icon mirrors the ACTIVE layout; render() after toggleLayout swaps it
  layoutBtn.textContent =
    ws.layoutMode === 'dwindle' ? ICON_LAYOUT_DWINDLE : ICON_LAYOUT_MASTER;
  layoutBtn.title = `layout: ${ws.layoutMode} — click to toggle`;
  layoutBtn.addEventListener('click', toggleLayout);

  const themeBtn = document.createElement('span');
  themeBtn.className = 'pill-icon';
  themeBtn.textContent = ICON_THEME;
  themeBtn.title = 'theme picker';
  themeBtn.addEventListener('click', toggleThemePicker);

  pill.appendChild(layoutBtn);

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

/**
 * App bootstrap.
 * Applies theme, starts the top-bar clock, binds WM keybinds + mouse
 * behavior. Workspaces start empty — Alt+Enter opens the launcher.
 */
function init() {
  applyTheme(restoreState()); // restore WM state + theme (Spec §9)
  startClock();

  workspaceRoot = document.getElementById('workspace-root');
  bindKeybinds();
  bindMouse();
  window.addEventListener('resize', render);
  initLockScreen(); // lock on every page load (Spec §12)
  initFavicon();

  render(); // initial paint: empty-workspace hint + pill
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
