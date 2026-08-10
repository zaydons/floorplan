# Floorplan Editor

A browser-based floorplan drawing tool — draw walls, rooms, and stairs to scale, drop in electrical/plumbing/HVAC/furniture symbols, organize everything into layers, and export the result. No install, no build step, no backend: it's plain HTML/CSS/JS that runs entirely in the browser.

**Live app:** https://zaydons.github.io/floorplan/

## Features

- **Drawing tools** — line, rectangle, polygon, circle, text, and a dedicated wall tool (click to place points, double-click or right-click to finish) with a configurable real-world thickness and alignment (Center/Left/Right — Left/Right build all of the thickness to one side of the line you draw, so tracing a room's interior boundary gives you that exact clear interior size instead of losing half of every wall's thickness into the room)
- **Stairs tool** with a toggleable up/down direction indicator
- **44 symbols across 9 categories** — outlets, switches, lighting, panels, HVAC, plumbing, furniture, openings, and detectors/misc. — placed at true real-world size and independently resizable/rotatable per placement (e.g. a couch isn't a square)
- **Layers** with nested sub-layers, per-layer visibility and lock, and color coding. Only the active layer is editable at a time — click a layer in the sidebar to switch to it; every other layer is dimmed on canvas and implicitly locked until you switch back
- **Scale & measurements** — set real-world units (ft/in/m/cm/mm) per grid cell, with live dimension labels on shapes that are click-to-edit (accepts entries like `2ft 8in`)
- **Snapping** — to the grid (whole cell down to 1/16th) and to existing shapes, both toggleable
- **Undo/redo** and **autosave** to the browser's local storage, with a restore prompt on reload
- **Save / Load** a floorplan as JSON, **Export** the canvas as a PNG
- **Collapsible sidebar panels**, with the collapsed state remembered between sessions
- Touch support for drawing and resizing on mobile/tablet

## Getting started

There's nothing to install or build. Either:

- Open `index.html` directly in a browser, or
- Serve the folder with any static file server, e.g.:
  ```sh
  npx serve .
  # or
  python3 -m http.server 8000
  ```

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `V` | Select |
| `H` | Pan |
| `L` | Line |
| `R` | Rectangle — or rotate the selected symbol 90° / the symbol about to be placed, when the Select or Symbol tool is active |
| `P` | Polygon |
| `W` | Wall |
| `C` | Circle |
| `T` | Text |
| `M` | Place symbol |
| `S` | Stairs |
| `E` | Eraser |
| `Delete` / `Backspace` | Delete selection |
| `Escape` | Cancel current draw / clear selection |
| `Ctrl/Cmd+Z` | Undo |
| `Ctrl/Cmd+Y` or `Ctrl/Cmd+Shift+Z` | Redo |
| `Ctrl/Cmd+S` | Save as JSON |

## Project structure

```
index.html    Markup, toolbar, and sidebar panels
style.css     All styling (single dark theme)
symbols.js    The symbol library (electrical/plumbing/HVAC/furniture/openings)
app.js        Everything else — canvas rendering, tools, layers, state, undo/redo
```

No package.json, no dependencies, no bundler — `app.js` and `symbols.js` are loaded directly as plain `<script>` tags.

## Browser support

Built on the 2D Canvas API; any current version of Chrome, Firefox, Safari, or Edge works. No IE support.

## Icons

Toolbar icons are from Google's [Material Symbols](https://fonts.google.com/icons), licensed under [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).

## License

[MIT](LICENSE)
