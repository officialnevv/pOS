# pOS

I wanted a personal dashboard that behaved like my Linux setup, so I built one: a tiling window manager that runs in a browser tab. There's no desktop environment underneath, pOS itself draws the windows, the workspaces, and the bar. "Apps" are just modules that render into those windows, and the whole thing lives in one browser tab with no server behind it.

I built it mostly because I wanted to. It's how I like to organize scratch stuff, lists, notes, whatever I end up plugging into it, and I prefer keyboard-driven tiling to clicking floating cards around. If that sounds like you too, read on.

## What it is

Under the hood it's a generic window manager shell: 9 workspaces, dwindle (BSP) or master-stack tiling, floating windows, fullscreen overlays, a module launcher, theming, and a lock screen. The WM core knows nothing about individual apps, modules register themselves with a central registry, and the registry is intentionally empty right now. When I want a new "app," I drop a file in `js/modules/`, call `registerModule()`, add one import, and it shows up in the launcher.

## Tech

Plain HTML, CSS, and JavaScript. No framework, no build step, no bundler, no dependencies, I didn't want this to rot the way npm projects do when you come back to them two years later. Everything persists to a single `localStorage` blob, and the fonts (Geist Mono, JetBrains Mono, Nerd Font symbols) are self-hosted in `assets/fonts/`, so it works fully offline.

## Running it

It uses ES modules, so you can't just double-click `index.html`, browsers block module loading over `file://`. Serve the folder with anything static:

```
python -m http.server 8080     # then open http://localhost:8080
npx serve .
```

or use the VS Code Live Server extension if that's already in your setup.

The page loads locked. The PIN is <000000>, it's hardcoded client-side, so it's a speed bump, not security. It unlocks the moment you finish typing it.

## Keybinds

| Keybind | Action |
|---|---|
| `Alt + H / J / K / L` | Cycle focus between windows |
| `Alt + Shift + H / J / K / L` | Resize the master/stack ratio (or the focused dwindle split) |
| `Alt + W` | Promote the focused window to master |
| `Alt + V` | Toggle the focused window between tiled and floating |
| `Alt + F` | Toggle fullscreen for the focused window |
| `Alt + Q` | Close the focused window |
| `Alt + Enter` | Open the module launcher |
| `Alt + 1` – `Alt + 9` | Switch to workspace 1–9 |
| `Alt + Shift + 1` – `Alt + Shift + 9` | Move the focused window to workspace 1–9 (the view follows it) |

All of these call `preventDefault()` so the browser doesn't eat them.

## Mouse

Mouse support exists but it's the convenience layer, not the point. Hovering a window focuses it. `Alt + Left-Click` drag moves a floating window, or swaps a tiled window with whatever you drop it on. `Alt + Right-Click` drag resizes a floating window, or adjusts the split ratio on a tiled one. Everything else, launcher, theme picker, checking things off inside modules, works with plain clicks.

## What's in it

- 9 workspaces, each with its own windows and layout; the pill at the bottom shows what's populated
- Dwindle (Hyprland-style BSP) as the default layout, master-stack as the alternative, toggleable per workspace from the pill
- Floating windows that remember their position through tile/float round-trips, and a fullscreen mode that doesn't disturb anything underneath
- 11 themes (Everforest by default, plus the usual suspects, Gruvbox, Nord, Dracula, Catppuccin, etc.), switchable at runtime from the pill
- Gaps between windows, because borderless tiling looks bad without them
- A lock screen on every page load

## Notes

This is a personal, single-user thing. There's no backend, no accounts, and the localStorage state isn't encrypted, I wouldn't deploy this anywhere or trust it with anything you care about losing. It does what I need on my machine, in my browser.
