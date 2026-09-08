# pOS

**pOS** is a personal dashboard that works like a tiling window manager — think dwm/i3/Hyprland, but running entirely in your browser tab. "Apps" are modules rendered as tiled or floating windows inside the page: 9 independent workspaces, dwindle (BSP) or master-stack tiling, keyboard-driven window management, runtime-switchable color themes, and a lock screen. It ships with an empty module registry by design — the window manager is a generic shell, and any "app" (to-do list, notes, launcher-driven tools) can be plugged in as a self-contained module without touching the core.

## Tech Stack

- **Vanilla HTML / CSS / JavaScript** — no framework, no build step, no bundler, no npm dependencies.
- ES modules, organized by concern (`wm-core.js`, `modules.js`, `themes.js`, `persistence.js`, `lockscreen.js`).
- State persists in a single `localStorage` JSON blob (`personal-os-state`); single-user, client-only, no backend, no accounts.
- Self-hosted fonts (Geist Mono, JetBrains Mono, Nerd Font symbols) in `assets/fonts/` — fully offline-capable.

## Running Locally

Because the app uses ES modules, it must be served over HTTP (opening `index.html` via `file://` will be blocked by the browser). Any trivial static server works:

```bash
# Python
python -m http.server 8080
# then open http://localhost:8080

# or Node
npx serve .
```

…or use the **VS Code "Live Server"** extension ("Open with Live Server" on `index.html`).

On load you'll be greeted by the lock screen — the PIN is **464466** (hardcoded client-side; it's a soft deterrent, not security — see Spec §12). It auto-unlocks as soon as the PIN is fully typed.

## Keybinds

| Keybind | Action |
|---|---|
| `Alt + H / J / K / L` | Cycle focus between windows (left/down/up/right) |
| `Alt + Shift + H / J / K / L` | Resize master/stack ratio (or the focused dwindle split) in that direction |
| `Alt + W` | Promote focused window to master (swaps with current master) |
| `Alt + V` | Toggle focused window between tiling and floating |
| `Alt + F` | Toggle fullscreen/maximize for the focused window |
| `Alt + Q` | Close focused window |
| `Alt + Enter` | Open the module launcher |
| `Alt + 1` – `Alt + 9` | Switch to workspace 1–9 |
| `Alt + Shift + 1` – `Alt + Shift + 9` | Move the focused window to workspace 1–9 (the view follows it) |

## Mouse Controls

- **Focus-follows-hover** — moving the mouse over a window focuses it (no click needed).
- **`Alt + Left-Click` + drag** — on a floating window: move it freely; on a tiled window: swap it with the window you drop it onto.
- **`Alt + Right-Click` + drag** — on a floating window: resize it; on a tiled window: adjust the master/stack ratio (or dwindle split) in that direction.
- Plain clicks work normally everywhere else (launcher entries, theme picker, pill icons, module content).

## Features

- **9 workspaces** (`Alt+1`–`9`), each with its own windows, layout mode, and split state; the bottom pill shows workspace slots (1–3 always, 4–9 only while populated) plus layout/theme toggles.
- **Two tiling layouts**, toggleable per workspace: **dwindle** (Hyprland-style BSP, the default) and **master-stack** (55/45 with an adjustable ratio); outer + inner gaps between windows.
- **Floating & fullscreen windows** — floating geometry is remembered across tile/float round-trips; fullscreen is a non-destructive overlay.
- **Singleton modules** — a module can only be open once across all workspaces; relaunching focuses the existing window.
- **11 themes** (Everforest, Gruvbox, Nord, Dracula, Catppuccin Mocha, Solarized Dark/Light, Tokyo Night, One Dark, Rosé Pine, Monokai) — switchable instantly at runtime via the pill's theme icon.
- **Lock screen** on every page load, theme-aware, auto-unlock with fade-out.
- **Module architecture (Spec §8)** — the registry is intentionally empty; a new module is one file under `js/modules/` calling `registerModule()` plus one side-effect import in `wm-core.js`, with zero changes to the WM core.

## Scope

pOS is a **personal, single-user project** — it runs entirely client-side with no backend and is not intended for multi-user or production deployment. State lives unencrypted in your browser's localStorage.
