# AGENT.md

Guidance for AI coding agents working on pOS. Read this first; `personal-os-spec.md` is the authoritative behavioral spec.

## What this is

pOS is a browser-based personal dashboard that behaves like a tiling window manager: 9 workspaces, dwindle (BSP) tiling, floating windows, fullscreen, a module launcher (Alt+W), theming, and a lock screen (PIN `000000`, hardcoded client-side). "Apps" are modules that render into WM windows.

- **Stack:** vanilla HTML/CSS/JS. No framework, no build step, no bundler, no dependencies. Fonts are self-hosted (`assets/fonts/`), so it works fully offline.
- **Run it:** ES modules require HTTP — `python -m http.server 8080` (or any static server / Live Server), then open `http://localhost:8080`. `file://` will not work.
- **Layout:** dwindle-only. There is no master-stack layout and no layout toggle — do not reintroduce one.

## Architecture

- **Modules** (`js/modules/*.js`) are self-contained units registered via `registerModule()` in `js/modules.js` with `{ id, name, icon (Nerd Font glyph), mount(container, context), unmount(container) }`. The WM core never imports module internals; **a new module must never require changes to `js/wm-core.js`**. Module data flows through the mount `context` (`context.load()` / `context.persist(slice)` / `context.openModule(id)` — the last one is a singleton-aware launch hook, used by the Dashboard's clickable cards).
- **Dashboard exception (deliberate):** the Dashboard is the one module that breaks self-containment — it **reads** other modules' `moduleData` slices directly (read-only, via `persistence.getModuleData`), never writes to them, and keeps no `moduleData` of its own (pure read view; its summary is a snapshot taken at mount). It also auto-opens into workspace 1 on every page load via the `ensureDashboardOpen()` bootstrap check in wm-core — closing it dismisses it for the current session only. Acceptable because the Dashboard is inherently a cross-cutting summary view.
- **Shipped modules:** Tasks (to-do list), Notes (markdown notes with preview), Pomodoro (focus timer), Weather (Open-Meteo forecast), Agenda (dated entries), Bookmarks (saved links), Watch Later (video links with YouTube title fetch), Goals (checkpoints + derived/manual progress), Repositories (GitHub repo library — one-shot metadata fetch from the public API, manual refresh/retry, live name search as view state), Dashboard (read-only cross-module summary; auto-opens on workspace 1 every load).
- **Theming:** colors only via CSS custom properties (`var(--color-accent)`, `var(--color-border)`, `var(--color-text-muted)`, etc.) defined per-theme in `style.css` / `js/themes.js`. **Never hardcode hex colors** in component styles — 11 themes must stay swappable. `--color-border` is for borders and chrome only (window/tile borders, separators, hover fills); **`--color-text-muted`** is the secondary/muted text color (meta rows, dates, descriptions, placeholders, dimmed entries) and every theme keeps it at **≥ 4.5:1 WCAG AA contrast against the background** — preserve that baseline when adding or adjusting themes, and never point text at `--color-border`.
- **No native form elements:** text inputs, buttons, checkboxes, number steppers, etc. must be custom-styled to the theme system. Established patterns: the custom checkbox in Tasks (`.task-check`), the ± steppers in Pomodoro (`.pomodoro-step-*`), the custom buttons in Tasks/Weather/Pomodoro.
- **Window aesthetic:** sharp corners (`border-radius: 0` — no exceptions, shell pills included), 2px solid borders, transparent backgrounds. Each module renders its own embedded title bar (icon + name, `.module-title`) — the WM does not draw module titles.
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

- 2026-09-09 — New Dashboard module: a read-only summary grid with one clickable card per module (open counts, next agenda entry, cached weather, highest-priority task, etc.; clicking launches/focuses that module singleton-style). This is an explicit architecture exception: the Dashboard reads other modules' `moduleData` slices (read-only, via persistence) and keeps no `moduleData` of its own — acceptable because a summary view is inherently cross-cutting. Also the first WM-core bootstrap addition: `ensureDashboardOpen()` re-opens the Dashboard into workspace 1 on every page load (closing it only dismisses it for the current session), and the mount `context` gained an `openModule` launch hook.

- 2026-09-09 — Top-pills spacing fix: the top pills were vertically centered in their 36px strip (5px above, but 5px + the 12px tiling outer gap = 17px below to window content). They now sit flush with the strip's bottom edge at 24px tall, giving equal 12px breathing room above (screen edge) and below (window tops) — 12px being the existing `WINDOW_GAP` constant. Reserved height unchanged (36px), so the WM calculation and module layouts are unaffected.

- 2026-09-09 — Removed the rounded corners from the shell pills: the three top pills and the bottom workspace pill are sharp-cornered like everything else (`border-radius: 0` everywhere, no exceptions). Layout, spacing, and space-reservation behavior unchanged.

- 2026-09-09 — Top bar redesigned as three floating shell pills ("pOS" / date / time), each its own rounded pill matching the bottom workspace pill (which is now explicitly rounded too — the shell pills are the one sharp-corner-rule exception). Space reservation mirrors the existing mechanism: `#workspace-root` keeps its `top` offset below the 36px pill strip (unchanged value, so no module/window layout shift), and floating drags already clamp to root-relative coordinates, so windows can never render under the pills. Fullscreen behavior unchanged: fullscreen windows fill the reserved area below the pills and stay beneath them (z-index 500 vs the shell's 900/1000). Time tooltip now targets the time pill only.

- 2026-09-09 — Repositories: removed the tags feature entirely (per-repo tag chips, the floating add-tag input, the tag-filter chip row with clear-filters action, and the AND-combined filtering) — tagging turned out to be unnecessary complexity for a personal repo library. The `tags` field is dropped from stored entries on the next save (no migration); name search remains, unchanged and now the only view filter.

- 2026-09-09 — Repositories refinements: card titles now show the repo name only (owner demoted to a small secondary label under the title; avatar and full-URL link unchanged). Added a filter row below the add input: a live case-insensitive repo-name search and clickable tag-filter chips (aggregated from all tags in use, AND logic, filled-accent active state, clear-filters action, "no repos match" empty state). Search/tag filters and the search query are view state — deliberately not persisted, they reset on reload. Reordering is filter-aware (swaps with the visible neighbour, like Tasks/Goals).
- 2026-09-09 — New Repositories module: a card-grid "library" of GitHub repos persisted under `moduleData.repositories`. Adding a URL parses owner/name and fetches description/stars/language/avatar once from GitHub's public REST API (no auth); failed fetches render a retry state (`fetchFailed`) instead of dropping the entry, and each card has a manual refresh button (no auto-refresh — unauthenticated API is 60 req/hour). Cards show avatar, link, language, Nerd Font star count, clamped description, an always-visible personal note, and free-typed tags with cross-entry suggestions. Added a shipped-modules list to the Architecture section.
- 2026-09-09 — Variable split: `--color-border` was conflating two unrelated roles (window/tile border color AND muted text color), so the previous text-contrast fix had brightened borders as a side effect. Added a 6th core theme variable, `--color-text-muted` (per theme, set to the AA-compliant values from the contrast fix), reverted `--color-border` to its original pre-fix values, and repointed all 38 text/icon usages (Tasks/Agenda/Weather/Bookmarks/Watch Later/Goals meta rows and empty states, placeholders, launcher/empty-workspace hints, Pomodoro phase SVG fill) to `--color-text-muted`. `--color-border` is now border/chrome only; AA baseline moved to `--color-text-muted`.
- 2026-09-09 — Muted-text contrast fix: `--color-border` (secondary/muted text in all modules) failed WCAG AA against the background in all 11 themes (1.14–1.80:1). Raised every theme's `border` value to ≥ 4.71:1, using each scheme's canonical muted/comment shade where one clears AA (Everforest grey2, Gruvbox fg4, Catppuccin overlay2, Solarized base0/base01, Rosé Pine subtle) and a blend of the theme's comment hue toward its foreground otherwise (Nord, Dracula, Tokyo Night, One Dark, Monokai). Baseline documented in the Theming bullet above and in Spec §6.
