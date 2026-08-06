'use strict';

// ── Constants ────────────────────────────────────────────────────────────────
const GRID_SIZE = 20;
const MIN_ZOOM  = 0.1;
const MAX_ZOOM  = 10;
const HANDLE_R  = 5;
const SNAP_SHAPE_PX = 10; // screen-pixel radius for snapping to shape points

const UNIT_TO_METERS = { ft: 0.3048, in: 0.0254, m: 1, cm: 0.01, mm: 0.001 };
const INCH_TO_METERS = 0.0254;

// How many world (canvas) units correspond to one real-world inch,
// given the current "1 grid = X unit" scale setting.
function worldUnitsPerInch() {
  const metersPerGridCell = state.scale.gridValue * (UNIT_TO_METERS[state.scale.unit] || 1);
  if (!(metersPerGridCell > 0)) return GRID_SIZE / 12; // fallback: ~1ft/cell
  const worldUnitsPerMeter = GRID_SIZE / metersPerGridCell;
  return worldUnitsPerMeter * INCH_TO_METERS;
}

// A symbol's real-world default size (sizeIn, in inches) converted to
// world units at the current scale, so a duplex outlet and a bed don't
// render the same size just because they share a default.
function defaultSymbolWorldSize(sym) {
  return Math.max(2, sym.sizeIn * worldUnitsPerInch());
}

// Feet-and-inches display, e.g. 2.667 -> "2ft 8in" — the standard
// construction convention, instead of an awkward decimal like "2.67 ft".
// Inches round to the nearest whole inch; a whole-foot or under-a-foot
// value drops the redundant half ("2ft" / "8in" rather than "2ft 0in").
function formatFeetInches(totalFeet) {
  const totalInches = Math.round(totalFeet * 12);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  if (feet === 0 && inches === 0) return '0ft';
  if (feet === 0) return `${inches}in`;
  if (inches === 0) return `${feet}ft`;
  return `${feet}ft ${inches}in`;
}

// Convert a placed/preview symbol's world-unit size back to a friendly
// real-world label (in/ft) for the size hint next to the Size field.
function formatSizeHint(worldSize) {
  const inches = worldSize / worldUnitsPerInch();
  if (!isFinite(inches) || inches <= 0) return '';
  if (inches >= 12) return `≈ ${formatFeetInches(inches / 12)}`;
  return `≈ ${parseFloat(inches.toFixed(1))} in`;
}

// Default wall thickness: a 2x4 stud wall plus drywall on both faces (~6in)
function defaultWallThickness() {
  return Math.max(2, 6 * worldUnitsPerInch());
}

// Symbols default to uniform sizing (shape.size), but sizeX/sizeY can be set
// independently — a couch's width isn't its depth. These read the effective
// value either way, so most code never has to care which mode a shape is in.
function symEffSizeX(shape) { return shape.sizeX ?? shape.size ?? 40; }
function symEffSizeY(shape) { return shape.sizeY ?? shape.size ?? 40; }
function symIsUniform(shape) { return Math.abs(symEffSizeX(shape) - symEffSizeY(shape)) < 1; }

// ── Symbol bounding boxes ────────────────────────────────────────────────────
// Symbol draw() functions aren't confined to a neat [-r,r] square — several
// (doors, sconces, ceiling fans, anything with an arc/arrow/label) draw well
// outside it. Rather than trust a hand-guessed box per symbol, render each
// symbol once to an offscreen canvas at a known radius and scan for the
// actual bounding box of what got drawn, normalized to r=1 units. Cheap
// (runs once per symbol key, cached) and correct for every symbol
// automatically, including future ones.
const symbolBBoxCache = {};

function computeSymbolNormalizedBBox(sym) {
  const R = 100;
  let pad = 60;

  for (let attempt = 0; attempt < 6; attempt++) {
    const size = R * 2 + pad * 2;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.translate(size / 2, size / 2);
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 1; // thin: capture path geometry, not stroke-width inflation
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    try { sym.draw(ctx, R); } catch { /* ignore malformed draw */ }

    const data = ctx.getImageData(0, 0, size, size).data;
    let minX = size, minY = size, maxX = 0, maxY = 0, found = false;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (data[(y * size + x) * 4 + 3] > 10) {
          found = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (!found) return { x0: -1, y0: -1, x1: 1, y1: 1 };

    // If drawn content touches the buffer edge, it may have been clipped —
    // some symbols (e.g. a door's swing arc) draw well past r. Retry bigger
    // rather than silently under-reporting the extent.
    if ((minX <= 1 || minY <= 1 || maxX >= size - 2 || maxY >= size - 2) && attempt < 5) {
      pad *= 2;
      continue;
    }

    return {
      x0: (minX - size / 2) / R, y0: (minY - size / 2) / R,
      x1: (maxX - size / 2) / R, y1: (maxY - size / 2) / R,
    };
  }
}

function getSymbolNormalizedBBox(sym) {
  if (!symbolBBoxCache[sym.key]) symbolBBoxCache[sym.key] = computeSymbolNormalizedBBox(sym);
  return symbolBBoxCache[sym.key];
}

// World-space bounding box for a placed symbol shape, accounting for its
// size and rotation (rotation is always a multiple of 90deg here, so the
// bbox stays axis-aligned — just corner-swapped).
function getSymbolWorldBounds(shape) {
  const sym = SYMBOLS.find(s => s.key === shape.symbolKey);
  if (!sym) return null;
  const norm = getSymbolNormalizedBBox(sym);
  const hrx = symEffSizeX(shape) / 2, hry = symEffSizeY(shape) / 2;
  const corners = [
    { x: norm.x0 * hrx, y: norm.y0 * hry }, { x: norm.x1 * hrx, y: norm.y0 * hry },
    { x: norm.x1 * hrx, y: norm.y1 * hry }, { x: norm.x0 * hrx, y: norm.y1 * hry },
  ];
  const rad = (shape.rotation || 0) * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of corners) {
    const rx = c.x * cos - c.y * sin, ry = c.x * sin + c.y * cos;
    if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
    if (ry < minY) minY = ry; if (ry > maxY) maxY = ry;
  }
  return { x: shape.x + minX, y: shape.y + minY, w: maxX - minX, h: maxY - minY };
}

const LAYER_COLORS = [
  '#7c6aff','#ff6a6a','#6affb0','#ffca6a','#6ab8ff','#ff6adb','#a8ff6a','#ff976a'
];

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  tool: 'select',
  layers: [],          // { id, name, visible, color, shapes: [] }
  activeLayerId: null,
  zoom: 1,
  pan: { x: 0, y: 0 },
  showGrid: true,
  snapToGrid: true,
  snapDivisions: 1,    // grid snap resolution: 1 = whole cell, 2 = half, 4 = quarter, 8 = eighth
  snapToShapes: true,
  snapIndicator: null, // { x, y } world point currently snapped-to, for overlay feedback
  measurementLabels: [], // clickable regions for the last redrawMain pass, see hitTestMeasurementLabel
  history: [],         // snapshots for undo
  future: [],          // snapshots for redo
  selection: [],       // selected shape ids
  currentSymbol: 'outlet',
  symbolRotation: 0,   // degrees: 0 / 90 / 180 / 270
  mouseWorld: null,    // { x, y } for symbol placement preview
  scale: {
    gridValue: 1,        // real-world units per grid cell
    unit: 'ft',          // 'ft' | 'in' | 'm' | 'cm' | 'mm'
    showMeasurements: true,
  },
  props: {
    stroke: '#e8eaf2',
    strokeWidth: 2,
    fill: '#ffffff',
    fillEnabled: false,
    dash: 'solid',
    fontSize: 14,
    symbolSize: 40,
    stairsDirection: 'up',
    wallThickness: 12,
  },
};

// Drawing interaction state
const drag = {
  active: false,
  startX: 0, startY: 0,
  lastX: 0,  lastY: 0,
  polyPoints: [],      // for polygon/wall tools
  shape: null,         // shape being drawn (preview)
  resizeApply: null,   // (wx, wy) => void, mutates the shape being resized
  rubberStart: null, rubberEnd: null, rubberAdditive: false, // rubber-band select
};

let textPending = null; // { x, y } while text input is open

// ── DOM refs ─────────────────────────────────────────────────────────────────
const gridCanvas    = document.getElementById('gridCanvas');
const mainCanvas    = document.getElementById('mainCanvas');
const overlayCanvas = document.getElementById('overlayCanvas');
const gCtx  = gridCanvas.getContext('2d');
const mCtx  = mainCanvas.getContext('2d');
const oCtx  = overlayCanvas.getContext('2d');
const layersList      = document.getElementById('layers-list');
const zoomIndicator   = document.getElementById('zoom-indicator');
const coordsIndicator = document.getElementById('coords-indicator');
const selectionProps  = document.getElementById('selectionProps');
const moveToLayerSel  = document.getElementById('moveToLayer');
const textInput       = document.getElementById('textInput');
const measureEditWrap  = document.getElementById('measureEditWrap');
const measureEditInput = document.getElementById('measureEditInput');
const measureEditUnit  = document.getElementById('measureEditUnit');
const modalOverlay    = document.getElementById('modal-overlay');
const modalInput      = document.getElementById('modal-input');
const exportModalOverlay  = document.getElementById('export-modal-overlay');
const exportModalTitle    = document.getElementById('export-modal-title');
const exportModalHint     = document.getElementById('export-modal-hint');
const exportModalBody     = document.getElementById('export-modal-body');
const exportModalCopyBtn  = document.getElementById('export-modal-copy');
const exportModalDownload = document.getElementById('export-modal-download');
const exportModalCloseBtn = document.getElementById('export-modal-close');
const textPropRow     = document.getElementById('textPropRow');
const stairsPropRow   = document.getElementById('stairsPropRow');
const wallPropRow     = document.getElementById('wallPropRow');

// ── Helpers ──────────────────────────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function snap(v) {
  if (!state.snapToGrid) return v;
  const step = GRID_SIZE / state.snapDivisions;
  return Math.round(v / step) * step;
}

function screenToWorld(sx, sy) {
  return {
    x: (sx - state.pan.x) / state.zoom,
    y: (sy - state.pan.y) / state.zoom,
  };
}

function worldToScreen(wx, wy) {
  return {
    x: wx * state.zoom + state.pan.x,
    y: wy * state.zoom + state.pan.y,
  };
}

// ── Snap-to-shape ────────────────────────────────────────────────────────────
function addShapeCandidates(pts, s) {
  switch (s.type) {
    case 'line':
      pts.push({ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 },
                { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 });
      break;
    case 'rect':
    case 'stairs': {
      const x1 = Math.min(s.x1, s.x2), x2 = Math.max(s.x1, s.x2);
      const y1 = Math.min(s.y1, s.y2), y2 = Math.max(s.y1, s.y2);
      pts.push(
        { x: x1, y: y1 }, { x: x2, y: y1 }, { x: x1, y: y2 }, { x: x2, y: y2 },
        { x: (x1 + x2) / 2, y: y1 }, { x: (x1 + x2) / 2, y: y2 },
        { x: x1, y: (y1 + y2) / 2 }, { x: x2, y: (y1 + y2) / 2 },
        { x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
      );
      break;
    }
    case 'circle': {
      const cx = (s.x1 + s.x2) / 2, cy = (s.y1 + s.y2) / 2;
      const rx = Math.abs(s.x2 - s.x1) / 2, ry = Math.abs(s.y2 - s.y1) / 2;
      pts.push(
        { x: cx, y: cy },
        { x: cx - rx, y: cy }, { x: cx + rx, y: cy },
        { x: cx, y: cy - ry }, { x: cx, y: cy + ry },
      );
      break;
    }
    case 'polygon':
    case 'wall': {
      if (!s.points) break;
      s.points.forEach(p => pts.push({ x: p.x, y: p.y }));
      for (let i = 0; i < s.points.length - 1; i++) {
        const p1 = s.points[i], p2 = s.points[i + 1];
        pts.push({ x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 });
      }
      if (s.closed && s.points.length > 1) {
        const p1 = s.points[s.points.length - 1], p2 = s.points[0];
        pts.push({ x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 });
      }
      break;
    }
    case 'text':
    case 'symbol':
      pts.push({ x: s.x, y: s.y });
      break;
  }
}

function getSnapCandidates(excludeIds) {
  const pts = [];
  forEachVisibleLayer(state.layers, layer => {
    for (const s of layer.shapes) {
      if (excludeIds && excludeIds.has(s.id)) continue;
      addShapeCandidates(pts, s);
    }
  });
  // Let an in-progress polygon/wall snap back onto its own earlier points (closing the loop)
  if ((state.tool === 'polygon' || state.tool === 'wall') && drag.polyPoints.length) {
    drag.polyPoints.forEach(p => pts.push({ x: p.x, y: p.y }));
  }
  return pts;
}

function nearestSnapPoint(wx, wy, excludeIds) {
  const thresholdWorld = SNAP_SHAPE_PX / state.zoom;
  let best = null, bestDistSq = thresholdWorld * thresholdWorld;
  for (const p of getSnapCandidates(excludeIds)) {
    const dx = p.x - wx, dy = p.y - wy;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) { bestDistSq = distSq; best = p; }
  }
  return best;
}

function getCanvasPos(e, excludeIds) {
  const r = overlayCanvas.getBoundingClientRect();
  const sx = (e.clientX ?? e.touches[0].clientX) - r.left;
  const sy = (e.clientY ?? e.touches[0].clientY) - r.top;
  const w  = screenToWorld(sx, sy);
  let wx = w.x, wy = w.y;
  let snappedToShape = false;

  if (state.snapToShapes) {
    const snapped = nearestSnapPoint(w.x, w.y, excludeIds);
    if (snapped) { wx = snapped.x; wy = snapped.y; snappedToShape = true; }
  }
  if (!snappedToShape && state.snapToGrid) {
    wx = snap(wx); wy = snap(wy);
  }
  state.snapIndicator = snappedToShape ? { x: wx, y: wy } : null;

  return { sx, sy, wx, wy, rawX: w.x, rawY: w.y };
}

// Logical (CSS-pixel) canvas size, kept in sync by resizeCanvases(). All the
// pan/zoom/hit-test math in this file works in these units — the canvases'
// actual backing-store pixel counts are DPR times bigger (see below) so
// rendering stays crisp on Retina/high-DPI displays, but nothing else needs
// to know that.
let VIEW_W = 0, VIEW_H = 0;

function getDPR() {
  return window.devicePixelRatio || 1;
}

function resizeCanvases() {
  const container = document.getElementById('canvas-container');
  const W = container.clientWidth;
  const H = container.clientHeight;
  const dpr = getDPR();
  VIEW_W = W; VIEW_H = H;
  [gridCanvas, mainCanvas, overlayCanvas].forEach(c => {
    c.width  = W * dpr;
    c.height = H * dpr;
    // Setting width/height resets the transform to identity, so this is a
    // one-time-per-resize scale, not a cumulative one. Everything else in
    // this file keeps drawing in logical (CSS) pixels; this is the only
    // place that has to think about physical pixels.
    c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  });
  redrawAll();
}

// ── Layer tree helpers ───────────────────────────────────────────────────────
// Layers form a tree: each node has shapes: [] (its own content) and
// children: [] (nested sub-layers, e.g. per-circuit layers under
// "Electrical"). A node can hold shapes AND have children at the same time.
// Sibling order follows the existing convention: index 0 = topmost/visually
// on top. Within a node, children paint above (on top of) that node's own
// shapes, so more-specific sub-layers read as sitting over the general one.

function countAllLayers(nodes) {
  let n = 0;
  for (const node of nodes) {
    n++;
    if (node.children && node.children.length) n += countAllLayers(node.children);
  }
  return n;
}

function findLayerById(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children && node.children.length) {
      const found = findLayerById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

// Lock cascades like visibility: a locked layer's children are also
// effectively locked, regardless of their own flag. Only the active layer
// is editable — every other layer is implicitly locked too, so switching
// the active layer is what moves the "can edit" boundary around, on top
// of any manual lock.
function isLayerEffectivelyLocked(targetId) {
  if (state.activeLayerId && targetId !== state.activeLayerId) return true;
  function walk(nodes, ancestorLocked) {
    for (const node of nodes) {
      const eff = ancestorLocked || !!node.locked;
      if (node.id === targetId) return eff;
      if (node.children && node.children.length) {
        const r = walk(node.children, eff);
        if (r !== null) return r;
      }
    }
    return null;
  }
  return walk(state.layers, false) || false;
}

// Returns { array, index } for whichever sibling array currently contains id
// (state.layers itself, or some layer's children array at any depth).
function findSiblingSlot(nodes, id) {
  const idx = nodes.findIndex(n => n.id === id);
  if (idx !== -1) return { array: nodes, index: idx };
  for (const node of nodes) {
    if (node.children && node.children.length) {
      const found = findSiblingSlot(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

function removeLayerById(nodes, id) {
  const idx = nodes.findIndex(n => n.id === id);
  if (idx !== -1) { nodes.splice(idx, 1); return true; }
  for (const node of nodes) {
    if (node.children && node.children.length && removeLayerById(node.children, id)) return true;
  }
  return false;
}

// Visits every node depth-first, own shapes painting before (below) children,
// later siblings before (below) earlier siblings — i.e. bottom-to-top paint
// order. visibility cascades: a node is only passed to fn if it and every
// ancestor is visible.
function paintLayerTree(nodes, fn, ancestorVisible = true) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    const effectiveVisible = ancestorVisible && node.visible;
    if (effectiveVisible) fn(node);
    if (node.children && node.children.length) paintLayerTree(node.children, fn, effectiveVisible);
  }
}

// Opposite traversal order (topmost-first: children before own shapes,
// earlier siblings before later ones) for hit-testing, where the caller
// wants the first match under the cursor. fn returning true stops the walk.
function forEachLayerTopFirst(nodes, fn, ancestorVisible = true) {
  for (const node of nodes) {
    const effectiveVisible = ancestorVisible && node.visible;
    if (node.children && node.children.length) {
      if (forEachLayerTopFirst(node.children, fn, effectiveVisible)) return true;
    }
    if (effectiveVisible && fn(node)) return true;
  }
  return false;
}

// Visits every visible node (any order) — for accumulating across all
// layers (snap candidates, eraser, rubber-band) where order doesn't matter.
function forEachVisibleLayer(nodes, fn, ancestorVisible = true) {
  for (const node of nodes) {
    const effectiveVisible = ancestorVisible && node.visible;
    if (effectiveVisible) fn(node);
    if (node.children && node.children.length) forEachVisibleLayer(node.children, fn, effectiveVisible);
  }
}

function activeLayer() {
  return findLayerById(state.layers, state.activeLayerId);
}

function addLayer(name, color, parentId) {
  const layer = {
    id: uid(),
    name: name || `Layer ${countAllLayers(state.layers) + 1}`,
    visible: true,
    color: color || LAYER_COLORS[countAllLayers(state.layers) % LAYER_COLORS.length],
    shapes: [],
    children: [],
    expanded: true,
    locked: false,
  };
  const parent = parentId ? findLayerById(state.layers, parentId) : null;
  if (parent) {
    parent.children.unshift(layer);
    parent.expanded = true;
  } else {
    state.layers.unshift(layer);
  }
  state.activeLayerId = layer.id;
  // Only the active layer is editable, so anything selected on the
  // previously-active layer needs to drop out of the selection.
  state.selection = state.selection.filter(id => {
    const found = findShapeById(id);
    return found && !isLayerEffectivelyLocked(found.layer.id);
  });
  updateSelectionPanel();
  saveHistory();
  renderLayers();
  updateMoveToLayer();
  redrawMain();
  redrawOverlay();
  return layer;
}

function findShapeById(id) {
  let result = null;
  forEachVisibleLayerIncludingHidden(state.layers, node => {
    if (result) return;
    const shape = node.shapes.find(s => s.id === id);
    if (shape) result = { layer: node, shape };
  });
  return result;
}

// Like forEachVisibleLayer but ignores visibility entirely — used by
// findShapeById, which must find a shape regardless of whether its layer
// (or an ancestor) is currently hidden.
function forEachVisibleLayerIncludingHidden(nodes, fn) {
  for (const node of nodes) {
    fn(node);
    if (node.children && node.children.length) forEachVisibleLayerIncludingHidden(node.children, fn);
  }
}

// ── History ───────────────────────────────────────────────────────────────────
function snapshot() {
  return JSON.stringify({ layers: state.layers, activeLayerId: state.activeLayerId });
}

function saveHistory() {
  state.history.push(snapshot());
  if (state.history.length > 100) state.history.shift();
  state.future = [];
  scheduleAutosave();
}

function undo() {
  if (state.history.length < 2) return;
  state.future.push(state.history.pop());
  const prev = state.history[state.history.length - 1];
  const parsed = JSON.parse(prev);
  state.layers = parsed.layers;
  state.activeLayerId = parsed.activeLayerId;
  state.selection = [];
  renderLayers();
  updateMoveToLayer();
  redrawAll();
  scheduleAutosave();
}

function redo() {
  if (!state.future.length) return;
  const next = state.future.pop();
  state.history.push(next);
  const parsed = JSON.parse(next);
  state.layers = parsed.layers;
  state.activeLayerId = parsed.activeLayerId;
  state.selection = [];
  renderLayers();
  updateMoveToLayer();
  redrawAll();
  scheduleAutosave();
}

// ── Autosave (localStorage) ──────────────────────────────────────────────────
const AUTOSAVE_KEY = 'floorplan-autosave-v2'; // v2: layers became a tree (children/expanded)
let autosaveTimer = null;

function setAutosaveStatus(text, isError) {
  const el = document.getElementById('autosaveStatus');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', !!isError);
}

function scheduleAutosave() {
  setAutosaveStatus('Saving…');
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      const data = JSON.stringify({
        layers: state.layers,
        scale: state.scale,
        snapDivisions: state.snapDivisions,
        savedAt: Date.now(),
      });
      localStorage.setItem(AUTOSAVE_KEY, data);
      setAutosaveStatus('Saved');
    } catch (err) {
      setAutosaveStatus('Autosave failed', true);
    }
  }, 600);
}

function tryRestoreAutosave() {
  let raw;
  try { raw = localStorage.getItem(AUTOSAVE_KEY); } catch { return false; }
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    if (!data.layers || !data.layers.length) return false;
    state.layers        = data.layers;
    state.activeLayerId = data.layers[0]?.id || null;
    if (data.scale) Object.assign(state.scale, data.scale);
    if (data.snapDivisions) state.snapDivisions = data.snapDivisions;
    return true;
  } catch {
    return false;
  }
}

async function clearAutosaveAndReset() {
  const ok = await confirmModal(
    'This clears the current drawing and autosave. Export/Save first if you want to keep it.',
    'Start a New Floorplan?'
  );
  if (!ok) return;
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch {}
  state.layers = [];
  state.selection = [];
  addLayer('Base', '#e0e0e0');
  state.history = [snapshot()];
  state.future = [];
  renderLayers();
  updateMoveToLayer();
  updateSelectionPanel();
  redrawAll();
  setAutosaveStatus('Saved');
}

function showRestoredToast() {
  const toast = document.getElementById('autosave-toast');
  if (!toast) return;
  toast.style.display = 'flex';
  const hide = () => { toast.style.display = 'none'; };
  document.getElementById('toastDismiss').onclick = hide;
  setTimeout(hide, 6000);
}

// ── Shape drawing ─────────────────────────────────────────────────────────────
function drawArrowhead(ctx, x, y, angle, size) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - size * Math.cos(angle - Math.PI / 7), y - size * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(x - size * Math.cos(angle + Math.PI / 7), y - size * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

function applyStyle(ctx, shape, layerColor, scale) {
  ctx.strokeStyle = shape.stroke;
  ctx.lineWidth   = shape.strokeWidth / scale;
  ctx.fillStyle   = shape.fill;

  if (shape.dash === 'dashed') ctx.setLineDash([8 / scale, 4 / scale]);
  else if (shape.dash === 'dotted') ctx.setLineDash([2 / scale, 4 / scale]);
  else ctx.setLineDash([]);
}

function drawShape(ctx, shape, layerColor, scale = 1) {
  ctx.save();
  applyStyle(ctx, shape, layerColor, scale);

  switch (shape.type) {
    case 'line': {
      ctx.beginPath();
      ctx.moveTo(shape.x1, shape.y1);
      ctx.lineTo(shape.x2, shape.y2);
      ctx.stroke();
      break;
    }
    case 'rect': {
      const x = Math.min(shape.x1, shape.x2);
      const y = Math.min(shape.y1, shape.y2);
      const w = Math.abs(shape.x2 - shape.x1);
      const h = Math.abs(shape.y2 - shape.y1);
      if (shape.fillEnabled) { ctx.fillStyle = shape.fill; ctx.fillRect(x, y, w, h); }
      ctx.strokeRect(x, y, w, h);
      break;
    }
    case 'circle': {
      const cx = (shape.x1 + shape.x2) / 2;
      const cy = (shape.y1 + shape.y2) / 2;
      const rx = Math.abs(shape.x2 - shape.x1) / 2;
      const ry = Math.abs(shape.y2 - shape.y1) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      if (shape.fillEnabled) { ctx.fillStyle = shape.fill; ctx.fill(); }
      ctx.stroke();
      break;
    }
    case 'polygon': {
      if (!shape.points || shape.points.length < 2) break;
      ctx.beginPath();
      ctx.moveTo(shape.points[0].x, shape.points[0].y);
      for (let i = 1; i < shape.points.length; i++) {
        ctx.lineTo(shape.points[i].x, shape.points[i].y);
      }
      if (shape.closed) {
        ctx.closePath();
        if (shape.fillEnabled) { ctx.fillStyle = shape.fill; ctx.fill(); }
      }
      ctx.stroke();
      break;
    }
    case 'wall': {
      if (!shape.points || shape.points.length < 2) break;
      const pts = shape.closed ? [...shape.points, shape.points[0]] : shape.points;

      // Rendered as a thick filled band (real-world thickness, so it scales
      // with zoom like any other geometry) rather than a thin outline —
      // that's what makes it read as a wall instead of just a line.
      ctx.save();
      ctx.setLineDash([]);
      ctx.lineJoin    = 'round';
      ctx.lineCap     = 'round';
      ctx.strokeStyle = shape.stroke;
      ctx.lineWidth   = shape.thickness || 12;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      ctx.restore();

      // Thin centerline edges for a crisp double-line look at any zoom
      ctx.save();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth   = Math.max(0.5, 1 / scale);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'stairs': {
      const bx = Math.min(shape.x1, shape.x2);
      const by = Math.min(shape.y1, shape.y2);
      const bw = Math.abs(shape.x2 - shape.x1);
      const bh = Math.abs(shape.y2 - shape.y1);
      if (bw < 1 || bh < 1) break;

      if (shape.fillEnabled) { ctx.fillStyle = shape.fill; ctx.fillRect(bx, by, bw, bh); }
      ctx.strokeRect(bx, by, bw, bh);

      // Treads run perpendicular to the longer dimension, spaced at a
      // real-world tread depth (~10.5in) so the count scales with the
      // drawing's scale setting, not a fixed line count.
      const horizontal   = bw >= bh;
      const runLength    = horizontal ? bw : bh;
      const treadSpacing = Math.max(4, 10.5 * worldUnitsPerInch());
      const numTreads    = Math.min(30, Math.max(3, Math.round(runLength / treadSpacing)));

      ctx.beginPath();
      for (let i = 1; i < numTreads; i++) {
        const t = i / numTreads;
        if (horizontal) {
          const x = bx + bw * t;
          ctx.moveTo(x, by); ctx.lineTo(x, by + bh);
        } else {
          const y = by + bh * t;
          ctx.moveTo(bx, y); ctx.lineTo(bx + bw, y);
        }
      }
      ctx.stroke();

      // Directional arrow along the centerline, oriented by drag direction
      let ax1, ay1, ax2, ay2;
      if (horizontal) {
        const cy = by + bh / 2;
        const leftToRight = shape.x2 >= shape.x1;
        ax1 = leftToRight ? bx + bw * 0.1 : bx + bw * 0.9;
        ax2 = leftToRight ? bx + bw * 0.9 : bx + bw * 0.1;
        ay1 = ay2 = cy;
      } else {
        const cx = bx + bw / 2;
        const topToBottom = shape.y2 >= shape.y1;
        ay1 = topToBottom ? by + bh * 0.1 : by + bh * 0.9;
        ay2 = topToBottom ? by + bh * 0.9 : by + bh * 0.1;
        ax1 = ax2 = cx;
      }
      ctx.save();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(ax1, ay1);
      ctx.lineTo(ax2, ay2);
      ctx.stroke();
      const angle = Math.atan2(ay2 - ay1, ax2 - ax1);
      ctx.fillStyle = shape.stroke;
      drawArrowhead(ctx, ax2, ay2, angle, Math.min(bw, bh) * 0.18 + 3 / scale);
      ctx.restore();

      drawMeasLabel(ctx, shape.direction === 'down' ? 'DN' : 'UP', ax1, ay1, scale);
      break;
    }
    case 'text': {
      ctx.fillStyle = shape.stroke;
      ctx.font = `${shape.fontSize || 14}px -apple-system, sans-serif`;
      ctx.fillText(shape.text, shape.x, shape.y);
      break;
    }
    case 'symbol': {
      const sym = SYMBOLS.find(s => s.key === shape.symbolKey);
      if (!sym) break;
      ctx.save();
      ctx.translate(shape.x, shape.y);
      if (shape.rotation) ctx.rotate(shape.rotation * Math.PI / 180);
      ctx.strokeStyle  = shape.stroke;
      ctx.lineWidth    = shape.strokeWidth / scale;
      ctx.fillStyle    = shape.stroke;
      ctx.setLineDash([]);
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      // Non-uniform sizing draws at the X radius, then stretches the Y axis
      // by the width:height ratio — the symbol's own draw() functions never
      // need to know about it, since it's a plain post-hoc canvas scale.
      const rx = symEffSizeX(shape) / 2, ry = symEffSizeY(shape) / 2;
      if (Math.abs(rx - ry) >= 0.5) ctx.scale(1, ry / rx);
      sym.draw(ctx, rx);
      ctx.restore();
      break;
    }
  }
  ctx.restore();
}

function shapeBounds(shape) {
  switch (shape.type) {
    case 'line':
      return {
        x: Math.min(shape.x1, shape.x2) - 4,
        y: Math.min(shape.y1, shape.y2) - 4,
        w: Math.abs(shape.x2 - shape.x1) + 8,
        h: Math.abs(shape.y2 - shape.y1) + 8,
      };
    case 'rect':
    case 'circle':
    case 'stairs': {
      const x = Math.min(shape.x1, shape.x2);
      const y = Math.min(shape.y1, shape.y2);
      return {
        x: x - 4,
        y: y - 4,
        w: Math.abs(shape.x2 - shape.x1) + 8,
        h: Math.abs(shape.y2 - shape.y1) + 8,
      };
    }
    case 'polygon': {
      if (!shape.points.length) return { x: 0, y: 0, w: 0, h: 0 };
      const xs = shape.points.map(p => p.x);
      const ys = shape.points.map(p => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      return { x: minX - 4, y: minY - 4, w: maxX - minX + 8, h: maxY - minY + 8 };
    }
    case 'wall': {
      if (!shape.points.length) return { x: 0, y: 0, w: 0, h: 0 };
      const pad = Math.max(4, (shape.thickness || 12) / 2 + 2);
      const xs = shape.points.map(p => p.x);
      const ys = shape.points.map(p => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    }
    case 'text':
      return { x: shape.x - 4, y: shape.y - 20, w: 120, h: 24 };
    case 'symbol': {
      const b = getSymbolWorldBounds(shape);
      if (!b) {
        const r = (symEffSizeX(shape) + symEffSizeY(shape)) / 4 + 4;
        return { x: shape.x - r, y: shape.y - r, w: r * 2, h: r * 2 };
      }
      const pad = 4;
      return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    }
    default:
      return { x: 0, y: 0, w: 0, h: 0 };
  }
}

function hitTest(shape, wx, wy) {
  const b = shapeBounds(shape);
  return wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h;
}

// ── Resize handles ────────────────────────────────────────────────────────────
// Each handle's apply(wx, wy) mutates the shape in place to track the drag.
// Corner/endpoint handles keep the shape's original x1/y1 vs x2/y2 identity
// (rather than a normalized min/max box) so dragging past the opposite corner
// flips orientation naturally instead of collapsing — this matters for
// stairs, whose direction arrow depends on the sign of x2-x1 / y2-y1.
function getShapeHandles(shape) {
  switch (shape.type) {
    case 'line':
      return [
        { x: shape.x1, y: shape.y1, apply: (wx, wy) => { shape.x1 = wx; shape.y1 = wy; } },
        { x: shape.x2, y: shape.y2, apply: (wx, wy) => { shape.x2 = wx; shape.y2 = wy; } },
      ];
    case 'rect':
    case 'circle':
    case 'stairs':
      return [
        { x: shape.x1, y: shape.y1, apply: (wx, wy) => { shape.x1 = wx; shape.y1 = wy; } },
        { x: shape.x2, y: shape.y2, apply: (wx, wy) => { shape.x2 = wx; shape.y2 = wy; } },
        { x: shape.x1, y: shape.y2, apply: (wx, wy) => { shape.x1 = wx; shape.y2 = wy; } },
        { x: shape.x2, y: shape.y1, apply: (wx, wy) => { shape.x2 = wx; shape.y1 = wy; } },
      ];
    case 'polygon':
    case 'wall':
      return (shape.points || []).map((p, i) => ({
        x: p.x, y: p.y,
        apply: (wx, wy) => { shape.points[i] = { x: wx, y: wy }; },
      }));
    case 'symbol': {
      const sym = SYMBOLS.find(s => s.key === shape.symbolKey);
      const nb = sym ? getSymbolNormalizedBBox(sym) : { x0: -1, y0: -1, x1: 1, y1: 1 };
      const startX = symEffSizeX(shape), startY = symEffSizeY(shape);
      const hrx = startX / 2, hry = startY / 2;
      const rad = (shape.rotation || 0) * Math.PI / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const toWorld = (lx, ly) => ({ x: shape.x + lx * cos - ly * sin, y: shape.y + lx * sin + ly * cos });
      const toLocal = (wx, wy) => {
        const dx = wx - shape.x, dy = wy - shape.y;
        return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
      };
      // Once a symbol goes non-uniform, pin both axes explicitly so the
      // legacy `size` field (still driven by the Symbols panel's Size
      // field) can't silently pull one axis out of sync with the other.
      const pinBothAxes = () => {
        if (shape.sizeX === undefined) shape.sizeX = startX;
        if (shape.sizeY === undefined) shape.sizeY = startY;
      };

      // Corner: uniform resize, scaling whatever the current width/height
      // are by the same factor — preserves a couch's custom aspect ratio
      // instead of forcing it back to square. Relative to drag-start
      // distance so grabbing it never jumps for asymmetric symbols.
      const corner = toWorld(nb.x1 * hrx, nb.y1 * hry);
      const cornerRefDist = Math.hypot(corner.x - shape.x, corner.y - shape.y) || 1;

      // Edge handles: width (right-middle) and height (bottom-middle),
      // each independent of the other — this is what lets a couch be
      // wider than it is deep instead of only scaling as one square.
      const widthPt  = toWorld(nb.x1 * hrx, (nb.y0 + nb.y1) / 2 * hry);
      const heightPt = toWorld((nb.x0 + nb.x1) / 2 * hrx, nb.y1 * hry);

      // Rotate handle floats above the symbol's actual top edge, in its own
      // (already-rotated) local "up" direction, so it stays put visually
      // relative to the symbol as you spin it — not every door sits on a
      // horizontal wall, so rotation isn't limited to 90deg steps here.
      const localUpDist = Math.max(0, -nb.y0) * hry + 22;
      const rotatePt = toWorld(0, -localUpDist);

      return [
        {
          x: corner.x, y: corner.y,
          apply: (wx, wy) => {
            const newDist = Math.hypot(wx - shape.x, wy - shape.y);
            const k = newDist / cornerRefDist;
            shape.sizeX = Math.max(4, startX * k);
            shape.sizeY = Math.max(4, startY * k);
            shape.size  = shape.sizeX;
          },
        },
        {
          x: widthPt.x, y: widthPt.y,
          apply: (wx, wy) => {
            pinBothAxes();
            const l = toLocal(wx, wy);
            shape.sizeX = Math.max(4, (Math.abs(l.x) / Math.abs(nb.x1 || 1)) * 2);
          },
        },
        {
          x: heightPt.x, y: heightPt.y,
          apply: (wx, wy) => {
            pinBothAxes();
            const l = toLocal(wx, wy);
            shape.sizeY = Math.max(4, (Math.abs(l.y) / Math.abs(nb.y1 || 1)) * 2);
          },
        },
        {
          x: rotatePt.x, y: rotatePt.y, isRotate: true,
          apply: (wx, wy, shiftKey) => {
            const dx = wx - shape.x, dy = wy - shape.y;
            let deg = Math.atan2(dx, -dy) * 180 / Math.PI;
            if (shiftKey) deg = Math.round(deg / 15) * 15;
            shape.rotation = ((deg % 360) + 360) % 360;
          },
        },
      ];
    }
    default:
      return [];
  }
}

function hitTestHandles(shape, wx, wy) {
  // A generous threshold matters more now that symbols can show 4 handles
  // (corner/width/height/rotate) clustered close together — small and
  // imprecise on a touchscreen especially. Picking the closest handle
  // within range (not just the first one encountered) avoids grabbing the
  // wrong one when two thresholds overlap.
  const threshold = (HANDLE_R + 9) / state.zoom;
  let closest = null, closestDist = threshold;
  for (const h of getShapeHandles(shape)) {
    const d = Math.hypot(h.x - wx, h.y - wy);
    if (d <= closestDist) { closestDist = d; closest = h; }
  }
  return closest;
}

// ── Measurements ──────────────────────────────────────────────────────────────
// worldUnits -> real-world number, in the current scale unit (no suffix)
function measurementRealValue(worldUnits) {
  return (worldUnits / GRID_SIZE) * state.scale.gridValue;
}

// Inverse of measurementRealValue: a number typed in the current scale unit
// -> world units, for applying an edited measurement back to a shape.
function realToWorldUnits(real) {
  if (!(state.scale.gridValue > 0)) return real;
  return (real / state.scale.gridValue) * GRID_SIZE;
}

function formatMeasurement(worldUnits) {
  if (worldUnits < 0.5) return '';
  const real = measurementRealValue(worldUnits);
  if (state.scale.unit === 'ft') return formatFeetInches(real);
  const d = real >= 100 ? 0 : real >= 10 ? 1 : 2;
  return `${parseFloat(real.toFixed(d))} ${state.scale.unit}`;
}

// Value for pre-filling the edit input — feet+inches string to match the
// label when the scale unit is ft (parseFeetInches reads it back), a plain
// number otherwise.
function formatMeasurementForEdit(worldUnits) {
  const real = measurementRealValue(worldUnits);
  if (state.scale.unit === 'ft') return formatFeetInches(real);
  const d = real >= 100 ? 0 : real >= 10 ? 1 : 2;
  return parseFloat(real.toFixed(d));
}

// Parses "2ft 8in", "2' 8"", "2ft8in", "2 8" (feet, inches), "8in"/"8"",
// or a plain decimal (feet) — whatever someone naturally types for a
// feet-and-inches value. Returns null if nothing usable was found.
function parseFeetInches(str) {
  str = String(str).trim();
  let m = str.match(/^(-?\d+(?:\.\d+)?)\s*(?:ft|')\s*(?:(-?\d+(?:\.\d+)?)\s*(?:in|"))?$/i);
  if (m) return parseFloat(m[1]) + (m[2] ? parseFloat(m[2]) / 12 : 0);
  m = str.match(/^(-?\d+(?:\.\d+)?)\s*(?:in|")$/i);
  if (m) return parseFloat(m[1]) / 12;
  m = str.match(/^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/);
  if (m) return parseFloat(m[1]) + parseFloat(m[2]) / 12;
  const n = parseFloat(str);
  return isNaN(n) ? null : n;
}

function drawMeasLabel(ctx, text, x, y, scale) {
  if (!text) return null;
  const fs  = 11 / scale;
  const pad = 3 / scale;
  ctx.save();
  ctx.font         = `${fs}px -apple-system, sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(14,14,30,0.78)';
  ctx.fillRect(x - tw / 2 - pad, y - fs / 2 - pad, tw + pad * 2, fs + pad * 2);
  ctx.fillStyle = '#a8c4ff';
  ctx.fillText(text, x, y);
  ctx.restore();
  return { halfW: tw / 2 + pad, halfH: fs / 2 + pad };
}

// Registers a label's clickable region in world space (called only for the
// live/interactive canvas, not the PNG export render). angle is whatever
// rotation was applied via ctx.rotate() right before drawing the label at
// local (0,0), so the hit-test can transform a click into the label's frame.
function registerMeasLabel(recordInto, shapeId, dimension, x, y, angle, box, segmentIndex) {
  if (!recordInto || !box) return;
  recordInto.push({ shapeId, dimension, segmentIndex, x, y, angle, halfW: box.halfW, halfH: box.halfH });
}

function drawMeasurements(ctx, shape, scale, recordInto) {
  if (!state.scale.showMeasurements) return;
  const off = 14 / scale; // label offset from shape edge

  switch (shape.type) {
    case 'line': {
      const dx  = shape.x2 - shape.x1;
      const dy  = shape.y2 - shape.y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1) return;
      const mx  = (shape.x1 + shape.x2) / 2;
      const my  = (shape.y1 + shape.y2) / 2;
      const ang = Math.atan2(dy, dx);
      // Offset perpendicular to line
      const lx  = mx - Math.sin(ang) * off;
      const ly  = my + Math.cos(ang) * off;
      const drawAng = ang > Math.PI / 2 || ang < -Math.PI / 2 ? ang + Math.PI : ang;
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(drawAng);
      const box = drawMeasLabel(ctx, formatMeasurement(len), 0, 0, scale);
      ctx.restore();
      registerMeasLabel(recordInto, shape.id, 'length', lx, ly, drawAng, box);
      break;
    }
    case 'rect':
    case 'stairs': {
      const x = Math.min(shape.x1, shape.x2);
      const y = Math.min(shape.y1, shape.y2);
      const w = Math.abs(shape.x2 - shape.x1);
      const h = Math.abs(shape.y2 - shape.y1);
      if (w < 1 || h < 1) return;
      // Width label above top edge
      const wx = x + w / 2, wy = y - off;
      const wBox = drawMeasLabel(ctx, formatMeasurement(w), wx, wy, scale);
      registerMeasLabel(recordInto, shape.id, 'width', wx, wy, 0, wBox);
      // Height label right of right edge, rotated
      const hx = x + w + off, hy = y + h / 2;
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(Math.PI / 2);
      const hBox = drawMeasLabel(ctx, formatMeasurement(h), 0, 0, scale);
      ctx.restore();
      registerMeasLabel(recordInto, shape.id, 'height', hx, hy, Math.PI / 2, hBox);
      break;
    }
    case 'circle': {
      const cx = (shape.x1 + shape.x2) / 2;
      const cy = (shape.y1 + shape.y2) / 2;
      const rx = Math.abs(shape.x2 - shape.x1) / 2;
      const ry = Math.abs(shape.y2 - shape.y1) / 2;
      if (rx < 1 && ry < 1) return;
      if (rx === ry) {
        const box = drawMeasLabel(ctx, 'Ø ' + formatMeasurement(rx * 2), cx, cy, scale);
        registerMeasLabel(recordInto, shape.id, 'diameter', cx, cy, 0, box);
      } else {
        // Two independently-editable labels, laid out like rect's, but
        // tagged as ellipseWidth/Height (not width/height) since editing
        // them must keep the center fixed, unlike rect's anchor-preserving
        // behavior.
        const wy = cy - ry - off;
        const wBox = drawMeasLabel(ctx, formatMeasurement(rx * 2), cx, wy, scale);
        registerMeasLabel(recordInto, shape.id, 'ellipseWidth', cx, wy, 0, wBox);
        const hx = cx + rx + off;
        ctx.save();
        ctx.translate(hx, cy);
        ctx.rotate(Math.PI / 2);
        const hBox = drawMeasLabel(ctx, formatMeasurement(ry * 2), 0, 0, scale);
        ctx.restore();
        registerMeasLabel(recordInto, shape.id, 'ellipseHeight', hx, cy, Math.PI / 2, hBox);
      }
      break;
    }
    case 'polygon':
    case 'wall': {
      if (!shape.points || shape.points.length < 2) return;
      const pts = shape.closed
        ? [...shape.points, shape.points[0]]
        : shape.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const p1  = pts[i], p2 = pts[i + 1];
        const dx  = p2.x - p1.x, dy = p2.y - p1.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1) continue;
        const mx  = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        const ang = Math.atan2(dy, dx);
        const drawAng = ang > Math.PI / 2 || ang < -Math.PI / 2 ? ang + Math.PI : ang;
        const lx = mx - Math.sin(ang) * off, ly = my + Math.cos(ang) * off;
        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(drawAng);
        const box = drawMeasLabel(ctx, formatMeasurement(len), 0, 0, scale);
        ctx.restore();
        registerMeasLabel(recordInto, shape.id, 'segment', lx, ly, drawAng, box, i);
      }
      break;
    }
    case 'symbol': {
      // Not every door/window/fixture is the same size — show and allow
      // editing the symbol's real-world size, positioned below its actual
      // drawn extent (not a guessed half-size square). Once resized
      // non-uniformly (a couch wider than it is deep), this splits into
      // independent width/depth labels instead of one combined size,
      // matching how a non-circular ellipse already behaves.
      const b = getSymbolWorldBounds(shape);
      if (!b) return;
      if (symIsUniform(shape)) {
        const lx = shape.x, ly = b.y + b.h + off;
        const box = drawMeasLabel(ctx, formatMeasurement(symEffSizeX(shape)), lx, ly, scale);
        registerMeasLabel(recordInto, shape.id, 'symbolSize', lx, ly, 0, box);
      } else {
        const wx = shape.x, wy = b.y + b.h + off;
        const wBox = drawMeasLabel(ctx, formatMeasurement(symEffSizeX(shape)), wx, wy, scale);
        registerMeasLabel(recordInto, shape.id, 'symbolWidth', wx, wy, 0, wBox);
        const hx = b.x + b.w + off, hy = shape.y;
        ctx.save();
        ctx.translate(hx, hy);
        ctx.rotate(Math.PI / 2);
        const hBox = drawMeasLabel(ctx, formatMeasurement(symEffSizeY(shape)), 0, 0, scale);
        ctx.restore();
        registerMeasLabel(recordInto, shape.id, 'symbolHeight', hx, hy, Math.PI / 2, hBox);
      }
      break;
    }
  }
}

// ── Measurement label editing ────────────────────────────────────────────────
function hitTestMeasurementLabel(wx, wy) {
  for (let i = state.measurementLabels.length - 1; i >= 0; i--) {
    const l = state.measurementLabels[i];
    const dx = wx - l.x, dy = wy - l.y;
    const cos = Math.cos(-l.angle), sin = Math.sin(-l.angle);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    if (Math.abs(lx) <= l.halfW && Math.abs(ly) <= l.halfH) {
      const found = findShapeById(l.shapeId);
      if (found && isLayerEffectivelyLocked(found.layer.id)) continue;
      return l;
    }
  }
  return null;
}

// Current world-space length/width/height for whatever dimension a label
// represents, read fresh from the shape (not the cached label) so the edit
// box always starts from the live value.
function getShapeDimensionWorld(shape, dimension, segmentIndex) {
  switch (dimension) {
    case 'length':
      return Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1);
    case 'width':
      return Math.abs(shape.x2 - shape.x1);
    case 'height':
      return Math.abs(shape.y2 - shape.y1);
    case 'diameter':
      return Math.abs(shape.x2 - shape.x1);
    case 'ellipseWidth':
      return Math.abs(shape.x2 - shape.x1);
    case 'ellipseHeight':
      return Math.abs(shape.y2 - shape.y1);
    case 'segment': {
      const pts = shape.points;
      const i2 = (segmentIndex + 1) % pts.length;
      return Math.hypot(pts[i2].x - pts[segmentIndex].x, pts[i2].y - pts[segmentIndex].y);
    }
    case 'symbolSize':
      return symEffSizeX(shape);
    case 'symbolWidth':
      return symEffSizeX(shape);
    case 'symbolHeight':
      return symEffSizeY(shape);
    default:
      return 0;
  }
}

// Mutates the shape so the given dimension matches newWorld (world units),
// preserving direction/center as appropriate per shape type.
function applyMeasurementEdit(shape, dimension, segmentIndex, newWorld) {
  if (!(newWorld > 0)) return false;
  switch (dimension) {
    case 'length': {
      const dx = shape.x2 - shape.x1, dy = shape.y2 - shape.y1;
      const cur = Math.hypot(dx, dy);
      if (cur < 0.001) return false;
      const k = newWorld / cur;
      shape.x2 = shape.x1 + dx * k;
      shape.y2 = shape.y1 + dy * k;
      return true;
    }
    case 'width': {
      const sign = Math.sign(shape.x2 - shape.x1) || 1;
      shape.x2 = shape.x1 + sign * newWorld;
      return true;
    }
    case 'height': {
      const sign = Math.sign(shape.y2 - shape.y1) || 1;
      shape.y2 = shape.y1 + sign * newWorld;
      return true;
    }
    case 'diameter': {
      const cx = (shape.x1 + shape.x2) / 2, cy = (shape.y1 + shape.y2) / 2;
      const r = newWorld / 2;
      shape.x1 = cx - r; shape.x2 = cx + r;
      shape.y1 = cy - r; shape.y2 = cy + r;
      return true;
    }
    case 'ellipseWidth': {
      const cx = (shape.x1 + shape.x2) / 2;
      const r = newWorld / 2;
      shape.x1 = cx - r; shape.x2 = cx + r;
      return true;
    }
    case 'ellipseHeight': {
      const cy = (shape.y1 + shape.y2) / 2;
      const r = newWorld / 2;
      shape.y1 = cy - r; shape.y2 = cy + r;
      return true;
    }
    case 'segment': {
      const pts = shape.points;
      const i2 = (segmentIndex + 1) % pts.length;
      const p1 = pts[segmentIndex], p2 = pts[i2];
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const cur = Math.hypot(dx, dy);
      if (cur < 0.001) return false;
      const k = newWorld / cur;
      pts[i2] = { x: p1.x + dx * k, y: p1.y + dy * k };
      return true;
    }
    case 'symbolSize':
      shape.size = newWorld;
      delete shape.sizeX;
      delete shape.sizeY;
      return true;
    case 'symbolWidth': {
      if (shape.sizeY === undefined) shape.sizeY = symEffSizeY(shape);
      shape.sizeX = newWorld;
      return true;
    }
    case 'symbolHeight': {
      if (shape.sizeX === undefined) shape.sizeX = symEffSizeX(shape);
      shape.sizeY = newWorld;
      return true;
    }
    default:
      return false;
  }
}

let editingLabel = null; // { shapeId, dimension, segmentIndex } while measureEditWrap is open

function openMeasurementEdit(label) {
  const found = findShapeById(label.shapeId);
  if (!found) return;

  editingLabel = { shapeId: label.shapeId, dimension: label.dimension, segmentIndex: label.segmentIndex };
  state.selection = [label.shapeId];
  updateSelectionPanel();
  redrawOverlay();

  const currentWorld = getShapeDimensionWorld(found.shape, label.dimension, label.segmentIndex);
  measureEditInput.value = formatMeasurementForEdit(currentWorld);
  // The ft value already spells out its own units ("2ft 8in"); showing a
  // unit suffix alongside it would be redundant.
  measureEditUnit.textContent = state.scale.unit === 'ft' ? '' : state.scale.unit;

  const s = worldToScreen(label.x, label.y);
  measureEditWrap.style.display = 'flex';
  // Position after showing so offsetWidth/Height are accurate
  const w = measureEditWrap.offsetWidth || 90;
  const h = measureEditWrap.offsetHeight || 28;
  measureEditWrap.style.left = Math.round(s.x - w / 2) + 'px';
  measureEditWrap.style.top  = Math.round(s.y - h / 2) + 'px';

  measureEditInput.focus();
  measureEditInput.select();
}

function closeMeasurementEdit() {
  // Order matters: null the flag before blurring, so the blur handler's
  // deferred commit sees editingLabel already cleared and no-ops instead of
  // double-processing. Explicit blur matters because hiding a focused
  // input via display:none doesn't reliably move focus away on its own —
  // leaving it focused would swallow the next keyboard shortcut (e.g.
  // Ctrl+Z), since the global handler ignores shortcuts while an input has
  // focus.
  editingLabel = null;
  measureEditWrap.style.display = 'none';
  measureEditInput.blur();
}

function commitMeasurementEdit() {
  if (!editingLabel) return;
  const val = state.scale.unit === 'ft'
    ? parseFeetInches(measureEditInput.value)
    : parseFloat(measureEditInput.value);
  const label = editingLabel;
  closeMeasurementEdit();
  if (!(val > 0)) return;

  const found = findShapeById(label.shapeId);
  if (!found) return;
  const newWorld = realToWorldUnits(val);
  const changed = applyMeasurementEdit(found.shape, label.dimension, label.segmentIndex, newWorld);
  if (changed) {
    saveHistory();
    redrawMain();
    redrawOverlay();
  }
}

measureEditInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); commitMeasurementEdit(); }
  if (e.key === 'Escape') { e.preventDefault(); closeMeasurementEdit(); }
});
measureEditInput.addEventListener('blur', () => {
  // Slight delay so a click that also blurs (e.g. hitting Enter via a
  // virtual keyboard "done" button) still resolves via keydown first.
  setTimeout(() => { if (editingLabel) commitMeasurementEdit(); }, 0);
});

// ── Render ────────────────────────────────────────────────────────────────────
function redrawGrid() {
  const W = VIEW_W;
  const H = VIEW_H;
  gCtx.clearRect(0, 0, W, H);
  if (!state.showGrid) return;

  const step = GRID_SIZE * state.zoom;
  const offX = state.pan.x % step;
  const offY = state.pan.y % step;

  gCtx.strokeStyle = 'rgba(255,255,255,0.05)';
  gCtx.lineWidth   = 1;

  gCtx.beginPath();
  for (let x = offX; x < W; x += step) {
    gCtx.moveTo(x, 0); gCtx.lineTo(x, H);
  }
  for (let y = offY; y < H; y += step) {
    gCtx.moveTo(0, y); gCtx.lineTo(W, y);
  }
  gCtx.stroke();

  // Sub-grid lines at the active snap resolution (half/quarter/eighth cell)
  if (state.snapToGrid && state.snapDivisions > 1) {
    const subStep = step / state.snapDivisions;
    gCtx.strokeStyle = 'rgba(255,255,255,0.025)';
    gCtx.beginPath();
    let i = 0;
    for (let x = offX; x < W; x += subStep, i++) {
      if (i % state.snapDivisions !== 0) { gCtx.moveTo(x, 0); gCtx.lineTo(x, H); }
    }
    i = 0;
    for (let y = offY; y < H; y += subStep, i++) {
      if (i % state.snapDivisions !== 0) { gCtx.moveTo(0, y); gCtx.lineTo(W, y); }
    }
    gCtx.stroke();
  }

  // Major grid every 5 cells
  const majorStep = step * 5;
  const majOffX   = state.pan.x % majorStep;
  const majOffY   = state.pan.y % majorStep;
  gCtx.strokeStyle = 'rgba(255,255,255,0.1)';
  gCtx.beginPath();
  for (let x = majOffX; x < W; x += majorStep) {
    gCtx.moveTo(x, 0); gCtx.lineTo(x, H);
  }
  for (let y = majOffY; y < H; y += majorStep) {
    gCtx.moveTo(0, y); gCtx.lineTo(W, y);
  }
  gCtx.stroke();
}

function redrawMain() {
  const W = VIEW_W;
  const H = VIEW_H;
  mCtx.clearRect(0, 0, W, H);
  mCtx.save();
  mCtx.translate(state.pan.x, state.pan.y);
  mCtx.scale(state.zoom, state.zoom);

  state.measurementLabels = [];
  // Draw the layer tree bottom-to-top (top of the Layers panel = on top).
  // Non-active layers are dimmed to signal they're read-only right now.
  paintLayerTree(state.layers, layer => {
    const dimmed = state.activeLayerId && layer.id !== state.activeLayerId;
    if (dimmed) mCtx.globalAlpha = 0.4;
    for (const shape of layer.shapes) {
      drawShape(mCtx, shape, layer.color, state.zoom);
      drawMeasurements(mCtx, shape, state.zoom, state.measurementLabels);
    }
    if (dimmed) mCtx.globalAlpha = 1;
  });
  mCtx.restore();
}

function redrawOverlay() {
  const W = VIEW_W;
  const H = VIEW_H;
  oCtx.clearRect(0, 0, W, H);

  // Symbol placement preview
  if (state.tool === 'sym' && state.mouseWorld && state.currentSymbol) {
    const sym = SYMBOLS.find(s => s.key === state.currentSymbol);
    if (sym) {
      oCtx.save();
      oCtx.translate(state.pan.x, state.pan.y);
      oCtx.scale(state.zoom, state.zoom);
      oCtx.translate(state.mouseWorld.x, state.mouseWorld.y);
      if (state.symbolRotation) oCtx.rotate(state.symbolRotation * Math.PI / 180);
      oCtx.strokeStyle  = state.props.stroke;
      oCtx.lineWidth    = state.props.strokeWidth / state.zoom;
      oCtx.fillStyle    = state.props.stroke;
      oCtx.globalAlpha  = 0.5;
      oCtx.setLineDash([]);
      oCtx.textAlign    = 'center';
      oCtx.textBaseline = 'middle';
      sym.draw(oCtx, state.props.symbolSize / 2);
      oCtx.restore();
    }
  }

  // Snap-to-shape indicator
  if (state.snapIndicator) {
    oCtx.save();
    oCtx.translate(state.pan.x, state.pan.y);
    oCtx.scale(state.zoom, state.zoom);
    const { x, y } = state.snapIndicator;
    const r = 6 / state.zoom;
    oCtx.strokeStyle = '#6affb0';
    oCtx.lineWidth   = 1.5 / state.zoom;
    oCtx.setLineDash([]);
    oCtx.beginPath(); oCtx.arc(x, y, r, 0, Math.PI * 2); oCtx.stroke();
    oCtx.beginPath();
    oCtx.moveTo(x - r * 1.6, y); oCtx.lineTo(x + r * 1.6, y);
    oCtx.moveTo(x, y - r * 1.6); oCtx.lineTo(x, y + r * 1.6);
    oCtx.stroke();
    oCtx.restore();
  }

  // Rubber-band selection box
  if (drag.tool === 'rubberband' && drag.rubberStart && drag.rubberEnd) {
    const rx = Math.min(drag.rubberStart.x, drag.rubberEnd.x);
    const ry = Math.min(drag.rubberStart.y, drag.rubberEnd.y);
    const rw = Math.abs(drag.rubberEnd.x - drag.rubberStart.x);
    const rh = Math.abs(drag.rubberEnd.y - drag.rubberStart.y);
    oCtx.save();
    oCtx.translate(state.pan.x, state.pan.y);
    oCtx.scale(state.zoom, state.zoom);
    oCtx.fillStyle = 'rgba(124,106,255,0.12)';
    oCtx.fillRect(rx, ry, rw, rh);
    oCtx.strokeStyle = '#7c6aff';
    oCtx.lineWidth   = 1 / state.zoom;
    oCtx.setLineDash([4 / state.zoom, 3 / state.zoom]);
    oCtx.strokeRect(rx, ry, rw, rh);
    oCtx.restore();
  }

  if (!state.selection.length && !drag.shape && !drag.polyPoints.length && drag.tool !== 'rubberband') return;

  oCtx.save();
  oCtx.translate(state.pan.x, state.pan.y);
  oCtx.scale(state.zoom, state.zoom);

  // Preview shape while drawing
  if (drag.shape) {
    drawShape(oCtx, drag.shape, '#7c6aff', state.zoom);
  }

  // Polygon in-progress
  if (drag.polyPoints.length) {
    oCtx.save();
    oCtx.strokeStyle = '#7c6aff';
    oCtx.lineWidth   = state.props.strokeWidth / state.zoom;
    oCtx.setLineDash([6 / state.zoom, 3 / state.zoom]);
    oCtx.beginPath();
    oCtx.moveTo(drag.polyPoints[0].x, drag.polyPoints[0].y);
    for (let i = 1; i < drag.polyPoints.length; i++) {
      oCtx.lineTo(drag.polyPoints[i].x, drag.polyPoints[i].y);
    }
    oCtx.stroke();

    // Draw dots
    for (const p of drag.polyPoints) {
      oCtx.beginPath();
      oCtx.arc(p.x, p.y, 4 / state.zoom, 0, Math.PI * 2);
      oCtx.fillStyle = '#7c6aff';
      oCtx.fill();
    }
    oCtx.restore();
  }

  // Selection highlights (skip shapes on a currently-hidden layer — the
  // selection itself is preserved so it's there if you re-show the layer,
  // but there's no visible shape to draw a box around in the meantime)
  for (const id of state.selection) {
    const found = findShapeById(id);
    if (!found || !found.layer.visible) continue;
    const b = shapeBounds(found.shape);
    oCtx.save();
    oCtx.strokeStyle = '#7c6aff';
    oCtx.lineWidth   = 1.5 / state.zoom;
    oCtx.setLineDash([4 / state.zoom, 3 / state.zoom]);
    oCtx.strokeRect(b.x, b.y, b.w, b.h);
    oCtx.fillStyle = '#7c6aff';
    oCtx.setLineDash([]);
    if (state.selection.length === 1) {
      // Real, draggable handles (endpoints/corners/vertices) for the
      // single selected shape — these are what hitTestHandles() checks.
      // Rotate handles render as a circle-on-a-stalk (standard convention)
      // instead of the plain square used for resize/move handles.
      for (const h of getShapeHandles(found.shape)) {
        if (h.isRotate) {
          oCtx.beginPath();
          oCtx.moveTo(found.shape.x, found.shape.y);
          oCtx.lineTo(h.x, h.y);
          oCtx.stroke();
          oCtx.beginPath();
          oCtx.arc(h.x, h.y, HANDLE_R / state.zoom, 0, Math.PI * 2);
          oCtx.fill();
        } else {
          oCtx.fillRect(h.x - HANDLE_R/state.zoom, h.y - HANDLE_R/state.zoom, (HANDLE_R*2)/state.zoom, (HANDLE_R*2)/state.zoom);
        }
      }
    } else {
      // Multi-select: decorative bbox corners only (resize is single-shape only)
      [[b.x, b.y],[b.x+b.w, b.y],[b.x, b.y+b.h],[b.x+b.w, b.y+b.h]].forEach(([hx,hy]) => {
        oCtx.fillRect(hx - HANDLE_R/state.zoom, hy - HANDLE_R/state.zoom, (HANDLE_R*2)/state.zoom, (HANDLE_R*2)/state.zoom);
      });
    }
    oCtx.restore();
  }

  oCtx.restore();
}

function redrawAll() {
  redrawGrid();
  redrawMain();
  redrawOverlay();
  zoomIndicator.textContent = Math.round(state.zoom * 100) + '%';
}

// ── Tool cursor ───────────────────────────────────────────────────────────────
const cursorMap = {
  select: 'default', pan: 'grab', line: 'crosshair',
  rect: 'crosshair', circle: 'crosshair', polygon: 'crosshair',
  text: 'text', eraser: 'cell', sym: 'crosshair', stairs: 'crosshair',
  wall: 'crosshair',
};

function setCursor(c) {
  overlayCanvas.style.cursor = c || cursorMap[state.tool] || 'default';
}

// ── Tool switching ─────────────────────────────────────────────────────────────
function setTool(tool) {
  commitPolygon();
  if (tool !== 'sym') state.mouseWorld = null;
  state.tool = tool;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  setCursor();
  textPropRow.style.display   = tool === 'text' ? 'flex' : 'none';
  stairsPropRow.style.display = tool === 'stairs' ? 'flex' : 'none';
  wallPropRow.style.display   = tool === 'wall' ? 'flex' : 'none';
  if (tool === 'wall') syncWallThicknessUI();
  if (tool !== 'sym') redrawOverlay();
}

// ── Shape creation helpers ────────────────────────────────────────────────────
function currentShapeProps() {
  return {
    stroke: state.props.stroke,
    strokeWidth: state.props.strokeWidth,
    fill: state.props.fill,
    fillEnabled: state.props.fillEnabled,
    dash: state.props.dash,
    fontSize: state.props.fontSize,
  };
}

function startShape(wx, wy) {
  const base = { id: uid(), ...currentShapeProps() };
  switch (state.tool) {
    case 'line':   return { ...base, type: 'line',   x1: wx, y1: wy, x2: wx, y2: wy };
    case 'rect':   return { ...base, type: 'rect',   x1: wx, y1: wy, x2: wx, y2: wy };
    case 'circle': return { ...base, type: 'circle', x1: wx, y1: wy, x2: wx, y2: wy };
    case 'stairs': return { ...base, type: 'stairs', x1: wx, y1: wy, x2: wx, y2: wy, direction: state.props.stairsDirection };
    default:       return null;
  }
}

function updateShape(shape, wx, wy, e) {
  if (!shape) return;
  if (e && e.shiftKey && (shape.type === 'line' || shape.type === 'rect' || shape.type === 'circle')) {
    const dx = wx - shape.x1;
    const dy = wy - shape.y1;
    if (shape.type === 'line') {
      const angle = Math.atan2(dy, dx);
      const snap45 = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.sqrt(dx*dx + dy*dy);
      shape.x2 = shape.x1 + Math.cos(snap45) * len;
      shape.y2 = shape.y1 + Math.sin(snap45) * len;
      return;
    }
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    shape.x2 = shape.x1 + Math.sign(dx) * side;
    shape.y2 = shape.y1 + Math.sign(dy) * side;
    return;
  }
  shape.x2 = wx;
  shape.y2 = wy;
}

function commitPolygon(closed = false) {
  if (!drag.polyPoints.length) return;
  const layer = activeLayer();
  if (!layer || isLayerEffectivelyLocked(layer.id)) { drag.polyPoints = []; redrawOverlay(); return; }
  const isWall = state.tool === 'wall';
  const shape = {
    id: uid(), ...currentShapeProps(),
    type: isWall ? 'wall' : 'polygon',
    points: [...drag.polyPoints],
    closed,
  };
  if (isWall) shape.thickness = state.props.wallThickness;
  layer.shapes.push(shape);
  drag.polyPoints = [];
  saveHistory();
  redrawMain();
  redrawOverlay();
}

// ── Mouse events ──────────────────────────────────────────────────────────────
overlayCanvas.addEventListener('mousedown', onPointerDown);
overlayCanvas.addEventListener('mousemove', onPointerMove);
overlayCanvas.addEventListener('mouseup',   onPointerUp);
overlayCanvas.addEventListener('dblclick',  onDblClick);
overlayCanvas.addEventListener('contextmenu', e => { e.preventDefault(); commitPolygon(true); });
overlayCanvas.addEventListener('wheel',     onWheel, { passive: false });

// ── Touch support (phones / tablets) ────────────────────────────────────────
// Single-finger drag maps to the current tool. Two-finger drag pans+pinch-zooms.
const touchState = { pinching: false, lastDist: 0, lastMid: null };

function touchToPointerEvent(t, extra) {
  return { clientX: t.clientX, clientY: t.clientY, button: 0, shiftKey: false, ...extra };
}

function touchDist(t1, t2) {
  return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
}

function touchMid(t1, t2) {
  return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
}

overlayCanvas.addEventListener('touchstart', e => {
  e.preventDefault();
  if (e.touches.length === 2) {
    touchState.pinching = true;
    drag.active = false; drag.tool = null; drag.shape = null; // cancel any single-finger draw
    touchState.lastDist = touchDist(e.touches[0], e.touches[1]);
    touchState.lastMid  = touchMid(e.touches[0], e.touches[1]);
    return;
  }
  if (e.touches.length === 1) {
    onPointerDown(touchToPointerEvent(e.touches[0]));
  }
}, { passive: false });

overlayCanvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (touchState.pinching && e.touches.length === 2) {
    const dist = touchDist(e.touches[0], e.touches[1]);
    const mid  = touchMid(e.touches[0], e.touches[1]);
    const r    = overlayCanvas.getBoundingClientRect();
    const sx   = mid.x - r.left, sy = mid.y - r.top;

    const factor  = dist / touchState.lastDist;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.zoom * factor));
    state.pan.x = sx - (sx - state.pan.x) * (newZoom / state.zoom) + (mid.x - touchState.lastMid.x);
    state.pan.y = sy - (sy - state.pan.y) * (newZoom / state.zoom) + (mid.y - touchState.lastMid.y);
    state.zoom  = newZoom;

    touchState.lastDist = dist;
    touchState.lastMid  = mid;
    redrawAll();
    return;
  }
  if (e.touches.length === 1 && !touchState.pinching) {
    onPointerMove(touchToPointerEvent(e.touches[0]));
  }
}, { passive: false });

overlayCanvas.addEventListener('touchend', e => {
  e.preventDefault();
  if (touchState.pinching) {
    if (e.touches.length < 2) touchState.pinching = false;
    return;
  }
  const t = e.changedTouches[0];
  if (t) onPointerUp(touchToPointerEvent(t));
}, { passive: false });

function onPointerDown(e) {
  if (e.button === 1) { drag.active = true; drag.tool = 'pan_mid'; const p = getCanvasPos(e); drag.lastX = p.sx; drag.lastY = p.sy; setCursor('grabbing'); return; }
  const pos = getCanvasPos(e, new Set(state.selection));
  coordsIndicator.textContent = `${Math.round(pos.rawX)}, ${Math.round(pos.rawY)}`;

  if (state.tool === 'pan') {
    drag.active = true; drag.tool = 'pan';
    drag.lastX = pos.sx; drag.lastY = pos.sy;
    setCursor('grabbing');
    return;
  }

  if (state.tool === 'select') {
    // A click on a measurement label opens an inline editor instead of
    // selecting/moving — use the raw (unsnapped) point since labels aren't
    // grid-aligned.
    const labelHit = hitTestMeasurementLabel(pos.rawX, pos.rawY);
    if (labelHit) {
      // Prevent the browser's default mousedown focus-handling, which would
      // otherwise immediately blur the input we're about to focus below
      // (canvas isn't normally focusable, so default handling steals focus
      // right back and the blur handler closes the editor before it opens).
      if (typeof e.preventDefault === 'function') e.preventDefault();
      openMeasurementEdit(labelHit);
      return;
    }

    // If exactly one shape is selected, a click on one of its handles
    // resizes instead of re-selecting/moving.
    if (state.selection.length === 1) {
      const found = findShapeById(state.selection[0]);
      if (found && found.layer.visible && !isLayerEffectivelyLocked(found.layer.id)) {
        const handle = hitTestHandles(found.shape, pos.wx, pos.wy);
        if (handle) {
          drag.active = true;
          drag.tool = 'resize';
          drag.resizeApply = handle.apply;
          setCursor('grabbing');
          return;
        }
      }
    }

    // Hit test visible, unlocked layers, topmost layer/shape first
    let hit = null;
    forEachLayerTopFirst(state.layers, layer => {
      if (isLayerEffectivelyLocked(layer.id)) return false;
      for (let i = layer.shapes.length - 1; i >= 0; i--) {
        if (hitTest(layer.shapes[i], pos.wx, pos.wy)) { hit = layer.shapes[i]; return true; }
      }
      return false;
    });
    if (hit) {
      if (e.shiftKey) {
        if (!state.selection.includes(hit.id)) state.selection.push(hit.id);
        else state.selection = state.selection.filter(id => id !== hit.id);
      } else if (!state.selection.includes(hit.id)) {
        // Clicking a shape already part of a multi-selection keeps the
        // whole group intact so it can be drag-moved together; only
        // clicking an unselected shape (or empty space) narrows it down.
        state.selection = [hit.id];
      }
      updateSelectionPanel();
      redrawOverlay();

      // Prepare to move selection
      if (state.selection.length) {
        drag.active = true; drag.tool = 'move';
        drag.lastX = pos.wx; drag.lastY = pos.wy;
        setCursor('grabbing');
      }
      return;
    }

    // Clicked empty space: start a rubber-band selection box instead of
    // just clearing the selection outright.
    if (!e.shiftKey) { state.selection = []; updateSelectionPanel(); }
    drag.active = true;
    drag.tool = 'rubberband';
    drag.rubberAdditive = e.shiftKey;
    drag.rubberStart = { x: pos.wx, y: pos.wy };
    drag.rubberEnd   = { x: pos.wx, y: pos.wy };
    redrawOverlay();
    return;
  }

  if (state.tool === 'eraser') {
    eraseAt(pos.wx, pos.wy);
    drag.active = true; drag.tool = 'eraser';
    return;
  }

  if (state.tool === 'text') {
    // Same fix as the measurement-label editor below: canvas isn't
    // focusable, so mousedown's default action steals focus right back
    // from the textarea openTextInput() just focused, which then blurs
    // it, and since it's empty at that point the blur handler hides it
    // again — text placement silently no-ops without this.
    if (typeof e.preventDefault === 'function') e.preventDefault();
    openTextInput(pos);
    return;
  }

  if (state.tool === 'sym') {
    const layer = activeLayer();
    if (!layer || !state.currentSymbol || isLayerEffectivelyLocked(layer.id)) return;
    layer.shapes.push({
      id: uid(),
      type: 'symbol',
      symbolKey: state.currentSymbol,
      x: pos.wx, y: pos.wy,
      size: state.props.symbolSize,
      rotation: state.symbolRotation,
      stroke: state.props.stroke,
      strokeWidth: state.props.strokeWidth,
    });
    saveHistory();
    redrawMain();
    return;
  }

  if (state.tool === 'polygon' || state.tool === 'wall') {
    drag.polyPoints.push({ x: pos.wx, y: pos.wy });
    redrawOverlay();
    return;
  }

  // Line, rect, circle, stairs
  const layer = activeLayer();
  if (!layer || isLayerEffectivelyLocked(layer.id)) return;
  drag.active  = true;
  drag.tool    = state.tool;
  drag.startX  = pos.wx; drag.startY = pos.wy;
  drag.shape   = startShape(pos.wx, pos.wy);
}

function onPointerMove(e) {
  const pos = getCanvasPos(e, new Set(state.selection));
  coordsIndicator.textContent = `${Math.round(pos.rawX)}, ${Math.round(pos.rawY)}`;

  if (drag.tool === 'pan' || drag.tool === 'pan_mid') {
    state.pan.x += pos.sx - drag.lastX;
    state.pan.y += pos.sy - drag.lastY;
    drag.lastX = pos.sx; drag.lastY = pos.sy;
    redrawAll();
    return;
  }

  if (drag.tool === 'resize' && drag.active) {
    if (drag.resizeApply) drag.resizeApply(pos.wx, pos.wy, e.shiftKey);
    redrawMain(); redrawOverlay();
    return;
  }

  if (drag.tool === 'rubberband' && drag.active) {
    drag.rubberEnd = { x: pos.wx, y: pos.wy };
    redrawOverlay();
    return;
  }

  if (drag.tool === 'move' && drag.active) {
    const dx = pos.wx - drag.lastX;
    const dy = pos.wy - drag.lastY;
    drag.lastX = pos.wx; drag.lastY = pos.wy;
    for (const id of state.selection) {
      const found = findShapeById(id);
      if (!found) continue;
      const s = found.shape;
      if (s.x1 !== undefined) { s.x1 += dx; s.y1 += dy; }
      if (s.x2 !== undefined) { s.x2 += dx; s.y2 += dy; }
      if (s.points) s.points = s.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
      if (s.type === 'text' || s.type === 'symbol') { s.x += dx; s.y += dy; }
    }
    redrawMain(); redrawOverlay();
    return;
  }

  if (drag.tool === 'eraser' && drag.active) {
    eraseAt(pos.wx, pos.wy);
    return;
  }

  if (drag.active && drag.shape) {
    updateShape(drag.shape, pos.wx, pos.wy, e);
    redrawOverlay();
    return;
  }

  // Symbol preview tracking
  if (state.tool === 'sym') {
    state.mouseWorld = { x: pos.wx, y: pos.wy };
    redrawOverlay();
    return;
  }

  // Polygon/wall cursor line
  if ((state.tool === 'polygon' || state.tool === 'wall') && drag.polyPoints.length) {
    redrawOverlay();
    oCtx.save();
    oCtx.translate(state.pan.x, state.pan.y);
    oCtx.scale(state.zoom, state.zoom);
    oCtx.strokeStyle = 'rgba(124,106,255,0.5)';
    oCtx.lineWidth   = state.props.strokeWidth / state.zoom;
    oCtx.setLineDash([4 / state.zoom, 4 / state.zoom]);
    oCtx.beginPath();
    const last = drag.polyPoints[drag.polyPoints.length - 1];
    oCtx.moveTo(last.x, last.y);
    oCtx.lineTo(pos.wx, pos.wy);
    oCtx.stroke();
    oCtx.restore();
  }
}

function onPointerUp(e) {
  if (drag.tool === 'pan_mid') { drag.active = false; drag.tool = null; setCursor(); return; }
  if (drag.tool === 'pan') { drag.active = false; drag.tool = null; setCursor(); return; }

  if (drag.tool === 'move') {
    drag.active = false; drag.tool = null; setCursor();
    saveHistory();
    return;
  }

  if (drag.tool === 'resize') {
    drag.active = false; drag.tool = null; drag.resizeApply = null; setCursor();
    saveHistory();
    return;
  }

  if (drag.tool === 'rubberband') {
    const rx1 = Math.min(drag.rubberStart.x, drag.rubberEnd.x);
    const ry1 = Math.min(drag.rubberStart.y, drag.rubberEnd.y);
    const rx2 = Math.max(drag.rubberStart.x, drag.rubberEnd.x);
    const ry2 = Math.max(drag.rubberStart.y, drag.rubberEnd.y);
    const caught = [];
    forEachVisibleLayer(state.layers, layer => {
      if (isLayerEffectivelyLocked(layer.id)) return;
      for (const s of layer.shapes) {
        const b = shapeBounds(s);
        const intersects = b.x < rx2 && b.x + b.w > rx1 && b.y < ry2 && b.y + b.h > ry1;
        if (intersects) caught.push(s.id);
      }
    });
    if (drag.rubberAdditive) {
      for (const id of caught) if (!state.selection.includes(id)) state.selection.push(id);
    } else {
      state.selection = caught;
    }
    drag.active = false; drag.tool = null;
    drag.rubberStart = null; drag.rubberEnd = null;
    setCursor();
    updateSelectionPanel();
    redrawOverlay();
    return;
  }

  if (drag.tool === 'eraser') { drag.active = false; drag.tool = null; return; }

  if (drag.active && drag.shape) {
    const layer = activeLayer();
    if (layer) {
      // Don't commit zero-size shapes
      const dx = Math.abs((drag.shape.x2 || 0) - (drag.shape.x1 || 0));
      const dy = Math.abs((drag.shape.y2 || 0) - (drag.shape.y1 || 0));
      if (dx > 2 || dy > 2) {
        layer.shapes.push({ ...drag.shape });
        saveHistory();
      }
    }
    drag.shape  = null;
    drag.active = false;
    drag.tool   = null;
    redrawMain();
    redrawOverlay();
  }
}

function onDblClick(e) {
  if (state.tool === 'polygon' || state.tool === 'wall') {
    commitPolygon(false);
  }
}

function onWheel(e) {
  e.preventDefault();
  const pos = getCanvasPos(e);
  const factor = e.deltaY < 0 ? 1.1 : 0.9;
  const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.zoom * factor));
  // Zoom toward cursor
  state.pan.x = pos.sx - (pos.sx - state.pan.x) * (newZoom / state.zoom);
  state.pan.y = pos.sy - (pos.sy - state.pan.y) * (newZoom / state.zoom);
  state.zoom  = newZoom;
  redrawAll();
}

// ── Eraser ────────────────────────────────────────────────────────────────────
function eraseAt(wx, wy) {
  let changed = false;
  forEachVisibleLayer(state.layers, layer => {
    if (isLayerEffectivelyLocked(layer.id)) return;
    const before = layer.shapes.length;
    layer.shapes = layer.shapes.filter(s => !hitTest(s, wx, wy));
    if (layer.shapes.length !== before) changed = true;
  });
  if (changed) { saveHistory(); redrawMain(); }
}

// ── Text input ────────────────────────────────────────────────────────────────
function openTextInput(pos) {
  textPending = { wx: pos.wx, wy: pos.wy };
  const s = worldToScreen(pos.wx, pos.wy);
  textInput.style.display = 'block';
  textInput.style.left    = s.x + 'px';
  textInput.style.top     = (s.y - 24) + 'px';
  textInput.value         = '';
  textInput.focus();
}

textInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    commitText();
  }
  if (e.key === 'Escape') {
    textPending = null;
    textInput.style.display = 'none';
    textInput.blur();
  }
});

textInput.addEventListener('blur', () => {
  if (textInput.value.trim()) commitText();
  else { textPending = null; textInput.style.display = 'none'; }
});

function commitText() {
  // Capture + clear textPending before hiding/blurring: blur() dispatches
  // synchronously, which can re-enter this function via the blur listener
  // above — nulling textPending first makes that re-entrant call a no-op
  // instead of double-committing. Hiding via display:none alone doesn't
  // reliably move focus away, so without an explicit blur() the next
  // keyboard shortcut (Ctrl+Z, tool hotkeys) would get swallowed by the
  // global handler's "ignore shortcuts while an input is focused" guard.
  const val = textInput.value.trim();
  const pending = textPending;
  textPending = null;
  textInput.style.display = 'none';
  textInput.blur();
  if (!val || !pending) return;
  const layer = activeLayer();
  if (!layer || isLayerEffectivelyLocked(layer.id)) return;
  layer.shapes.push({
    id: uid(), ...currentShapeProps(),
    type: 'text', text: val,
    x: pending.wx, y: pending.wy,
    fontSize: state.props.fontSize,
  });
  saveHistory();
  redrawMain();
}

// ── Keyboard shortcuts ─────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z') { e.preventDefault(); undo(); return; }
    if (e.key === 'y' || (e.shiftKey && e.key === 'z')) { e.preventDefault(); redo(); return; }
    if (e.key === 's') { e.preventDefault(); saveFile(); return; }
    return;
  }

  // R rotates symbol when sym tool active, otherwise switches to rect
  if (e.key.toLowerCase() === 'r' && state.tool === 'sym') {
    state.symbolRotation = (state.symbolRotation + 90) % 360;
    document.getElementById('symRotLabel').textContent = state.symbolRotation + '°';
    redrawOverlay();
    return;
  }

  // R also rotates an already-placed, selected symbol by 90deg (for finer
  // control, drag its rotate handle instead) — not every door/window sits
  // on a horizontal wall.
  if (e.key.toLowerCase() === 'r' && state.tool === 'select' && state.selection.length === 1) {
    const found = findShapeById(state.selection[0]);
    if (found && found.shape.type === 'symbol' && found.layer.visible && !isLayerEffectivelyLocked(found.layer.id)) {
      found.shape.rotation = ((found.shape.rotation || 0) + 90) % 360;
      saveHistory();
      redrawMain();
      redrawOverlay();
      return;
    }
  }

  const map = { v:'select', h:'pan', l:'line', r:'rect', p:'polygon', c:'circle', t:'text', e:'eraser', m:'sym', s:'stairs', w:'wall' };
  if (map[e.key.toLowerCase()]) { setTool(map[e.key.toLowerCase()]); return; }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    deleteSelected();
    return;
  }
  if (e.key === 'Escape') {
    if (drag.polyPoints.length) { drag.polyPoints = []; redrawOverlay(); return; }
    state.selection = []; updateSelectionPanel(); redrawOverlay();
  }
});

// ── Selection panel ───────────────────────────────────────────────────────────
function updateSelectionPanel() {
  selectionProps.style.display = state.selection.length ? 'block' : 'none';
}

function deleteSelected() {
  if (!state.selection.length) return;
  for (const id of state.selection) {
    forEachVisibleLayerIncludingHidden(state.layers, layer => {
      layer.shapes = layer.shapes.filter(s => s.id !== id);
    });
  }
  state.selection = [];
  saveHistory();
  updateSelectionPanel();
  redrawMain();
  redrawOverlay();
}

document.getElementById('deleteSelBtn').addEventListener('click', deleteSelected);

moveToLayerSel.addEventListener('change', () => {
  const targetId = moveToLayerSel.value;
  const target   = findLayerById(state.layers, targetId);
  if (!target) return;
  for (const id of state.selection) {
    const found = findShapeById(id);
    if (!found || found.layer.id === targetId) continue;
    found.layer.shapes = found.layer.shapes.filter(s => s.id !== id);
    target.shapes.push(found.shape);
  }
  // A shape moved off the active layer is no longer editable — drop it
  // from the selection so its (now inert) handles don't linger on screen.
  state.selection = state.selection.filter(id => !isLayerEffectivelyLocked(findShapeById(id)?.layer?.id));
  saveHistory();
  updateSelectionPanel();
  redrawMain();
  redrawOverlay();
});

function updateMoveToLayer() {
  moveToLayerSel.innerHTML = '';
  // Built with createElement/textContent rather than innerHTML — layer
  // names can come from a loaded .json file, not just typed input, so they
  // have to be treated as untrusted text rather than interpolated as HTML.
  (function walk(nodes, depth) {
    for (const node of nodes) {
      const indent = '  '.repeat(depth) + (depth ? '↳ ' : '');
      const opt = document.createElement('option');
      opt.value = node.id;
      opt.textContent = indent + node.name;
      moveToLayerSel.appendChild(opt);
      if (node.children && node.children.length) walk(node.children, depth + 1);
    }
  })(state.layers, 0);
}

// ── Properties panel ──────────────────────────────────────────────────────────
function bindProp(id, key, transform) {
  const el = document.getElementById(id);
  el.addEventListener('input', () => {
    const value = transform ? transform(el.value) : el.value;
    // A numeric field mid-edit (e.g. cleared to retype) fires 'input' with
    // '' -> NaN; ignore that rather than writing NaN onto every selected
    // shape (it survives a save/reload as null, silently zeroing a stroke).
    if (transform && !Number.isFinite(value)) return;
    state.props[key] = value;
    // Update selected shapes
    for (const sid of state.selection) {
      const found = findShapeById(sid);
      if (found) found.shape[key] = state.props[key];
    }
    if (state.selection.length) { saveHistory(); redrawMain(); }
  });
}

bindProp('propStroke',      'stroke');
bindProp('propStrokeWidth', 'strokeWidth', parseFloat);
bindProp('propFill',        'fill');
bindProp('propDash',        'dash');
bindProp('propFontSize',    'fontSize', parseInt);

document.getElementById('propFillEnabled').addEventListener('change', e => {
  state.props.fillEnabled = e.target.checked;
  for (const sid of state.selection) {
    const found = findShapeById(sid);
    if (found) found.shape.fillEnabled = state.props.fillEnabled;
  }
  if (state.selection.length) { saveHistory(); redrawMain(); }
});

document.getElementById('stairsDirBtn').addEventListener('click', function () {
  state.props.stairsDirection = state.props.stairsDirection === 'up' ? 'down' : 'up';
  document.getElementById('stairsDirLabel').textContent = state.props.stairsDirection === 'up' ? 'UP' : 'DN';
  let changed = false;
  for (const sid of state.selection) {
    const found = findShapeById(sid);
    if (found && found.shape.type === 'stairs') { found.shape.direction = state.props.stairsDirection; changed = true; }
  }
  if (changed) { saveHistory(); redrawMain(); }
});

// ── Toolbar buttons ───────────────────────────────────────────────────────────
document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => setTool(btn.dataset.tool));
});

document.getElementById('undoBtn').addEventListener('click', undo);
document.getElementById('redoBtn').addEventListener('click', redo);

document.getElementById('gridToggle').addEventListener('click', function () {
  state.showGrid = !state.showGrid;
  this.classList.toggle('active', state.showGrid);
  redrawGrid();
});

document.getElementById('snapToggle').addEventListener('click', function () {
  state.snapToGrid = !state.snapToGrid;
  this.classList.toggle('active', state.snapToGrid);
});

document.getElementById('snapShapeToggle').addEventListener('click', function () {
  state.snapToShapes = !state.snapToShapes;
  this.classList.toggle('active', state.snapToShapes);
  if (!state.snapToShapes) { state.snapIndicator = null; redrawOverlay(); }
});

// ── Save / Load / Export ──────────────────────────────────────────────────────
document.getElementById('saveBtn').addEventListener('click', saveFile);
document.getElementById('loadBtn').addEventListener('click', () => document.getElementById('loadInput').click());
document.getElementById('loadInput').addEventListener('change', loadFile);
document.getElementById('exportBtn').addEventListener('click', exportPNG);

function saveFile() {
  const data = JSON.stringify({ layers: state.layers, scale: state.scale, snapDivisions: state.snapDivisions }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  triggerDownload(blob, 'floorplan.json', {
    title: 'Export JSON',
    hint: 'If the download didn’t start automatically, click Download File below, or copy the JSON to save it yourself.',
    body: 'text',
    text: data,
  });
}

// Validates and backfills a parsed layer tree from a loaded .json file.
// Returns null if the structure is unrecoverable. Missing-but-defaultable
// fields (locked/expanded/etc., absent in older saves) are backfilled
// rather than rejected, so older exports still load.
function normalizeLoadedLayers(nodes, seen = new Set()) {
  if (!Array.isArray(nodes)) return null;
  const out = [];
  for (const raw of nodes) {
    if (!raw || typeof raw !== 'object') return null;
    let id = typeof raw.id === 'string' && raw.id && !seen.has(raw.id) ? raw.id : uid();
    seen.add(id);
    const children = raw.children ? normalizeLoadedLayers(raw.children, seen) : [];
    if (children === null) return null;
    out.push({
      id,
      name: typeof raw.name === 'string' && raw.name ? raw.name : 'Layer',
      visible: raw.visible !== false,
      color: typeof raw.color === 'string' ? raw.color : LAYER_COLORS[0],
      shapes: Array.isArray(raw.shapes) ? raw.shapes : [],
      children,
      expanded: raw.expanded !== false,
      locked: !!raw.locked,
    });
  }
  return out;
}

function loadFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    // Snapshot so a failure partway through (bad structure, or a render
    // that throws on malformed shape data) can't leave state pointing at
    // a half-applied file — restore this instead of leaving it wherever
    // the exception happened to land.
    const backup = { layers: state.layers, activeLayerId: state.activeLayerId, selection: state.selection };
    try {
      const data   = JSON.parse(evt.target.result);
      const layers = normalizeLoadedLayers(data.layers);
      if (!layers || !layers.length) throw new Error('no valid layers');

      state.layers        = layers;
      state.activeLayerId = layers[0].id;
      state.selection     = [];
      if (data.scale && typeof data.scale === 'object') {
        Object.assign(state.scale, data.scale);
      }
      if (data.snapDivisions) {
        state.snapDivisions = data.snapDivisions;
      }
      syncScaleUI();
      saveHistory();
      renderLayers();
      updateMoveToLayer();
      redrawAll();
    } catch {
      state.layers        = backup.layers;
      state.activeLayerId = backup.activeLayerId;
      state.selection     = backup.selection;
      renderLayers();
      updateMoveToLayer();
      redrawAll();
      alertModal('That file doesn\'t look like a valid floorplan JSON file.', 'Invalid File');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function exportPNG() {
  const W   = VIEW_W;
  const H   = VIEW_H;
  const dpr = getDPR();
  const tmp = document.createElement('canvas');
  tmp.width  = W * dpr; tmp.height = H * dpr;
  const ctx  = tmp.getContext('2d');
  ctx.scale(dpr, dpr); // match on-screen crispness, same reasoning as resizeCanvases()
  ctx.fillStyle = '#141422';
  ctx.fillRect(0, 0, W, H);

  // Draw grid
  if (state.showGrid) {
    const step  = GRID_SIZE * state.zoom;
    const offX  = state.pan.x % step;
    const offY  = state.pan.y % step;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    for (let x = offX; x < W; x += step) { ctx.moveTo(x,0); ctx.lineTo(x,H); }
    for (let y = offY; y < H; y += step) { ctx.moveTo(0,y); ctx.lineTo(W,y); }
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(state.pan.x, state.pan.y);
  ctx.scale(state.zoom, state.zoom);
  paintLayerTree(state.layers, layer => {
    for (const shape of layer.shapes) {
      drawShape(ctx, shape, layer.color, state.zoom);
      drawMeasurements(ctx, shape, state.zoom);
    }
  });
  ctx.restore();

  tmp.toBlob(blob => {
    triggerDownload(blob, 'floorplan.png', {
      title: 'Export PNG',
      hint: 'If the download didn’t start automatically, click Download File below, or right-click the image and choose “Save image as…”.',
      body: 'image',
    });
  });
}

// Triggers a normal browser download, and — only when this page is running
// inside an iframe (e.g. a preview/embed) — also opens a fallback modal.
// A sandboxed iframe without allow-downloads can block both a script-driven
// click() *and* a genuine direct click on a download link with no error at
// all, so there's no reliable way to detect success; showing the fallback
// whenever we're embedded is the only way to guarantee the data is reachable.
function triggerDownload(blob, filename, fallback) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();

  let embedded = true;
  try { embedded = window.self !== window.top; } catch { embedded = true; }

  if (!embedded) {
    URL.revokeObjectURL(url);
    return;
  }
  showExportModal({ ...fallback, url, filename });
}

// ── Modal (prompt / confirm / alert) ────────────────────────────────────────
// Native confirm()/alert()/prompt() are unreliable in this hosting context:
// a published Artifact runs in a sandboxed iframe without allow-modals,
// where confirm() just returns false immediately with no dialog shown and
// no error — code guarded by `if (!confirm(...)) return;` silently no-ops
// forever. This is a real in-page modal instead, Promise-based so call
// sites read almost like the native versions did.
const modalOkBtn     = document.getElementById('modal-ok');
const modalCancelBtn = document.getElementById('modal-cancel');
const modalMessageEl = document.getElementById('modal-message');
const modalTitleEl   = document.getElementById('modal-title');

function showModal(opts) {
  const {
    title = '', message = '', defaultVal = '',
    showInput = true, okLabel = 'OK', cancelLabel = 'Cancel', showCancel = true,
  } = opts;

  return new Promise(resolve => {
    modalTitleEl.textContent = title;
    modalMessageEl.textContent = message;
    modalMessageEl.style.display = message ? 'block' : 'none';

    modalInput.style.display = showInput ? 'block' : 'none';
    modalInput.value = defaultVal;

    modalOkBtn.textContent = okLabel;
    modalCancelBtn.textContent = cancelLabel;
    modalCancelBtn.style.display = showCancel ? 'inline-block' : 'none';

    modalOverlay.style.display = 'flex';
    if (showInput) { modalInput.focus(); modalInput.select(); }
    else modalOkBtn.focus();

    const finish = result => {
      modalOverlay.style.display = 'none';
      document.removeEventListener('keydown', keydown);
      modalOkBtn.onclick = null;
      modalCancelBtn.onclick = null;
      resolve(result);
    };
    const ok     = () => finish(showInput ? modalInput.value.trim() : true);
    const cancel = () => finish(showInput ? null : false);
    const keydown = e => {
      if (e.key === 'Enter')  { e.preventDefault(); ok(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    };
    modalOkBtn.onclick     = ok;
    modalCancelBtn.onclick = cancel;
    document.addEventListener('keydown', keydown);
  });
}

// Resolves to the trimmed input string, or null if cancelled.
function promptModal(title, defaultVal = '') {
  return showModal({ title, defaultVal, showInput: true, showCancel: true });
}

// Resolves to true/false.
function confirmModal(message, title = 'Confirm') {
  return showModal({ title, message, showInput: false, showCancel: true });
}

// Resolves once dismissed (rarely needs awaiting — fire-and-forget is fine).
function alertModal(message, title = 'Notice') {
  return showModal({ title, message, showInput: false, showCancel: false });
}

// Fallback UI for triggerDownload() — see the comment there for why this
// exists. body is 'image' (shows the blob as a picture to save/right-click)
// or 'text' (shows it in a selectable textarea with a Copy button).
function showExportModal({ title, hint, body, url, filename, text }) {
  exportModalTitle.textContent = title;
  exportModalHint.textContent  = hint;
  exportModalBody.innerHTML    = '';

  if (body === 'image') {
    const img = document.createElement('img');
    img.src = url;
    img.alt = filename;
    exportModalBody.appendChild(img);
    exportModalCopyBtn.style.display = 'none';
  } else {
    const ta = document.createElement('textarea');
    ta.readOnly = true;
    ta.value = text;
    exportModalBody.appendChild(ta);
    exportModalCopyBtn.style.display = 'inline-block';
    exportModalCopyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(text);
        exportModalCopyBtn.textContent = 'Copied!';
      } catch {
        ta.focus();
        ta.select();
        try { document.execCommand('copy'); exportModalCopyBtn.textContent = 'Copied!'; }
        catch { exportModalCopyBtn.textContent = 'Select the text and press Ctrl+C'; }
      }
      setTimeout(() => { exportModalCopyBtn.textContent = 'Copy to Clipboard'; }, 1500);
    };
  }

  exportModalDownload.href = url;
  exportModalDownload.download = filename;

  const close = () => {
    exportModalOverlay.style.display = 'none';
    document.removeEventListener('keydown', keydown);
    URL.revokeObjectURL(url);
  };
  const keydown = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  exportModalCloseBtn.onclick = close;
  document.addEventListener('keydown', keydown);

  exportModalOverlay.style.display = 'flex';
}

// ── Collapsible sidebar panels ──────────────────────────────────────────────
const PANEL_COLLAPSE_KEY = 'floorplan-panels-collapsed-v1';

function loadCollapsedPanels() {
  try { return JSON.parse(localStorage.getItem(PANEL_COLLAPSE_KEY)) || {}; }
  catch { return {}; }
}

document.querySelectorAll('.panel').forEach(panel => {
  const toggleHandle = panel.querySelector('.panel-header-left');
  if (!toggleHandle) return;

  if (loadCollapsedPanels()[panel.id]) panel.classList.add('collapsed');

  toggleHandle.addEventListener('click', () => {
    panel.classList.toggle('collapsed');
    const collapsed = loadCollapsedPanels();
    collapsed[panel.id] = panel.classList.contains('collapsed');
    try { localStorage.setItem(PANEL_COLLAPSE_KEY, JSON.stringify(collapsed)); } catch {}
  });
});

// ── Layer UI ──────────────────────────────────────────────────────────────────
document.getElementById('addLayerBtn').addEventListener('click', async () => {
  const val = await promptModal('New Layer', '');
  if (val !== null) addLayer(val || undefined);
});

function renderLayers() {
  layersList.innerHTML = '';
  renderLayerRows(state.layers, 0);
}

function renderLayerRows(nodes, depth) {
  nodes.forEach(layer => {
    const hasChildren = layer.children && layer.children.length > 0;

    const item = document.createElement('div');
    item.className = 'layer-item' + (layer.id === state.activeLayerId ? ' active' : '') + (!layer.visible ? ' hidden' : '') + (layer.locked ? ' locked' : '');
    item.dataset.id = layer.id;
    item.style.paddingLeft = (8 + depth * 15) + 'px';

    // Expand/collapse (only meaningful once it has children, but always
    // reserve the space so sibling rows stay aligned)
    const expandBtn = document.createElement('button');
    expandBtn.className = 'layer-expand-btn';
    if (hasChildren) {
      expandBtn.textContent = layer.expanded === false ? '▸' : '▾';
      expandBtn.title = layer.expanded === false ? 'Expand' : 'Collapse';
      expandBtn.addEventListener('click', e => {
        e.stopPropagation();
        layer.expanded = layer.expanded === false ? true : false;
        renderLayers();
      });
    } else {
      expandBtn.classList.add('spacer');
    }

    // Visibility toggle
    const vis = document.createElement('div');
    vis.className = 'layer-visibility';
    vis.innerHTML = layer.visible
      ? `<svg viewBox="0 -960 960 960" width="16" height="16"><path d="M607.5-372.5Q660-425 660-500t-52.5-127.5Q555-680 480-680t-127.5 52.5Q300-575 300-500t52.5 127.5Q405-320 480-320t127.5-52.5Zm-204-51Q372-455 372-500t31.5-76.5Q435-608 480-608t76.5 31.5Q588-545 588-500t-31.5 76.5Q525-392 480-392t-76.5-31.5ZM214-281.5Q94-363 40-500q54-137 174-218.5T480-800q146 0 266 81.5T920-500q-54 137-174 218.5T480-200q-146 0-266-81.5ZM480-500Zm207.5 160.5Q782-399 832-500q-50-101-144.5-160.5T480-720q-113 0-207.5 59.5T128-500q50 101 144.5 160.5T480-280q113 0 207.5-59.5Z" fill="currentColor"/></svg>`
      : `<svg viewBox="0 -960 960 960" width="16" height="16"><path d="m644-428-58-58q9-47-27-88t-93-32l-58-58q17-8 34.5-12t37.5-4q75 0 127.5 52.5T660-500q0 20-4 37.5T644-428Zm128 126-58-56q38-29 67.5-63.5T832-500q-50-101-143.5-160.5T480-720q-29 0-57 4t-55 12l-62-62q41-17 84-25.5t90-8.5q151 0 269 83.5T920-500q-23 59-60.5 109.5T772-302Zm20 246L624-222q-35 11-70.5 16.5T480-200q-151 0-269-83.5T40-500q21-53 53-98.5t73-81.5L56-792l56-56 736 736-56 56ZM222-624q-29 26-53 57t-41 67q50 101 143.5 160.5T480-280q20 0 39-2.5t39-5.5l-36-38q-11 3-21 4.5t-21 1.5q-75 0-127.5-52.5T300-500q0-11 1.5-21t4.5-21l-84-82Zm319 93Zm-151 75Z" fill="currentColor"/></svg>`;
    vis.title = layer.visible ? 'Hide (also hides sub-layers)' : 'Show';
    vis.addEventListener('click', e => { e.stopPropagation(); layer.visible = !layer.visible; renderLayers(); redrawMain(); });

    // Lock toggle — a locked layer's shapes can't be selected, moved,
    // resized, erased, or have their measurement labels edited, and no new
    // shapes can be drawn onto it while it's active. Lock cascades to
    // sub-layers the same way visibility does. This is on top of the
    // implicit lock every non-active layer already has (see
    // isLayerEffectivelyLocked) — manual lock lets you protect a layer
    // even while it's the active one.
    const lockBtn = document.createElement('div');
    lockBtn.className = 'layer-lock' + (layer.locked ? ' locked' : '');
    lockBtn.innerHTML = layer.locked
      ? `<svg viewBox="0 -960 960 960" width="14" height="14"><path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm0-80h480v-400H240v400Zm296.5-143.5Q560-327 560-360t-23.5-56.5Q513-440 480-440t-56.5 23.5Q400-393 400-360t23.5 56.5Q447-280 480-280t56.5-23.5ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80ZM240-160v-400 400Z" fill="currentColor"/></svg>`
      : `<svg viewBox="0 -960 960 960" width="14" height="14"><path d="M240-640h360v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85h-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640Zm0 480h480v-400H240v400Zm296.5-143.5Q560-327 560-360t-23.5-56.5Q513-440 480-440t-56.5 23.5Q400-393 400-360t23.5 56.5Q447-280 480-280t56.5-23.5ZM240-160v-400 400Z" fill="currentColor"/></svg>`;
    lockBtn.title = layer.locked ? 'Locked — click to unlock' : 'Unlocked — click to lock (also locks sub-layers)';
    lockBtn.addEventListener('click', e => {
      e.stopPropagation();
      layer.locked = !layer.locked;
      if (layer.locked) {
        state.selection = state.selection.filter(id => {
          const found = findShapeById(id);
          return found && !isLayerEffectivelyLocked(found.layer.id);
        });
        updateSelectionPanel();
        redrawOverlay();
      }
      renderLayers();
    });

    // Color swatch
    const swatchWrapper = document.createElement('div');
    swatchWrapper.style.position = 'relative';
    const swatch = document.createElement('div');
    swatch.className   = 'layer-swatch';
    swatch.style.background = layer.color;
    const colorPicker  = document.createElement('input');
    colorPicker.type   = 'color';
    colorPicker.value  = layer.color;
    colorPicker.className = 'layer-color-input';
    colorPicker.addEventListener('input', e => {
      layer.color = e.target.value;
      swatch.style.background = layer.color;
    });
    colorPicker.addEventListener('change', () => { saveHistory(); redrawAll(); });
    swatch.addEventListener('click', e => { e.stopPropagation(); colorPicker.click(); });
    swatchWrapper.append(swatch, colorPicker);

    // Name
    const nameEl = document.createElement('span');
    nameEl.className   = 'layer-name';
    nameEl.textContent = layer.name;
    nameEl.addEventListener('dblclick', async e => {
      e.stopPropagation();
      const val = await promptModal('Rename Layer', layer.name);
      if (val) { layer.name = val; renderLayers(); updateMoveToLayer(); saveHistory(); }
    });

    // Actions
    const actions = document.createElement('div');
    actions.className = 'layer-actions';

    const addSubBtn = document.createElement('button');
    addSubBtn.className = 'layer-action-btn add';
    addSubBtn.title   = 'Add sub-layer';
    addSubBtn.innerHTML = '+';
    addSubBtn.addEventListener('click', async e => {
      e.stopPropagation();
      const val = await promptModal('New Sub-layer', '');
      if (val !== null) addLayer(val || undefined, undefined, layer.id);
    });

    const upBtn = document.createElement('button');
    upBtn.className = 'layer-action-btn up';
    upBtn.title   = 'Move up';
    upBtn.innerHTML = '↑';
    upBtn.addEventListener('click', e => { e.stopPropagation(); moveLayer(layer.id, -1); });

    const downBtn = document.createElement('button');
    downBtn.className = 'layer-action-btn';
    downBtn.title   = 'Move down';
    downBtn.innerHTML = '↓';
    downBtn.addEventListener('click', e => { e.stopPropagation(); moveLayer(layer.id, 1); });

    const delBtn = document.createElement('button');
    delBtn.className = 'layer-action-btn';
    delBtn.title   = 'Delete layer';
    delBtn.innerHTML = '×';
    delBtn.addEventListener('click', async e => {
      e.stopPropagation();
      if (countAllLayers(state.layers) === 1) { await alertModal('Cannot delete the last layer.'); return; }
      const childCount = hasChildren ? countAllLayers(layer.children) : 0;
      const msg = childCount
        ? `Delete layer "${layer.name}", its ${childCount} sub-layer${childCount === 1 ? '' : 's'}, and all their shapes?`
        : `Delete layer "${layer.name}" and all its shapes?`;
      const ok = await confirmModal(msg, 'Delete Layer');
      if (!ok) return;
      const wasActiveOrAncestor = state.activeLayerId === layer.id || findLayerById(layer.children, state.activeLayerId);
      removeLayerById(state.layers, layer.id);
      if (wasActiveOrAncestor) state.activeLayerId = state.layers[0]?.id || null;
      saveHistory(); renderLayers(); updateMoveToLayer(); redrawAll();
    });

    actions.append(addSubBtn, upBtn, downBtn, delBtn);
    item.append(expandBtn, vis, lockBtn, swatchWrapper, nameEl, actions);

    item.addEventListener('click', () => {
      state.activeLayerId = layer.id;
      // Only the active layer is editable, so anything selected on a layer
      // we just switched away from needs to drop out of the selection.
      state.selection = state.selection.filter(id => {
        const found = findShapeById(id);
        return found && !isLayerEffectivelyLocked(found.layer.id);
      });
      updateSelectionPanel();
      renderLayers();
      redrawMain();
      redrawOverlay();
    });

    layersList.appendChild(item);

    if (hasChildren && layer.expanded !== false) {
      renderLayerRows(layer.children, depth + 1);
    }
  });
}

function moveLayer(id, dir) {
  const slot = findSiblingSlot(state.layers, id);
  if (!slot) return;
  const { array, index } = slot;
  const to = index + dir;
  if (to < 0 || to >= array.length) return;
  [array[index], array[to]] = [array[to], array[index]];
  saveHistory();
  renderLayers();
  redrawMain();
}

// ── Symbol Library UI ─────────────────────────────────────────────────────────
function renderSymbolLibrary() {
  const content = document.getElementById('symbols-content');
  content.innerHTML = '';

  SYMBOL_CATEGORIES.forEach(cat => {
    const syms = SYMBOLS.filter(s => s.category === cat.id);
    if (!syms.length) return;

    const catEl = document.createElement('div');
    catEl.className   = 'sym-category';
    catEl.textContent = cat.label;
    content.appendChild(catEl);

    const grid = document.createElement('div');
    grid.className = 'sym-grid';

    syms.forEach(sym => {
      const btn    = document.createElement('button');
      btn.className = 'sym-btn' + (state.currentSymbol === sym.key ? ' active' : '');
      btn.title     = sym.label;
      btn.dataset.key = sym.key;

      const cv  = document.createElement('canvas');
      cv.width  = 36;
      cv.height = 36;
      const cx  = cv.getContext('2d');
      cx.translate(18, 18);
      cx.strokeStyle  = '#cdd6f4';
      cx.fillStyle    = '#cdd6f4';
      cx.lineWidth    = 1.5;
      cx.textAlign    = 'center';
      cx.textBaseline = 'middle';
      try { sym.draw(cx, 13); } catch (_) {}

      btn.appendChild(cv);
      btn.addEventListener('click', () => {
        state.currentSymbol = sym.key;
        document.querySelectorAll('.sym-btn').forEach(b => b.classList.toggle('active', b.dataset.key === sym.key));
        state.props.symbolSize = defaultSymbolWorldSize(sym);
        syncSymbolSizeUI();
        setTool('sym');
      });

      grid.appendChild(btn);
    });

    content.appendChild(grid);
  });
}

function syncSymbolSizeUI() {
  const sizeInput = document.getElementById('symSize');
  const hint       = document.getElementById('symSizeHint');
  sizeInput.value  = parseFloat(state.props.symbolSize.toFixed(2));
  hint.textContent = formatSizeHint(state.props.symbolSize);
  if (state.tool === 'sym') redrawOverlay();
}

function initSymbolControls() {
  // Start from the currently-selected symbol's real-world default rather
  // than an arbitrary constant, so it's scaled correctly from first paint.
  const startSym = SYMBOLS.find(s => s.key === state.currentSymbol);
  if (startSym) state.props.symbolSize = defaultSymbolWorldSize(startSym);
  syncSymbolSizeUI();

  document.getElementById('symSize').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (v > 0) {
      state.props.symbolSize = v;
      document.getElementById('symSizeHint').textContent = formatSizeHint(v);
      let changed = false;
      for (const sid of state.selection) {
        const found = findShapeById(sid);
        if (found && found.shape.type === 'symbol') {
          // Also resets a non-uniform symbol (e.g. a resized couch) back to
          // uniform at this size — the Size field is the discoverable way
          // to undo an independent width/height edit.
          found.shape.size = v;
          delete found.shape.sizeX;
          delete found.shape.sizeY;
          changed = true;
        }
      }
      if (changed) { saveHistory(); redrawMain(); }
      if (state.tool === 'sym') redrawOverlay();
    }
  });

  document.getElementById('symRotateBtn').addEventListener('click', () => {
    state.symbolRotation = (state.symbolRotation + 90) % 360;
    document.getElementById('symRotLabel').textContent = state.symbolRotation + '°';
    redrawOverlay();
  });
}

// ── Wall controls ─────────────────────────────────────────────────────────────
function syncWallThicknessUI() {
  document.getElementById('wallThickness').value = parseFloat(state.props.wallThickness.toFixed(2));
  document.getElementById('wallThicknessHint').textContent = formatSizeHint(state.props.wallThickness);
}

function initWallControls() {
  state.props.wallThickness = defaultWallThickness();
  syncWallThicknessUI();

  document.getElementById('wallThickness').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (v > 0) {
      state.props.wallThickness = v;
      document.getElementById('wallThicknessHint').textContent = formatSizeHint(v);
      let changed = false;
      for (const sid of state.selection) {
        const found = findShapeById(sid);
        if (found && found.shape.type === 'wall') { found.shape.thickness = v; changed = true; }
      }
      if (changed) { saveHistory(); redrawMain(); }
    }
  });
}

// ── Scale UI ──────────────────────────────────────────────────────────────────
function syncScaleUI() {
  document.getElementById('scaleValue').value         = state.scale.gridValue;
  document.getElementById('scaleUnit').value          = state.scale.unit;
  document.getElementById('showMeasurements').checked = state.scale.showMeasurements;
  document.getElementById('snapDivisions').value       = state.snapDivisions;
  updateScaleHint();
  updateSnapHint();
}

// "5 ft" / "0.5 ft" -> "5ft" / "6in"; other units keep a plain "N unit".
function formatRealValue(real, unit) {
  if (unit === 'ft') return formatFeetInches(real);
  return `${parseFloat(real.toFixed(4))} ${unit}`;
}

function updateScaleHint() {
  const { gridValue, unit } = state.scale;
  document.getElementById('scaleHint').textContent =
    `1 grid cell = ${formatRealValue(gridValue, unit)}  ·  5 cells = ${formatRealValue(gridValue * 5, unit)}`;
}

function updateSnapHint() {
  const increment = state.scale.gridValue / state.snapDivisions;
  document.getElementById('snapHint').textContent =
    `Snap increment: ${formatRealValue(increment, state.scale.unit)}`;
}

function initScaleControls() {
  syncScaleUI();

  document.getElementById('scaleValue').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (v > 0) { state.scale.gridValue = v; updateScaleHint(); updateSnapHint(); syncSymbolSizeUI(); syncWallThicknessUI(); redrawMain(); }
  });

  document.getElementById('scaleUnit').addEventListener('change', e => {
    state.scale.unit = e.target.value;
    updateScaleHint();
    updateSnapHint();
    syncSymbolSizeUI();
    syncWallThicknessUI();
    redrawMain();
  });

  document.getElementById('showMeasurements').addEventListener('change', e => {
    state.scale.showMeasurements = e.target.checked;
    redrawMain();
  });

  document.getElementById('snapDivisions').addEventListener('change', e => {
    state.snapDivisions = parseInt(e.target.value, 10) || 1;
    updateSnapHint();
    redrawGrid();
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  resizeCanvases();
  window.addEventListener('resize', resizeCanvases);

  const restored = tryRestoreAutosave();
  if (!restored) {
    addLayer('Base', '#e0e0e0');
  } else {
    state.activeLayerId = state.layers[0]?.id || null;
  }

  // History baseline
  state.history = [snapshot()];

  renderLayers();
  updateMoveToLayer();
  updateSelectionPanel();
  renderSymbolLibrary();
  initSymbolControls();
  initWallControls();
  initScaleControls();
  setTool('select');
  redrawAll();
  setAutosaveStatus('Saved');

  if (restored) showRestoredToast();

  document.getElementById('newBtn').addEventListener('click', clearAutosaveAndReset);
}

init();
