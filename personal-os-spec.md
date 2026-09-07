# Personal OS — Project Specification

A single-page web app that behaves like a tiling window manager (Linux-style, e.g. dwm/i3/Hyprland), where "apps" are modules rendered as tiled or floating windows inside the browser. Single-user, no backend, no accounts.

---

## 1. Tech Stack

- **Vanilla HTML, CSS, and JavaScript only.** No framework (no React/Vue/Svelte), no build step, no bundler, no npm dependencies.
- The whole app should be runnable by opening `index.html` directly, or via a trivial static file server.
- Code should be organized into separate JS files by concern (window manager core, module registry, individual modules, theming, persistence), loaded as ES modules (`<script type="module">`), rather than one giant file.
- Keep it as lean and dependency-free as realistically possible.

---

## 2. Visual Shell

### Background
- Single solid-color background, full page. No gradients, no imagery.
- Color comes from the active theme (see Section 6).

### Top Bar
Fixed bar across the top of the screen, three zones:
- **Left:** Project name, "Personal OS"
- **Center:** Current date (live, updates automatically)
- **Right:** Current time (live, updates automatically, e.g. every second or minute)

### Fonts & Icons
- Fonts: **Geist Mono** and **JetBrains Mono** (self-hosted or loaded via CDN/local files — pick whichever keeps things simplest and offline-capable if possible).
- Icons: **Nerd Font** glyphs, used for module icons (in the launcher and in each window's embedded title bar).

### Window Styling
- No rounded corners (sharp, `border-radius: 0`).
- 2px solid border on every window.
- No OS-level window chrome (no native-looking title bar, no min/max/close buttons rendered by the WM itself).
- Each module is responsible for rendering its own **embedded title** inside its own content area — an icon + module name that visually sits at the top of the window's content, styled to look like part of the window rather than a separate control.

---

## 3. Workspaces

- **9 workspaces total.**
- Switch workspaces with `Alt+1` through `Alt+9`.
- Each workspace independently holds:
  - Its own set of open windows (tiled + floating)
  - Its own tiling layout mode (master-stack or dwindle — see Section 4)
  - Its own master/stack ratio and any dwindle split state
- **Empty workspace state:** when a workspace has zero windows open, show a subtle centered hint text (e.g. "Alt+Enter to launch a module"). Nothing else renders.

### Workspace Indicator (bottom pill)
- Small, minimal pill, anchored to the bottom of the screen, floating (not full-width).
- Shows workspace numbers 1–9, but:
  - **Slots 1, 2, 3 are always visible**, even if empty.
  - **Slots 4–9 only appear once they have at least one window open**, and disappear again once emptied — the pill dynamically grows/shrinks.
  - The currently active workspace is visually highlighted.
- Two additional icons live in this pill, next to the workspace numbers (exact side — left or right of the numbers — implementer's choice, doesn't need to match on both sides):
  - **Layout toggle icon** — click to toggle the *current workspace's* tiling mode between master-stack and dwindle.
  - **Theme toggle icon** — click to open the theme picker (see Section 6).

---

## 4. Tiling Layouts

Each workspace has one active layout mode, toggled independently per-workspace via the pill icon.

### Master-Stack (default for new workspaces)
- One **master pane** on the left, taking **55% width**, full height.
- Remaining windows form a **stack** on the right, taking the remaining **45% width**, split into equal-height horizontal slices (flat vertical stack — e.g. 2 stacked windows = 50% height each, 3 = 33% each, etc.).
- **New windows always spawn as master**, pushing the previous master window down into the top of the stack.
- Master/stack width ratio (55/45 default) is adjustable live.

### Dwindle
- Hyprland-style recursive binary space partitioning: each new window splits the currently focused window's space in half, alternating split axis (horizontal/vertical) based on the container's aspect ratio — standard BSP/dwindle behavior.

---

## 5. Window Manager Behavior

### Floating Windows
- Toggled via `Alt+V` on the focused window.
- When a tiled window becomes floating, it detaches "in place" (keeps roughly its last tiled size/position as its initial floating geometry), and the remaining tiled windows reflow to fill the gap it left.
- Floating windows remember their position/size independently, including across fullscreen toggle (see below).

### Fullscreen / Maximize
- Toggled via `Alt+F` on the focused window.
- The window expands to fill the entire workspace viewport, rendered as an overlay on top of everything else in that workspace.
- All other windows underneath (tiled or floating) are completely unaffected — no re-layout, no resizing — they're simply visually covered.
- Pressing `Alt+F` again restores the window to exactly where it was: back into its tiled slot (unchanged), or back to its previous floating position/size.

### Singleton Modules
- Each module can only have **one open instance at a time**, across the entire app (not per-workspace).
- If you try to launch a module that's already open (via the launcher), the app switches to the workspace where it currently lives and focuses it — it never opens a duplicate.

### Closing
- `Alt+Q` closes the focused window.
- If it was the last window in its workspace, that workspace returns to the empty-state hint.

---

## 6. Theming

- Themes are fully dynamic/swappable at runtime — not hardcoded.
- **Everforest** (green) is the default/placeholder theme, but the system must support adding more.
- Each theme defines a solid background color plus its accent/UI colors — a theme should have **4–5 core colors** (e.g. background, foreground/text, accent, border/focus-highlight, and one more secondary accent).
- **Implementation approach:** each theme is a set of CSS custom properties (CSS variables) applied at the root (e.g. swapping a `data-theme="everforest"` attribute on `<html>` or `<body>`), so all styling references `var(--color-*)` and switching is instant.

### Included Themes
Ship with the following popular color schemes out of the box (each defines background, foreground/text, accent, border/focus-highlight, and one secondary accent — 5 core colors each):

- **Everforest** (dark) — default
- **Gruvbox** (dark)
- **Nord**
- **Dracula**
- **Catppuccin Mocha**
- **Solarized Dark**
- **Solarized Light**
- **Tokyo Night**
- **One Dark**
- **Rosé Pine**
- **Monokai**

Each should use that theme's well-known/canonical palette (these are all popular, well-documented terminal/editor color schemes — Cline should be able to source accurate hex values for each from common references). The theme registry should be structured the same way modules are (Section 8) — a simple list a new theme can be appended to without touching picker/rendering logic.

### Theme Picker
- Opened via the theme-toggle icon in the workspace pill.
- Opens as a small popup/modal window, centered on screen.
- Shows a preview list/grid of all available themes — each entry displays that theme's 4–5 core colors as small swatches, plus the theme name.
- Clicking a theme entry applies it immediately and closes (or stays open — implementer's choice) the popup.

---

## 7. Module Launcher

- Opened via `Alt+Enter`.
- Appears as a centered popup with a text input at the top.
- Below the input, a **vertical sorted list** of all registered modules (name + Nerd Font icon each) — not a grid.
- Typing fuzzy-filters the list live.
- Navigable via keyboard (arrow keys + Enter to launch the highlighted result) **and** via mouse click on any list entry.
- Selecting a module:
  - If it's not currently open anywhere → launches it as the new master window in the current workspace (or per the active layout's "new window" rule).
  - If it's already open elsewhere (singleton) → switches to that workspace and focuses it instead.

---

## 8. Module Architecture

The window manager itself must be a fully generic shell — it has **no knowledge of what any specific module does**. Modules are like "installed apps" plugged into the system via a defined interface.

Each module should be a self-contained unit (its own file/folder) that registers itself with a central module registry, providing at minimum:
- A unique ID
- Display name
- Nerd Font icon glyph
- A render/mount function that returns or injects its DOM content into a window's content area
- (Optionally) a cleanup/unmount function, if the module needs to tear down timers/listeners on close

Adding a new module later should require **zero changes** to the window manager core — only adding a new module file and registering it.

### First Module: Tasks
- Simple to-do list.
- Checkbox-style items (check to mark complete).
- Basic add/remove item functionality.
- Should persist its own data (see Section 9).

---

## 9. Persistence

All state persists in `localStorage` under a **single JSON key** (e.g. `personal-os-state`), to keep it simple to reason about and version later. Suggested shape:

```json
{
  "activeWorkspace": 1,
  "activeTheme": "everforest",
  "workspaces": {
    "1": {
      "layoutMode": "master-stack",
      "masterRatio": 0.55,
      "windows": [
        {
          "moduleId": "tasks",
          "state": "tiled",
          "floatingGeometry": null,
          "isMaster": true
        }
      ]
    }
  },
  "moduleData": {
    "tasks": {
      "items": []
    }
  }
}
```

- State is saved on every meaningful change (window open/close/move/resize, workspace switch, theme change) and restored on page load.
- Module-specific data (e.g. Tasks' to-do items) lives in its own `moduleData` section, keyed by module ID, so modules own their data independent of window/layout state.

---

## 10. Full Keybind Reference

| Keybind | Action |
|---|---|
| `Alt + H / J / K / L` | Cycle focus between windows (left/down/up/right) |
| `Alt + Shift + H / J / K / L` | Resize master/stack ratio (or adjust dwindle split) in that direction |
| `Alt + W` | Promote focused window to master (swaps with current master) |
| `Alt + V` | Toggle focused window between tiling and floating |
| `Alt + F` | Toggle fullscreen/maximize for focused window |
| `Alt + Q` | Close focused window |
| `Alt + Enter` | Open module launcher |
| `Alt + 1` – `Alt + 9` | Switch to workspace 1–9 |

**Note for implementer:** `Alt` combos can trigger browser/OS menu behavior in some browsers — make sure to call `event.preventDefault()` on all of these at the `keydown` listener level. `Alt+RightClick` drag will also need `event.preventDefault()` on `contextmenu` to suppress the native right-click menu during resize drags.

---

## 11. Mouse Behavior

- **Focus-follows-hover:** moving the mouse over a window focuses it automatically (no click required).
- **`Alt + Left-Click` + drag:**
  - On a **floating** window → moves it freely.
  - On a **tiled** window → swaps its position with whichever window it's dropped onto.
- **`Alt + Right-Click` + drag:**
  - On a **floating** window → resizes it freely.
  - On a **tiled** window → adjusts the master/stack split ratio (or dwindle split) in that direction.
- Plain clicks still work normally for: launcher list items, theme picker entries, layout/theme toggle icons in the pill, and any interactive content inside a module (e.g. checking off a Tasks item).

---

## 12. Lock Screen

A minimal, non-functional-beyond-basics lock overlay — a soft deterrent, not real security (this is a client-side-only app; a determined user could view the PIN in source).

- On load (or when manually triggered), a full-screen overlay covers the entire page, blocking all interaction with the workspace underneath.
- Shows:
  - The name **"Personal OS"**, pre-filled and **not editable** (just a display label, not a username field).
  - A PIN input field.
- **PIN:** `464466`, hardcoded in the client-side JS.
- Entering the correct PIN dismisses the overlay and reveals the page as normal.
- Entering an incorrect PIN just rejects it (e.g. shake animation or brief error text, clear the input) — no lockout, no attempt limiting, no extra logic needed.
- Styling should match the app's aesthetic: solid background (theme-aware), sharp corners, monospace font, minimal.
- **Trigger:** lock automatically whenever the page loads/reloads. (Optional/implementer's choice: also add a manual "lock now" trigger somewhere small and unobtrusive, e.g. a keybind like `Alt+Shift+L`, if it's easy to add — not a requirement.)
- This is purely a UI gate — it does not encrypt or protect localStorage data, and does not need to survive anything more sophisticated than "someone walks up to an unlocked screen."

---

## 13. Summary of Design Principles

- **Minimalist:** no framework, no build tooling, no unnecessary dependencies.
- **Keyboard-first:** every core WM action has a keybind; mouse support is a convenience layer on top, not a requirement.
- **Modular/extensible:** the WM core knows nothing about individual modules; modules plug in via a simple registry interface.
- **No visual clutter:** no window chrome, sharp corners, solid backgrounds, subtle empty-state hints only.
- **Single-user, client-only:** no backend, no auth, everything lives in the browser via localStorage.
