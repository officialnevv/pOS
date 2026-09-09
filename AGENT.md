# AGENT.md

Guidance for AI coding agents working on pOS. Read this first; `personal-os-spec.md` is the authoritative behavioral spec.

## What this is

pOS is a browser-based personal dashboard that behaves like a tiling window manager: 9 workspaces, dwindle (BSP) tiling, floating windows, fullscreen, a module launcher (Alt+W), theming, and a lock screen (PIN `000000`, hardcoded client-side). "Apps" are modules that render into WM windows.

- **Stack:** vanilla HTML/CSS/JS. No framework, no build step, no bundler, no dependencies. Fonts are self-hosted (`assets/fonts/`), so it works fully offline.
- **Run it:** ES modules require HTTP — `python -m http.server 8080` (or any static server / Live Server), then open `http://localhost:8080`. `file://` will not work.
- **Layout:** dwindle-only. There is no master-stack layout and no layout toggle — do not reintroduce one.

## Architecture

- **Modules** (`js/modules/*.js`) are self-contained units registered via `registerModule()` in `js/modules.js` with `{ id, name, icon (Nerd Font glyph), mount(container, context), unmount(container) }`. The WM core never imports module internals; **a new module must never require changes to `js/wm-core.js`**. Module data flows through the mount `context` (`context.load()` / `context.persist(slice)`).
- **Theming:** colors only via CSS custom properties (`var(--color-accent)`, `var(--color-border)`, etc.) defined per-theme in `style.css` / `js/themes.js`. **Never hardcode hex colors** in component styles — 11 themes must stay swappable. `--color-border` doubles as the secondary/muted text color (meta rows, dates, descriptions, placeholders, dimmed entries) and every theme keeps it at **≥ 4.5:1 WCAG AA contrast against the background** — preserve that baseline when adding or adjusting themes.
- **No native form elements:** text inputs, buttons, checkboxes, number steppers, etc. must be custom-styled to the theme system. Established patterns: the custom checkbox in Tasks (`.task-check`), the ± steppers in Pomodoro (`.pomodoro-step-*`), the custom buttons in Tasks/Weather/Pomodoro.
- **Window aesthetic:** sharp corners (`border-radius: 0`), 2px solid borders, transparent backgrounds. Each module renders its own embedded title bar (icon + name, `.module-title`) — the WM does not draw module titles.
- **Persistence:** everything lives in a single `localStorage` key (`personal-os-state`) as one JSON blob (Spec §9). Module data goes under `moduleData.<moduleId>`. The Pomodoro timer is deliberately **not** persisted (live session timer).

## Tiling model

Dwindle BSP only. Each split's **axis is frozen at creation** (`axis` on BSP nodes, chosen by `measureSplitAxis()`), persisted in `dwindleTree`, and never re-derived from the current aspect ratio. This is deliberate: re-deriving caused a bug where resizing one window re-oriented unrelated subtrees ("snapping"). `normalizeTreeAxes()` migrates legacy axis-less trees on restore — keep that migration path working (it depends on `workspaceRoot` being assigned **before** `restoreState()` in `init()`; that ordering was a past bug).

## Keybinds (current, complete)

| Keybind | Action |
|---|---|
| `Alt + H / J / K / L` | Cycle focus between windows |
| `Alt + V` | Toggle tiled/floating for the focused window |
| `Alt + F` | Toggle fullscreen for the focused window |
| `Alt + Q` | Close the focused window |
| `Alt + W` | Open the module launcher |
| `Alt + 1` – `Alt + 9` | Switch to workspace 1–9 |
| `Alt + Shift + 1` – `Alt + Shift + 9` | Move focused window to workspace 1–9 (view follows) |

Removed/reassigned bindings — do not silently reintroduce: **Alt+Shift+H/J/K/L** (keyboard resize, removed) and **Alt+Enter** (old launcher key, now Alt+W).

**Mouse:** hover focuses a window. `Alt + Left-Click` drag moves a floating window or swaps a tiled window with the drop target. `Alt + Right-Click` drag resizes (floating: opposite corner anchored; tiled: mouse direction drives the split — horizontal movement moves vertical splits, vertical movement horizontal splits, diagonal both). Plain left-click on a shared border between tiles resizes.

## Code style

This codebase has been through explicit cleanup/humanizing passes. Keep that bar:

- No dead code, no commented-out blocks, no speculative abstraction.
- No AI-typical over-commenting and no defensive checks for impossible states — comment only non-obvious intent (e.g. why an axis is frozen, why something is deliberately not persisted).
- Descriptive names, consistent formatting with the surrounding file.
- Verify changes with a throwaway DOM-stub test (`smoke-test.mjs`, run with `node`; write results to `test-results.txt` — shell output capture is unreliable in this environment) and delete the artifacts afterward. `node --check <file>` for syntax.

## Scope constraints

This is a **personal, single-user** project: no auth, no accounts, no backend, no multi-user concerns, localStorage is not encrypted. Preserve those constraints unless explicitly asked otherwise. The old `PersonalOS` folder is stale — the project lives here.

## Changelog

- 2026-09-09 — Muted-text contrast fix: `--color-border` (secondary/muted text in all modules) failed WCAG AA against the background in all 11 themes (1.14–1.80:1). Raised every theme's `border` value to ≥ 4.71:1, using each scheme's canonical muted/comment shade where one clears AA (Everforest grey2, Gruvbox fg4, Catppuccin overlay2, Solarized base0/base01, Rosé Pine subtle) and a blend of the theme's comment hue toward its foreground otherwise (Nord, Dracula, Tokyo Night, One Dark, Monokai). Baseline documented in the Theming bullet above and in Spec §6.
