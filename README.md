# pOS

A personal dashboard that behaves exactly like your tiling window manager.

I built it mostly because I wanted to, it's how I like to organize scratch stuff, lists, notes, whatever I end up plugging into it, and I prefer keyboard-driven tiling to clicking floating cards around. If that sounds like you too, read on.

## Features

- Multiple workspaces support, each with its own windows and dwindle layout state, the pill at the bottom is the workspace indicator.
- 11 colorschemes (Nord (Default), Gruvbox, Everforest, Dracula, Catppuccin, etc.), switchable from the color icon.

## Modules

- Goals, similar to tasks, where you can track long-term goals with progress and checkpoints.
- Notes, a simple notes app, with markdown support.
- Pomodoro, just your average pomodoro timer, with controlable work and break times.
- Repositories, save your favorite repos from GitHub, but you can already do that on GitHub so...
- Shopping Cart, added this later on, one place to save all your upcoming purchases.
- Tasks, most beneficial so far, create tasks, add a description, and a date.
- Watch Later, keeping all my watch laters in one place (videos, playlists), with YouTube title support.  

## Running it

```
python -m http.server 8080     # then open http://localhost:8080
```

or use the VS Code Live Server extension if that's already in your setup.

The page loads locked. The PIN is 000000, it's hardcoded client-side, so it's a speed bump, not security.

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
| `Alt + Shift + 1` – `Alt + Shift + 9` | Move the focused window to workspace 1–9 (the view follows it) |
| `Alt + Shift + 1` – `Alt + Shift + 9` | Move the focused window to workspace 1–9 (the view follows it) |
| `Alt + Left-Click` | Drag windows around, tiled and floating |
| `Alt + Right-Click` | Resizes windows, tiled and floating |

## Disclaimer

This is a personal, single-user thing. There's no backend, no accounts, and the localStorage state isn't encrypted, I wouldn't deploy this anywhere or trust it with anything you care about losing. It does what I need on my machine, in my browser.