# AGENTS.md

Guidance for AI coding agents working on pOS. This is the single living
reference for the project — read it first, and keep it current (see
Documentation maintenance at the bottom).

## Overview

pOS is a browser-based personal dashboard that behaves like a tiling
window manager: 9 workspaces, dwindle (BSP) tiling, floating windows,
fullscreen, a keyboard-driven module launcher (Alt+W), theming, and a
lock screen. "Apps" are modules that render into WM windows.

- Vanilla HTML/CSS/JS. No framework, no build step, no bundler, no
  runtime dependencies. Fonts are self-hosted in `assets/fonts/`, so it
  works fully offline.
- ES modules require HTTP: run `python -m http.server 8080` (or any
  static server / Live Server) and open `http://localhost:8080`.
  `file://` will not work.
- Single-user and client-only. No backend, no auth, no accounts;
  localStorage is not encrypted. The lock screen is a speed bump, not
  security (PIN `000000`, hardcoded client-side).
- Keep those constraints. Don't reach for a framework, a backend, or
  multi-user concerns unless explicitly asked.

## Visual shell

- **Top bar:** three sharp-cornered pills — "pOS" label (left), live
  date (center), live time (right). The time pill reveals seconds on
  hover. The pills occupy a 36px reserved strip at the top edge; the
  strip is real reserved space, not an overlay: `#workspace-root` starts
  below it and floating drags clamp to root-relative coordinates, so
  windows can never render under the pills. Spacing is symmetric at 12px
  (screen edge → pill tops = pill bottoms → window tops); the pill strip
  height and the root's `top` offset must stay in sync.
- **Workspace pill:** fixed, bottom-centered. Slots 1–3 are always
  visible; 4–9 appear only while populated. Click a slot to switch. The
  theme-picker icon sits at its right end.
- **Windows:** 2px solid borders, transparent backgrounds, sharp corners
  (`border-radius: 0`) — everywhere, with no exceptions. Each module
  renders its own embedded title bar; the WM does not draw module
  titles.
- **Fonts:** Geist Mono is the UI font, JetBrains Mono the notes code
  font, Nerd Font Symbols supplies every glyph (launcher, title bars,
  checkboxes, steppers, carets). `favicon.svg` is the pre-runtime icon.

## Theming

- 11 themes, all fully swappable via CSS custom properties applied by
  `applyTheme()` plus a `data-theme` attribute: Everforest, Gruvbox,
  Nord, Dracula, Catppuccin Mocha, Solarized Dark, Solarized Light,
  Tokyo Night, One Dark, Rosé Pine, Monokai.
- Six core colors per theme: `--color-bg`, `--color-fg`,
  `--color-accent`, `--color-border`, `--color-text-muted`,
  `--color-accent-secondary`. **Never hardcode hex colors** in component
  styles.
- `--color-border` is for borders and chrome only (window/tile borders,
  separators, hover fills). `--color-text-muted` is the secondary text
  color (meta rows, dates, descriptions, placeholders, dimmed entries).
  Every theme keeps `--color-text-muted` at **≥ 4.5:1 WCAG AA contrast
  against the background** — preserve that baseline when adding or
  adjusting themes, use a shade from the theme's own hue family (never a
  generic grey), and never point text at `--color-border`.
- `--color-accent-secondary` is the theme's second accent (Pomodoro's
  break ring, high-priority markers).
- Sharp corners apply to themes too: no theme ships rounded elements.

## Window manager

- **Layout:** dwindle BSP only. It is the only layout — do not add a
  layout toggle.
- Each split's **axis is frozen at creation** (`axis` on BSP nodes,
  chosen by `measureSplitAxis()`), persisted in `dwindleTree`, and never
  re-derived from the current aspect ratio. This is deliberate:
  re-deriving caused a bug where resizing one window re-oriented
  unrelated subtrees ("snapping"). `normalizeTreeAxes()` migrates legacy
  axis-less trees on restore — keep that path working. It depends on
  `workspaceRoot` being assigned **before** `restoreState()` in
  `init()`; that ordering was a past bug.
- One gap constant drives spacing: `WINDOW_GAP = 12`. The workspace edge
  inset takes the full gap and internal boundaries take `HALF_GAP` from
  each adjacent window, so inner gaps come out equal to outer ones.
- **Workspaces:** 9, each with its own windows and dwindle tree. Empty
  workspaces show a hint (with a small keybind cheat box); closing the
  last window on a workspace falls back to that hint.
- **Keybinds** (ignored while typing in inputs/textareas):

  | Keybind | Action |
  |---|---|
  | `Alt + H / J / K / L` | Cycle focus between windows |
  | `Alt + V` | Toggle tiled/floating for the focused window |
  | `Alt + F` | Toggle fullscreen for the focused window |
  | `Alt + Q` | Close the focused window |
  | `Alt + W` | Open the module launcher |
  | `Alt + 1` – `Alt + 9` | Switch to workspace 1–9 |
  | `Alt + Shift + 1` – `Alt + Shift + 9` | Move the focused window to workspace 1–9 (view follows) |

  Digit handling prefers the layout-independent `e.code`, because with
  Shift held, `e.key` becomes shifted punctuation on layouts like
  US-ANSI.

- **Mouse:** hover focuses a window. `Alt + Left-Click` drag moves a
  floating window or swaps a tiled window with the drop target.
  `Alt + Right-Click` drag resizes — floating: opposite corner anchored;
  tiled: mouse direction drives the split (horizontal movement moves
  vertical splits, vertical movement horizontal splits, diagonal both).
  Plain left-click on a shared border between tiles resizes.
- **Floating:** minimum size 160×100; drags are clamped to the reserved
  area (see Top bar).
- **Fullscreen:** toggled per window with Alt+F; the window fills the
  reserved workspace area and stays beneath the shell pills (z-index
  ordering).
- **Launcher:** Alt+W opens an input-driven popup listing all registered
  modules (sorted by name, arrow keys + Enter); launching an
  already-open module focuses it instead of duplicating (modules are
  singletons).

## Modules

- **Registry:** every module is a self-contained file under
  `js/modules/` that calls `registerModule()` (in `js/modules.js`) with
  `{ id, name, icon (Nerd Font glyph), mount(container, context),
  unmount(container) }`. Duplicate ids throw (singleton guarantee). The
  WM core knows nothing about individual modules — adding a module is a
  new file plus one side-effect import in `js/wm-core.js`, and it must
  never require further WM-core changes. The mount `context` provides
  `load()` / `persist(slice)` for the module's own data slice; modules
  never touch another module's slice.
- **Self-containment, with one shared-chrome exception:** modules own
  their data, state and list styling. Two pieces of chrome are shared
  instead of copied per module: `createModuleTitle(icon, name)` for the
  embedded title bar and the `.module-add-row` CSS block (input + button
  pattern) for new-entry rows. This was a deliberate reversal — with the
  module count down to seven, duplicating those two patterns in every
  module cost more than sharing them. List styling, state and behavior
  remain per-module.
- **Shipped modules:**
  - **Tasks** — to-do list: due date, priority (none/low/medium/high),
    always-visible description; priority filter and a due-date sort
    toggle (display-time only, undated tasks sort last, manual
    underlying order is preserved and reordering pauses while the sort
    is active); caret reordering; expandable per-task editor; removal
    without confirmation.
  - **Notes** — markdown notes with sidebar list, always-visible
    new-note row, resizable sidebar (width persisted), and an
    edit/preview toggle backed by a hand-built markdown renderer
    (headings, emphasis, lists, quotes, code blocks, tables, rules).
  - **Pomodoro** — live focus timer with an SVG progress ring, automatic
    work/break switching (with a flash cue), and custom +/- steppers
    (1–180 minutes). Nothing is persisted — the timer is session-only.
  - **Watch Later** — saved video links from any site; YouTube links get
    a one-shot oEmbed title fetch (manual title entry as fallback);
    watched entries dim with a strikethrough but stay listed; caret
    reordering.
  - **Goals** — long-term goals with description, category (free text
    with suggestions drawn from previously used categories), optional
    target date, and checkpoints (progress derives from completed
    checkpoints) or a manual progress stepper when checkpoint-less.
    Hitting 100% auto-archives the goal (dimmed, hidden behind a
    show-archived toggle, manually un-archivable).
  - **Repositories** — a personal library of GitHub repos. Adding a URL
    parses owner/name and fetches description/stars/language/avatar once
    from GitHub's public API (no auth, one call per explicit action —
    the unauthenticated API is 60 req/hour). Failed fetches set
    `fetchFailed` and render a retry state; each card has a manual
    refresh. Cards show avatar, repo-name link, language, star count,
    clamped description and an inline personal note; a live name search
    (view state, resets on reload) filters the grid.
  - **Shopping Cart** — a manual shopping/tracking list. Name and
    numeric price are required (inline validation); optional link
    (name becomes the link) and site label; quantity stepper; purchased
    toggle (dimmed + strikethrough, stays in the list); a totals footer
    showing "remaining" (unpurchased) always and a smaller "purchased"
    total while purchased items exist.
- Shared conventions across modules: always-visible add-entry rows,
  no confirmation dialogs on remove, caret-based manual reordering
  (array order IS the display order; when a display filter/sort is
  active, moves swap with the visible neighbour), view state (filters,
  search, sort direction) is deliberately not persisted, and custom
  checkboxes/steppers/inputs instead of native form elements.

## Persistence

- Everything lives in one `localStorage` key, `personal-os-state`, as a
  single JSON blob: `{ activeWorkspace, activeTheme, workspaces,
  moduleData }`. Modules persist their own data under
  `moduleData.<moduleId>`; slices whose module is no longer registered
  are pruned on load.
- Current shapes:
  - `tasks`: array of `{ text, done, dueDate, priority, description }`
  - `notes`: `{ notes: [{ title, body }], sidebarWidth }`
  - `pomodoro`: none (live timer, deliberately never saved)
  - `watchLater`: array of `{ url, title, watched }`
  - `goals`: array of `{ id, title, description, category, targetDate,
    checkpoints: [{ id, label, done }], manualProgress, createdAt,
    archived }`
  - `repositories`: array of `{ id, url, owner, name, description,
    stars, language, avatarUrl, note, addedAt, fetchFailed }`
  - `shoppingCart`: array of `{ id, name, price, link, site, quantity,
    purchased, addedAt }`
- Saved entries are normalized on load (missing/legacy fields get safe
  defaults) — that tolerance is for persisted data, which by construction
  can be anything.
- **Lock screen:** the overlay covers the page on every load. The PIN is
  `000000`; it unlocks the moment the full PIN is typed, wrong input
  shakes and clears.

## Code conventions

- Descriptive names; no dead code, no commented-out blocks, no
  speculative abstraction.
- Comments explain **why**, not what. Good comments record non-obvious
  intent (why an axis is frozen, why something is deliberately not
  persisted, why a listener dies with its element). Skip boilerplate
  restatements of the code, ALL-CAPS flag sections, and
  compliance-documentation tone.
- No defensive checks for impossible states. The one legitimate place
  for `typeof` tolerance is `normalize()`-style load-time coercion of
  persisted JSON, which by construction can be anything.
- Interactive elements follow the established patterns: custom-styled
  inputs/buttons/checkboxes/steppers (no native form elements), CSS
  variables for all color, sharp corners, muted text via
  `--color-text-muted`.
- Verify changes with `node --check <file>` plus a throwaway DOM-stub
  smoke test (`smoke-test.mjs`, run with `node`), then delete the test
  artifacts.

## Documentation maintenance

AGENTS.md is the single living document for this project. When a change
adds, removes, or alters a feature, keybind, module, data shape, or
convention, update AGENTS.md in the same commit as the code change —
describing the current state only, with no stale references to removed
things, and a one-line changelog entry (newest on top) for shifts that
explain why current conventions look the way they do. Before marking a
task complete, check: does this change make any part of AGENTS.md
untrue? If yes, fix the doc before finishing.

## Changelog

- 2026-09-10 — Documentation consolidated: this file (renamed from
  AGENT.md) is now the sole reference, and personal-os-spec.md was
  deleted. Every "Spec §N" pointer in code comments was removed with it.
- 2026-09-10 — Removed the Bookmarks, Dashboard and Weather modules.
  Dashboard's exit also reverted its WM-core additions (auto-open
  bootstrap, `openWindow` workspace parameter, `openModule` mount hook),
  restoring zero cross-module coupling, and dropped the Tasks
  `completedAt` and Pomodoro `sessionLog` fields it alone consumed.
- 2026-09-10 — Self-containment partially reversed: shared
  `createModuleTitle()` helper and shared `.module-add-row` CSS replace
  per-module copies. The trade-off flipped because the module count
  dropped — fewer modules to maintain independently means less cost to
  sharing chrome, and more value in the line savings.
- 2026-09-10 — Theme structure settled at six core colors per theme:
  `--color-border` (borders/chrome only) was split from
  `--color-text-muted` (secondary text) after a WCAG AA contrast fix
  brightened borders as a side effect of fixing text. All 11 themes now
  carry AA-compliant muted text in their own hue family.
- 2026-09-09 — Top bar redesigned as three shell pills with real
  reserved space (mirroring the bottom pill's mechanism), then made
  sharp-cornered like everything else; spacing equalized at 12px on both
  sides.
- 2026-09-09 — Module churn: Shopping Cart added; Agenda, Dashboard,
  Weather and Bookmarks removed. Repositories dropped its tags feature;
  Tasks gained a due-date sort toggle. Dashboard had introduced the
  project's only WM-core bootstrap behavior and cross-module reads —
  both reverted with the module.
- Early 2026-09 — Initial architecture: dwindle-only tiling WM, module
  registry with side-effect imports, single-blob localStorage
  persistence, theme registry, lock screen.
