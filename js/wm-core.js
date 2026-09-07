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
 * Implemented (this phase, with placeholder windows):
 *   - Workspace state: 9 workspaces, each with its own windows,
 *     layoutMode + masterRatio (dwindle engine itself is still TODO).
 *   - Master-stack tiling (55/45 default, live-adjustable), new
 *     windows spawn as master (Spec §4).
 *   - Window lifecycle: open/close (Alt+Q), promote to master
 *     (Alt+W), toggle floating (Alt+V, detaches in place), fullscreen
 *     overlay (Alt+F).
 *   - Keybind handling: Alt+H/J/K/L focus, Alt+Shift+H/L ratio
 *     resize, Alt+1..9 workspaces, all with preventDefault (Spec §10).
 *     (Alt+Enter reserved for the launcher, TODO.)
 *   - Mouse behavior: focus-follows-hover, Alt+LeftClick drag
 *     (move/swap), Alt+RightClick drag (resize/ratio, with
 *     contextmenu suppressed) (Spec §11).
 *   - Shell chrome: live top-bar clock/date, empty-workspace hint.
 *
 * Still TODO in later phases:
 *   - Module launcher (Alt+Enter) + theme picker popups.
 *   - Workspace indicator pill (Spec §3) — Alt+1..9 works already.
 *   - Dwindle layout engine + per-workspace layout toggle.
 *   - Windows currently render placeholder labels; real module
 *     mounting via modules.js comes next.
 *   - Persistence of window/workspace state.
 */

// Side-effect imports: modules register themselves with the registry.
import './themes.js';
import './persistence.js';
import './modules.js';
import './modules/tasks.js';

// Registry/theme/persistence APIs used during init (real usage TBD).
import { DEFAULT_THEME_ID, applyTheme } from './themes.js';
import { loadState } from './persistence.js';

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

function openWindow(label) {
  const ws = currentWorkspace();
  const win = {
    id: nextWindowId++,
    label,
    state: 'tiled',
    floatingGeometry: null,
    isFullscreen: false,
  };
  // New windows always spawn as master, pushing the previous master
  // into the top of the stack (Spec §4).
  const firstTiledIdx = ws.windows.findIndex((w) => w.state === 'tiled');
  if (firstTiledIdx === -1) ws.windows.push(win);
  else ws.windows.splice(firstTiledIdx, 0, win);
  focusedWindowId = win.id;
  render();
  return win;
}

function closeWindow(id) {
  if (id == null) return;
  const ws = currentWorkspace();
  const idx = ws.windows.findIndex((w) => w.id === id);
  if (idx === -1) return;
  ws.windows.splice(idx, 1);
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
  const win = findWindow(id);
  if (!win || win.isFullscreen) return;
  if (win.state === 'tiled') {
    // detach "in place": last tiled geometry becomes the initial
    // floating geometry (Spec §5); remaining tiled windows reflow.
    win.floatingGeometry = win._lastRect ?? { x: 60, y: 60, w: 480, h: 320 };
    win.state = 'floating';
  } else {
    win.state = 'tiled';
    win.floatingGeometry = null; // tiled geometry is derived, not stored
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
  const idx = ws.windows.findIndex((w) => w.id === id);
  const masterIdx = ws.windows.findIndex((w) => w.state === 'tiled');
  if (idx === -1 || masterIdx === -1 || idx === masterIdx) return;
  if (ws.windows[idx].state !== 'tiled') return; // promotion is for tiled windows
  // swap focused window with the current master (Spec §10)
  [ws.windows[idx], ws.windows[masterIdx]] = [ws.windows[masterIdx], ws.windows[idx]];
  render();
}

function resizeMasterRatio(delta) {
  const ws = currentWorkspace();
  ws.masterRatio = clamp(ws.masterRatio + delta, MIN_MASTER_RATIO, MAX_MASTER_RATIO);
  render();
}

function swapWindows(aId, bId) {
  const ws = currentWorkspace();
  const i = ws.windows.findIndex((w) => w.id === aId);
  const j = ws.windows.findIndex((w) => w.id === bId);
  if (i === -1 || j === -1) return;
  [ws.windows[i], ws.windows[j]] = [ws.windows[j], ws.windows[i]];
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

/* ---------- rendering ---------- */

function render() {
  const ws = currentWorkspace();
  workspaceRoot.innerHTML = '';

  if (!ws.windows.length) {
    const hint = document.createElement('div');
    hint.id = 'empty-workspace-hint';
    // TEMP text; becomes "Alt+Enter to launch a module" with the launcher
    hint.textContent = 'empty workspace — Alt+N opens a test window';
    workspaceRoot.appendChild(hint);
    return;
  }

  const W = workspaceRoot.clientWidth;
  const H = workspaceRoot.clientHeight;

  // Master-stack geometry, fully derived (Spec §4): first tiled window
  // is master (masterRatio width, full height); the rest split the
  // right column into equal-height slices.
  const tiled = tiledWindows(ws);
  const rects = new Map();
  if (tiled.length === 1) {
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
    const el = document.createElement('div');
    el.className = 'window';
    el.dataset.windowId = String(win.id);

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

    const label = document.createElement('div');
    label.className = 'window-label';
    label.textContent = win.label;
    const tag = document.createElement('div');
    tag.className = 'window-tag';
    tag.textContent = win.isFullscreen ? 'fullscreen' : win.state;
    el.append(label, tag);
    workspaceRoot.appendChild(el);
  }
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

    if (key === 'h') e.shiftKey ? resizeMasterRatio(-RATIO_STEP) : cycleFocus(-1);
    else if (key === 'l') e.shiftKey ? resizeMasterRatio(+RATIO_STEP) : cycleFocus(+1);
    // j/k: no vertical resize in master-stack (stack slices are fixed
    // height); will map to dwindle split adjustments later
    else if (key === 'j' && !e.shiftKey) cycleFocus(+1);
    else if (key === 'k' && !e.shiftKey) cycleFocus(-1);
    else if (key === 'w' && !e.shiftKey) promoteToMaster(focusedWindowId);
    else if (key === 'v' && !e.shiftKey) toggleFloating(focusedWindowId);
    else if (key === 'f' && !e.shiftKey) toggleFullscreen(focusedWindowId);
    else if (key === 'q' && !e.shiftKey) closeWindow(focusedWindowId);
    // TEMP: test spawner until the module launcher exists
    else if (key === 'n' && !e.shiftKey) openWindow(`Window ${nextWindowId}`);
    else if (key === 'enter') { /* module launcher — TODO */ }
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

/**
 * App bootstrap.
 * Applies theme, starts the top-bar clock, binds WM keybinds + mouse
 * behavior, seeds test windows until the module launcher exists.
 */
function init() {
  const restored = loadState();
  applyTheme(restored?.activeTheme ?? DEFAULT_THEME_ID);
  startClock();

  workspaceRoot = document.getElementById('workspace-root');
  bindKeybinds();
  bindMouse();
  window.addEventListener('resize', render);

  // TEMP: dummy windows for testing the WM; replaced by the launcher
  // + real module mounting next.
  openWindow('Window 1');
  openWindow('Window 2');
  openWindow('Window 3');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
