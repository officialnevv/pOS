/*
 * PersonalOS — js/wm-core.js
 * ----------------------------------------------------------------------
 * Window manager core + app bootstrap (entry point).
 *
 * This file is the generic tiling-WM shell (Spec §3–5, §10–11). It knows
 * nothing about individual modules — it only consumes the registry
 * (modules.js), themes (themes.js), and persistence (persistence.js).
 * Individual modules are pulled in as side-effect imports below so they
 * register themselves at load time.
 *
 * Implemented:
 *   - Workspace state: 9 workspaces, each with its own windows,
 *     layoutMode (master-stack / dwindle), masterRatio + dwindle BSP
 *     tree; Alt+1..9 switching; workspace indicator pill (Spec §3).
 *   - Master-stack tiling (55/45 default, live-adjustable), new
 *     windows spawn as master (Spec §4).
 *   - Window lifecycle: open/close (Alt+Q), promote to master
 *     (Alt+W), toggle floating (Alt+V, detaches in place), fullscreen
 *     overlay (Alt+F).
 *   - Generic module mounting: windows look their module up in the
 *     registry and mount/unmount its DOM (Spec §8); launching is
 *     singleton-aware across workspaces (Spec §5).
 *   - Module launcher (Alt+Enter, fuzzy filter, Spec §7) and theme
 *     picker popup (Spec §6) as centered popups.
 *   - Keybind handling: Alt+H/J/K/L focus, Alt+Shift+H/J/K/L resize,
 *     Alt+1..9 workspaces, Alt+Enter launcher — all with
 *     preventDefault (Spec §10).
 *   - Mouse behavior: focus-follows-hover, Alt+LeftClick drag
 *     (move/swap), Alt+RightClick drag (resize/ratio, with
 *     contextmenu suppressed) (Spec §11).
 *   - Shell chrome: live top-bar clock/date, empty-workspace hint.
 *
 * Still TODO in later phases:
 *   - Persistence of window/workspace state (module data persistence
 *     via persistence.js is already live).
 *   - Lock screen overlay (Spec §12).
 */

// Side-effect imports: modules register themselves with the registry.
import './themes.js';
import './persistence.js';
import './modules.js';
import './modules/tasks.js';

// Registry/theme/persistence APIs. The WM is a generic shell: it only
// ever talks to the module *registry*, never to specific modules
// (Spec §8).
import { DEFAULT_THEME_ID, applyTheme, getAllThemes } from './themes.js';
import { loadState, getModuleData, setModuleData } from './persistence.js';
import { getAllModules, getModule } from './modules.js';

/* ---------------------------------------------------------------
   Top bar clock (Spec §2) — live date (center) + time (right).
   Part of the shell chrome, not the WM proper.
   --------------------------------------------------------------- */

const DATE_OPTS = { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' };

function tickClock() {
  const now = new Date();
  const dateEl = document.getElementById('top-bar-center');
  const timeEl = document.getElementById('top-bar-right');
  if (dateEl) dateEl.textContent = now.toLocaleDateString('en-GB', DATE_OPTS).replace(/,/g, '');
  if (timeEl) timeEl.textContent = now.toLocaleTimeString('en-GB', { hour12: false });
}

function startClock() {
  tickClock();
  setInterval(tickClock, 1000);
}

/* ===============================================================
   Window Manager core — state
   Per the agreed data model:
   - 9 workspaces; array order of `windows` = tiling order (the
     first tiled window is the master).
   - Tiled geometry is derived at render time, never stored; floating
     geometry lives on the window; fullscreen is an overlay flag.
   - focusedWindowId is a single global pointer.
   =============================================================== */

const WORKSPACE_COUNT = 9;
const DEFAULT_MASTER_RATIO = 0.55;
const RATIO_STEP = 0.05;
const MIN_MASTER_RATIO = 0.2;
const MAX_MASTER_RATIO = 0.8;
const MIN_FLOAT_W = 160;
const MIN_FLOAT_H = 100;

const state = {
  activeWorkspace: 0,
  workspaces: Array.from({ length: WORKSPACE_COUNT }, () => ({
    layoutMode: 'master-stack',
    masterRatio: DEFAULT_MASTER_RATIO,
    windows: [],
    dwindleTree: null, // BSP tree of window ids (leaves); null in master-stack mode
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
  // Master-stack: new windows spawn as master, pushing the previous
  // master into the top of the stack (Spec §4). Dwindle: the new
  // window splits the currently focused window's space.
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
    // detach "in place": last tiled geometry becomes the initial
    // floating geometry (Spec §5); remaining tiled windows reflow.
    win.floatingGeometry = win._lastRect ?? { x: 60, y: 60, w: 480, h: 320 };
    win.state = 'floating';
    if (ws.layoutMode === 'dwindle') {
      ws.dwindleTree = treeRemove(ws.dwindleTree, win.id); // collapse node
    }
  } else {
    win.state = 'tiled';
    win.floatingGeometry = null; // tiled geometry is derived, not stored
    if (ws.layoutMode === 'dwindle') {
      // re-enter the tiling tree by splitting a sibling's space
      const targetId = dwindleSplitTarget(ws, focusedWindowId, win.id);
      ws.dwindleTree = treeInsert(ws.dwindleTree, targetId, win.id);
    }
  }
  render();
}

function toggleFullscreen(id) {
  const win = findWindow(id);
  if (!win) return;
  // overlay flag only — tiled slots / floating geometry untouched,
  // everything underneath is unaffected (Spec §5)
  win.isFullscreen = !win.isFullscreen;
  render();
}

function promoteToMaster(id) {
  const ws = currentWorkspace();
  if (ws.layoutMode !== 'master-stack') return; // no "master" in dwindle
  const idx = ws.windows.findIndex((w) => w.id === id);
  const masterIdx = ws.windows.findIndex((w) => w.state === 'tiled');
  if (idx === -1 || masterIdx === -1 || idx === masterIdx) return;
  if (ws.windows[idx].state !== 'tiled') return; // promotion is for tiled windows
  // swap focused window with the current master (Spec §10)
  [ws.windows[idx], ws.windows[masterIdx]] = [ws.windows[masterIdx], ws.windows[idx]];
  render();
}

/** Adjust the active layout's split (Spec §10). master-stack: only the
 * horizontal master ratio; dwindle: the focused window's parent split. */
function resizeSplit(delta, axis) {
  const ws = currentWorkspace();
  if (ws.layoutMode === 'dwindle') {
    const parent =
      focusedWindowId != null
        ? findParentNode(ws.dwindleTree, focusedWindowId)
        : null;
    if (!parent) return;
    parent.ratio = clamp(parent.ratio + delta, MIN_MASTER_RATIO, MAX_MASTER_RATIO);
  } else {
    if (axis !== 'h') return; // no vertical resize in master-stack
    ws.masterRatio = clamp(ws.masterRatio + delta, MIN_MASTER_RATIO, MAX_MASTER_RATIO);
  }
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
  render();
}

function switchWorkspace(n) {
  state.activeWorkspace = clamp(n, 0, WORKSPACE_COUNT - 1);
  const ws = currentWorkspace();
  focusedWindowId = ws.windows.length
    ? ws.windows[ws.windows.length - 1].id
    : null;
  render();
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
  if (vertical) {
    const split = Math.round(rect.w * node.ratio);
    layoutDwindle(node.left, { x: rect.x, y: rect.y, w: split, h: rect.h }, out);
    layoutDwindle(node.right, { x: rect.x + split, y: rect.y, w: rect.w - split, h: rect.h }, out);
  } else {
    const split = Math.round(rect.h * node.ratio);
    layoutDwindle(node.left, { x: rect.x, y: rect.y, w: rect.w, h: split }, out);
    layoutDwindle(node.right, { x: rect.x, y: rect.y + split, w: rect.w, h: rect.h - split }, out);
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
  render();
}

/* ---------- rendering ----------
   Window elements are cached per window id and reused across renders:
   modules mount their DOM once, and layout changes only move/resize
   the existing element (re-appending preserves listeners), so module
   content is never remounted or reset by WM reflows. */

const windowEls = new Map(); // win.id -> { el, content }

/** Services the WM hands to every module mount (Spec §8/§9). */
function createContext(moduleId) {
  return {
    load: () => getModuleData(moduleId),
    persist: (data) => setModuleData(moduleId, data),
  };
}

function createWindowEl(win) {
  const el = document.createElement('div');
  el.className = 'window';
  el.dataset.windowId = String(win.id);

  const content = document.createElement('div');
  content.className = 'window-content';
  el.appendChild(content);

  // generic mount — the WM knows nothing about this module (Spec §8)
  const mod = getModule(win.moduleId);
  if (mod?.mount) {
    mod.mount(content, createContext(win.moduleId));
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
      entry.el.remove?.();
      windowEls.delete(id);
    }
  }

  workspaceRoot.innerHTML = '';

  if (!ws.windows.length) {
    const hint = document.createElement('div');
    hint.id = 'empty-workspace-hint';
    hint.textContent = 'Alt+Enter to launch a module';
    workspaceRoot.appendChild(hint);
    renderPill();
    return;
  }

  const W = workspaceRoot.clientWidth;
  const H = workspaceRoot.clientHeight;

  // Layout geometry, fully derived (Spec §4). master-stack: first
  // tiled window is master (masterRatio width, full height); the rest
  // split the right column into equal-height slices. dwindle: walk
  // the per-workspace BSP tree.
  const tiled = tiledWindows(ws);
  const rects = new Map();
  if (ws.layoutMode === 'dwindle' && ws.dwindleTree) {
    layoutDwindle(ws.dwindleTree, { x: 0, y: 0, w: W, h: H }, rects);
  } else if (tiled.length === 1) {
    rects.set(tiled[0].id, { x: 0, y: 0, w: W, h: H });
  } else if (tiled.length > 1) {
    const masterW = Math.round(W * ws.masterRatio);
    rects.set(tiled[0].id, { x: 0, y: 0, w: masterW, h: H });
    const stack = tiled.slice(1);
    const sliceH = H / stack.length;
    stack.forEach((w, i) => {
      const y = Math.round(i * sliceH);
      rects.set(w.id, {
        x: masterW,
        y,
        w: W - masterW,
        h: Math.round((i + 1) * sliceH) - y, // avoids 1px gaps from rounding
      });
    });
  }

  for (const win of ws.windows) {
    const entry = windowEls.get(win.id) ?? createWindowEl(win);
    const el = entry.el;

    if (win.isFullscreen) {
      el.classList.add('fullscreen');
      setRect(el, { x: 0, y: 0, w: W, h: H });
    } else if (win.state === 'floating' && win.floatingGeometry) {
      el.classList.add('floating');
      setRect(el, win.floatingGeometry);
    } else {
      const r = rects.get(win.id) ?? { x: 0, y: 0, w: W, h: H };
      win._lastRect = r; // remembered for "detach in place" (Spec §5)
      setRect(el, r);
    }

    if (win.id === focusedWindowId) el.classList.add('focused');

    workspaceRoot.appendChild(el); // re-attach the cached element
  }

  renderPill();
}

function setRect(el, r) {
  el.style.left = `${r.x}px`;
  el.style.top = `${r.y}px`;
  el.style.width = `${r.w}px`;
  el.style.height = `${r.h}px`;
}

/* ---------- keybinds (Spec §10) ---------- */

function bindKeybinds() {
  window.addEventListener('keydown', (e) => {
    if (!e.altKey) return;
    // don't hijack typing in future inputs (launcher, module content)
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? '')) return;

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
    else if (/^[1-9]$/.test(key) && !e.shiftKey) switchWorkspace(Number(key) - 1);
    else handled = false;

    // keep all Alt combos away from browser/OS menu behavior
    if (handled) e.preventDefault();
  });
}

/* ---------- mouse behavior (Spec §11) ---------- */

// active drag session: { type: 'move'|'resize'|'swap'|'ratio', ... }
let activeDrag = null;

function bindMouse() {
  // focus-follows-hover (paused while dragging so focus doesn't steal)
  workspaceRoot.addEventListener('mouseover', (e) => {
    if (activeDrag) return;
    const el = e.target.closest?.('.window');
    if (el) focusWindow(Number(el.dataset.windowId));
  });

  workspaceRoot.addEventListener('mousedown', (e) => {
    if (!e.altKey) return;
    const el = e.target.closest?.('.window');
    if (!el) return;
    e.preventDefault();
    const win = findWindow(Number(el.dataset.windowId));
    if (!win) return;
    focusWindow(win.id);

    if (e.button === 0) {
      if (win.state === 'floating') startMoveDrag(win, el, e);
      else startSwapDrag(win);
    } else if (e.button === 2) {
      if (win.state === 'floating') startResizeDrag(win, el, e);
      else startRatioDrag();
    }
  });

  // suppress the native context menu during Alt+RightClick drags
  workspaceRoot.addEventListener('contextmenu', (e) => {
    if (e.altKey || activeDrag) e.preventDefault();
  });

  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);
}

function startMoveDrag(win, el, e) {
  const rootRect = workspaceRoot.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  activeDrag = {
    type: 'move',
    win,
    el,
    rootRect,
    offsetX: e.clientX - r.left,
    offsetY: e.clientY - r.top,
  };
}

function startResizeDrag(win, el, e) {
  activeDrag = {
    type: 'resize',
    win,
    el,
    rootRect: workspaceRoot.getBoundingClientRect(),
    startX: e.clientX,
    startY: e.clientY,
    startW: el.offsetWidth,
    startH: el.offsetHeight,
  };
}

function startSwapDrag(win) {
  activeDrag = { type: 'swap', win };
}

function startRatioDrag() {
  activeDrag = { type: 'ratio', rootRect: workspaceRoot.getBoundingClientRect() };
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
    // live master/stack ratio follows the pointer (Spec §11)
    const { rootRect } = activeDrag;
    currentWorkspace().masterRatio = clamp(
      (e.clientX - rootRect.left) / rootRect.width,
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
    const r = drag.el.getBoundingClientRect();
    drag.win.floatingGeometry = {
      x: Math.round(r.left - drag.rootRect.left),
      y: Math.round(r.top - drag.rootRect.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
    render();
  } else if (drag.type === 'swap') {
    // tiled Alt+Left-drag: swap with whichever window was dropped onto
    const hit = document.elementFromPoint?.(e.clientX, e.clientY)?.closest?.('.window');
    if (hit) {
      const target = findWindow(Number(hit.dataset.windowId));
      if (target && target.id !== drag.win.id && drag.win.state === 'tiled' && target.state === 'tiled') {
        swapWindows(drag.win.id, target.id);
      }
    }
  }
  // 'ratio' commits live via render() during move
}

/* ---------- workspace indicator pill (Spec §3) ---------- */

const ICON_LAYOUT = '\uf0db'; // Nerd Font "columns" glyph
const ICON_THEME = '\uf042';  // Nerd Font "adjust" glyph (half-filled circle)

function renderPill() {
  const pill = document.getElementById('workspace-pill');
  if (!pill) return;
  pill.innerHTML = '';

  // layout + theme toggles live left of the workspace numbers
  const layoutBtn = document.createElement('span');
  layoutBtn.className = 'pill-icon';
  layoutBtn.textContent = ICON_LAYOUT;
  layoutBtn.title = 'toggle layout (master-stack / dwindle)';
  layoutBtn.addEventListener('click', toggleLayout);

  const themeBtn = document.createElement('span');
  themeBtn.className = 'pill-icon';
  themeBtn.textContent = ICON_THEME;
  themeBtn.title = 'theme picker';
  themeBtn.addEventListener('click', toggleThemePicker);

  pill.append(layoutBtn, themeBtn);

  for (let n = 1; n <= WORKSPACE_COUNT; n++) {
    // slots 1-3 always visible; 4-9 only while populated (Spec §3)
    if (n > 3 && !state.workspaces[n - 1].windows.length) continue;
    const slot = document.createElement('span');
    slot.className = 'pill-slot' + (n - 1 === state.activeWorkspace ? ' active' : '');
    slot.textContent = String(n);
    slot.addEventListener('click', () => switchWorkspace(n - 1));
    pill.appendChild(slot);
  }
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
  launcher?.overlay.remove();
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
  if (!launcher) return; // stale input events after close
  launcher.filtered = getAllModules().filter((m) => fuzzyMatch(query, m.name));
  launcher.selected = 0;
  renderLauncherList();
}

function renderLauncherList() {
  if (!launcher) return;
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
  if (!launcher) return;
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

  for (const theme of getAllThemes()) {
    const item = document.createElement('li');
    item.className = 'theme-item';

    const swatches = document.createElement('span');
    swatches.className = 'theme-swatches';
    for (const color of Object.values(theme.colors)) {
      const sw = document.createElement('span');
      sw.className = 'theme-swatch';
      sw.style.background = color;
      swatches.appendChild(sw);
    }

    const name = document.createElement('span');
    name.className = 'theme-name';
    name.textContent = theme.name;
    item.append(swatches, name);

    item.addEventListener('click', () => {
      applyTheme(theme.id); // instant via CSS custom properties
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
  themePicker?.overlay.remove();
  themePicker = null;
}

/**
 * App bootstrap.
 * Applies theme, starts the top-bar clock, binds WM keybinds + mouse
 * behavior. Workspaces start empty — Alt+Enter opens the launcher.
 */
function init() {
  const restored = loadState();
  applyTheme(restored?.activeTheme ?? DEFAULT_THEME_ID);
  startClock();

  workspaceRoot = document.getElementById('workspace-root');
  bindKeybinds();
  bindMouse();
  window.addEventListener('resize', render);

  render(); // initial paint: empty-workspace hint + pill
}



if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
