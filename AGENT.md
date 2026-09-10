# AGENT.md

Guidance for AI coding agents working on pOS. Read this first; `personal-os-spec.md` is the authoritative behavioral spec.

## What this is

pOS is a browser-based personal dashboard that behaves like a tiling window manager: 9 workspaces, dwindle (BSP) tiling, floating windows, fullscreen, a module launcher (Alt+W), theming, and a lock screen (PIN `000000`, hardcoded client-side). "Apps" are modules that render into WM windows.

- **Stack:** vanilla HTML/CSS/JS. No framework, no build step, no bundler, no dependencies. Fonts are self-hosted (`assets/fonts/`), so it works fully offline.
- **Run it:** ES modules require HTTP — `python -m http.server 8080` (or any static server / Live Server), then open `http://localhost:8080`. `file://` will not work.
- **Layout:** dwindle-only. There is no master-stack layout and no layout toggle — do not reintroduce one.

## Architecture

- **Modules** (`js/modules/*.js`) are self-contained units registered via `registerModule()` in `js/modules.js` with `{ id, name, icon (Nerd Font glyph), mount(container, context), unmount(container) }`. The WM core never imports module internals; **a new module must never require changes to `js/wm-core.js`**. Module data flows through the mount `context` (`context.load()` / `context.persist(slice)`).
- **Shared module scaffolding (deliberate):** modules share two pieces of chrome instead of each owning a copy — `createModuleTitle(icon, name)` in `js/modules.js` for the embedded title bar, and the `.module-add-row` CSS block (input + button pattern) in `style.css`. This reverses an earlier "self-containment > DRY" judgement call: with the module count down to seven, the per-module duplication cost more than the coupling. Modules remain logically self-contained (own data, own state, own list styling) — only these two boilerplate patterns are shared.
- **Shipped modules:** Tasks (to-do list), Notes (markdown notes with preview), Pomodoro (focus timer), Watch Later (video links with YouTube title fetch), Goals (checkpoints + derived/manual progress), Repositories (GitHub repo library — one-shot metadata fetch from the public API, manual refresh/retry, live name search as view state), Shopping Cart (manual shopping/tracking list with quantity steppers and remaining/purchased totals).
- **Theming:** colors only via CSS custom properties (`var(--color-accent)`, `var(--color-border)`, `var(--color-text-muted)`, etc.) defined per-theme in `style.css` / `js/themes.js`. **Never hardcode hex colors** in component styles — 11 themes must stay swappable. `--color-border` is for borders and chrome only (window/tile borders, separators, hover fills); **`--color-text-muted`** is the secondary/muted text color (meta rows, dates, descriptions, placeholders, dimmed entries) and every theme keeps it at **≥ 4.5:1 WCAG AA contrast against the background** — preserve that baseline when adding or adjusting themes, and never point text at `--color-border`.
- **No native form elements:** text inputs, buttons, checkboxes, number steppers, etc. must be custom-styled to the theme system. Established patterns: the custom checkbox in Tasks (`.task-check`), the ± steppers in Pomodoro (`.pomodoro-step-*`), the shared add-row input/button (`.module-add-row`).
- **Window aesthetic:** sharp corners (`border-radius: 0` — no exceptions, shell pills included), 2px solid borders, transparent backgrounds. Each module renders its own embedded title bar (icon + name, `.module-title`) — the WM does not draw module titles.
- **Persistence:** everything lives in a single `localStorage` key (`personal-os-state`) as one JSON blob (Spec §9). Module data goes under `moduleData.<moduleId>`. The Pomodoro's timer state is deliberately **not** persisted (live session timer) — `moduleData.pomodoro` doesn't exist unless a future feature writes it.

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

- 2026-09-10 — Removed the Bookmarks, Dashboard and Weather modules (files, registry entries, CSS sections, data slices — stale `moduleData` keys are pruned by the existing cleanup on next load). Dashboard's removal also reverted its WM-core additions: the `ensureDashboardOpen()` auto-open bootstrap, the `openWindow` workspace parameter, and the `openModule` mount-context hook are gone, restoring zero cross-module coupling — and its private data-model additions (Tasks `completedAt`, Pomodoro `sessionLog`) were removed with it since it was their only consumer. The same commit consolidated the previously-deferred duplication: a shared `createModuleTitle(icon, name)` helper in modules.js and a shared `.module-add-row` CSS block replace the per-module copies in all seven remaining modules. That reverses the earlier "self-containment > DRY" call on purpose — with the module count down to seven, sharing two boilerplate patterns costs less than maintaining seven copies.
- 2026-09-09 — New Shopping Cart module: a manual shopping/tracking list under `moduleData.shoppingCart`. Adding requires a name and a numeric price (validated inline); optional stored link (name becomes a clickable link) and free-text site label. Each item has a custom quantity stepper (clamped at 1, line total shown when quantity > 1), a purchased toggle (dimmed/strikethrough, Watch Later convention) and caret reordering; a totals footer shows "remaining" (unpurchased) always and a smaller "purchased" total while purchased items exist. No checkout integration, no URL auto-fetch, no currency handling.

- 2026-09-09 — Removed the Agenda module entirely (file, registry entry, CSS, and its card in the Dashboard's summary grid) — it will be rebuilt from scratch later, not abandoned. Stored `moduleData.agenda` data is pruned automatically on the next load by the existing stale-slice cleanup in persistence.js. Dashboard's bento tiers were rebalanced (Weather and Notes moved from 1×1 to 2×1) so the grid still tiles without holes after losing Agenda's cells.

- 2026-09-09 — Two small module additions: Tasks gained a due-date sort toggle (soonest ↔ latest first, click to flip, undated tasks always last) — a display-time sort that never rewrites the manual order, with manual reordering paused while the sort is active; direction is view state, not persisted. Weather's current conditions now show relative humidity (Nerd Font drop glyph + percentage) from the existing Open-Meteo `current_weather` response, riding the normal cache.

- 2026-09-09 — Dashboard grid redesigned from uniform cards into a bento-style layout: a 4-column CSS grid with per-card spans driven by content richness (chart-bearing modules — Tasks, Pomodoro, Goals, Repositories — get 2×2 blocks; Agenda/Bookmarks/Watch Later get 2×1; Weather/Notes stay 1×1; the cell counts tile the grid exactly with dense auto-flow, so no holes). Responsiveness moved to container queries on the grid — spans react to the module window's width (4 cols → 2 cols → 1 column), and spanning cards degrade to full-width instead of overflowing on narrow windows. Card content, charts, click-to-launch, and empty states unchanged.

- 2026-09-09 — Dashboard charts: four hand-built inline-SVG visuals (no libraries/canvas) added to the Dashboard's cards — a 7-day Tasks completion-trend bar chart, a 7-day Pomodoro work-session bar chart, a Goals progress-per-goal horizontal bar chart (top 5 + "+N more"), and a Repositories per-language breakdown (unidentified languages bucketed as "Unknown"). Source-module data-model additions: Tasks entries now record `completedAt` on completion (cleared on un-complete), and Pomodoro logs completed work sessions to `moduleData.pomodoro = { sessionLog: [{ completedAt, durationMinutes }] }` (its live countdown state remains session-only). Dashboard charts render at mount from the latest slices; zero-data charts show text empty states.

- 2026-09-09 — New Dashboard module: a read-only summary grid with one clickable card per module (open counts, next agenda entry, cached weather, highest-priority task, etc.; clicking launches/focuses that module singleton-style). This is an explicit architecture exception: the Dashboard reads other modules' `moduleData` slices (read-only, via persistence) and keeps no `moduleData` of its own — acceptable because a summary view is inherently cross-cutting. Also the first WM-core bootstrap addition: `ensureDashboardOpen()` re-opens the Dashboard into workspace 1 on every page load (closing it only dismisses it for the current session), and the mount `context` gained an `openModule` launch hook.

- 2026-09-09 — Top-pills spacing fix: the top pills were vertically centered in their 36px strip (5px above, but 5px + the 12px tiling outer gap = 17px below to window content). They now sit flush with the strip's bottom edge at 24px tall, giving equal 12px breathing room above (screen edge) and below (window tops) — 12px being the existing `WINDOW_GAP` constant. Reserved height unchanged (36px), so the WM calculation and module layouts are unaffected.

- 2026-09-09 — Removed the rounded corners from the shell pills: the three top pills and the bottom workspace pill are sharp-cornered like everything else (`border-radius: 0` everywhere, no exceptions). Layout, spacing, and space-reservation behavior unchanged.

- 2026-09-09 — Top bar redesigned as three floating shell pills ("pOS" / date / time), each its own rounded pill matching the bottom workspace pill (which is now explicitly rounded too — the shell pills are the one sharp-corner-rule exception). Space reservation mirrors the existing mechanism: `#workspace-root` keeps its `top` offset below the 36px pill strip (unchanged value, so no module/window layout shift), and floating drags already clamp to root-relative coordinates, so windows can never render under the pills. Fullscreen behavior unchanged: fullscreen windows fill the reserved area below the pills and stay beneath them (z-index 500 vs the shell's 900/1000). Time tooltip now targets the time pill only.

- 2026-09-09 — Repositories: removed the tags feature entirely (per-repo tag chips, the floating add-tag input, the tag-filter chip row with clear-filters action, and the AND-combined filtering) — tagging turned out to be unnecessary complexity for a personal repo library. The `tags` field is dropped from stored entries on the next save (no migration); name search remains, unchanged and now the only view filter.

- 2026-09-09 — Repositories refinements: card titles now show the repo name only (owner demoted to a small secondary label under the title; avatar and full-URL link unchanged). Added a filter row below the add input: a live case-insensitive repo-name search and clickable tag-filter chips (aggregated from all tags in use, AND logic, filled-accent active state, clear-filters action, "no repos match" empty state). Search/tag filters and the search query are view state — deliberately not persisted, they reset on reload. Reordering is filter-aware (swaps with the visible neighbour, like Tasks/Goals).
- 2026-09-09 — New Repositories module: a card-grid "library" of GitHub repos persisted under `moduleData.repositories`. Adding a URL parses owner/name and fetches description/stars/language/avatar once from GitHub's public REST API (no auth); failed fetches render a retry state (`fetchFailed`) instead of dropping the entry, and each card has a manual refresh button (no auto-refresh — unauthenticated API is 60 req/hour). Cards show avatar, link, language, Nerd Font star count, clamped description, an always-visible personal note, and free-typed tags with cross-entry suggestions. Added a shipped-modules list to the Architecture section.
- 2026-09-09 — Variable split: `--color-border` was conflating two unrelated roles (window/tile border color AND muted text color), so the previous text-contrast fix had brightened borders as a side effect. Added a 6th core theme variable, `--color-text-muted` (per theme, set to the AA-compliant values from the contrast fix), reverted `--color-border` to its original pre-fix values, and repointed all 38 text/icon usages (Tasks/Agenda/Weather/Bookmarks/Watch Later/Goals meta rows and empty states, placeholders, launcher/empty-workspace hints, Pomodoro phase SVG fill) to `--color-text-muted`. `--color-border` is now border/chrome only; AA baseline moved to `--color-text-muted`.
- 2026-09-09 — Muted-text contrast fix: `--color-border` (secondary/muted text in all modules) failed WCAG AA against the background in all 11 themes (1.14–1.80:1). Raised every theme's `border` value to ≥ 4.71:1, using each scheme's canonical muted/comment shade where one clears AA (Everforest grey2, Gruvbox fg4, Catppuccin overlay2, Solarized base0/base01, Rosé Pine subtle) and a blend of the theme's comment hue toward its foreground otherwise (Nord, Dracula, Tokyo Night, One Dark, Monokai). Baseline documented in the Theming bullet above and in Spec §6.
