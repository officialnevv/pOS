# pOS

I wanted a personal dashboard that behaved like my Linux setup, so I thought of pOS. 

I built it mostly because I wanted to, it's how I like to organize scratch stuff, lists, notes, whatever I end up plugging into it, and I prefer keyboard-driven tiling to clicking floating cards around. If that sounds like you too, read on.

## What it is

Under the hood it's a generic window manager shell: 9 workspaces, dwindle (BSP) tiling, floating windows, fullscreen overlays, a module launcher, theming, and a lock screen. The WM core knows nothing about individual apps, modules register themselves with a central registry, and dropping a new module in is three lines of glue (see AGENT.md). The shipped modules are a Dashboard (auto-opens on workspace 1), Tasks, Notes, Pomodoro, Weather, Bookmarks, Watch Later, Goals, Repositories, and a Shopping Cart.

## Tech

Plain HTML, CSS, and JavaScript. No framework, no build step, no bundler, no dependencies, I didn't want this to rot the way npm projects do when you come back to them two years later. Everything persists to a single `localStorage` blob, and the fonts (Geist Mono, JetBrains Mono, Nerd Font symbols) are self-hosted in `assets/fonts/`, so it works fully offline.

## Running it

It uses ES modules, so you can't just double-click `index.html`, browsers block module loading over `file://`. Serve the folder with anything static:

```
python -m http.server 8080     # then open http://localhost:8080
npx serve .
```

or use the VS Code Live Server extension if that's already in your setup.

The page loads locked. The PIN is 000000, it's hardcoded client-side, so it's a speed bump, not security. It unlocks the moment you finish typing it.

## Keybinds

| Keybind | Action |
|---|---|
| `Alt + H / J / K / L` | Cycle focus between windows |
| `Alt + V` | Toggle the focused window between tiled and floating |
| `Alt + F` | Toggle fullscreen for the focused window |
| `Alt + Q` | Close the focused window |
| `Alt + W` | Open the module launcher |
| `Alt + 1` – `Alt + 9` | Switch to workspace 1–9 |
| `Alt + Shift + 1` – `Alt + Shift + 9` | Move the focused window to workspace 1–9 (the view follows it) |

All of these call `preventDefault()` so the browser doesn't eat them.

## Mouse

Mouse support exists but it's the convenience layer, not the point. Hovering a window focuses it. `Alt + Left-Click` drag moves a floating window, or swaps a tiled window with whatever you drop it on. `Alt + Right-Click` drag resizes a floating window (opposite corner anchored), or resizes a tiled one by following the mouse: horizontal movement drives the vertical split, vertical movement the horizontal split, diagonal movement both at once. Plain left-click on the shared border between two tiles resizes a tiled window the same way. Everything else, launcher, theme picker, checking things off inside modules, works with plain clicks.

## What's in it

- 9 workspaces, each with its own windows and dwindle split state; the pill at the bottom shows what's populated
- Dwindle (Hyprland-style BSP) tiling — each split's orientation is fixed at creation, so resizing one boundary never rearranges other windows
- Floating windows that remember their position through tile/float round-trips, and a fullscreen mode that doesn't disturb anything underneath
- 11 themes (Everforest by default, plus the usual suspects, Gruvbox, Nord, Dracula, Catppuccin, etc.), switchable at runtime from the pill
- Gaps between windows, because borderless tiling looks bad without them
- A lock screen on every page load

## Notes

This is a personal, single-user thing. There's no backend, no accounts, and the localStorage state isn't encrypted, I wouldn't deploy this anywhere or trust it with anything you care about losing. It does what I need on my machine, in my browser.
