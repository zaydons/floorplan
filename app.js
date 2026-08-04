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

// Convert a placed/preview symbol's world-unit size back to a friendly
// real-world label (in/ft) for the size hint next to the Size field.
function formatSizeHint(worldSize) {
  const inches = worldSize / worldUnitsPerInch();
  if (!isFinite(inches) || inches <= 0) return '';
  if (inches >= 12) {
    const ft = inches / 12;
    return `≈ ${parseFloat(ft.toFixed(1))} ft`;
  }
  return `≈ ${parseFloat(inches.toFixed(1))} in`;
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
  snapToShapes: true,
  snapIndicator: null, // { x, y } world point currently snapped-to, for overlay feedback
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
  },
};

// Drawing interaction state
const drag = {
  active: false,
  startX: 0, startY: 0,
  lastX: 0,  lastY: 0,
  polyPoints: [],      // for polygon tool
  shape: null,         // shape being drawn (preview)
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
const modalOverlay    = document.getElementById('modal-overlay');
const modalInput      = document.getElementById('modal-input');
const textPropRow     = document.getElementById('textPropRow');
const stairsPropRow   = document.getElementById('stairsPropRow');

// ── Helpers ──────────────────────────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function snap(v) {
  if (!state.snapToGrid) return v;
  return Math.round(v / GRID_SIZE) * GRID_SIZE;
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
    case 'polygon': {
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
  for (const layer of state.layers) {
    if (!layer.visible) continue;
    for (const s of layer.shapes) {
      if (excludeIds && excludeIds.has(s.id)) continue;
      addShapeCandidates(pts, s);
    }
  }
  // Let an in-progress polygon snap back onto its own earlier points (closing the loop)
  if (state.tool === 'polygon' && drag.polyPoints.length) {
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

function resizeCanvases() {
  const container = document.getElementById('canvas-container');
  const W = container.clientWidth;
  const H = container.clientHeight;
  [gridCanvas, mainCanvas, overlayCanvas].forEach(c => {
    c.width  = W;
    c.height = H;
  });
  redrawAll();
}

// ── Layer helpers ─────────────────────────────────────────────────────────────
function activeLayer() {
  return state.layers.find(l => l.id === state.activeLayerId) || null;
}

function addLayer(name, color) {
  const layer = {
    id: uid(),
    name: name || `Layer ${state.layers.length + 1}`,
    visible: true,
    color: color || LAYER_COLORS[state.layers.length % LAYER_COLORS.length],
    shapes: [],
  };
  state.layers.unshift(layer);
  state.activeLayerId = layer.id;
  saveHistory();
  renderLayers();
  updateMoveToLayer();
  return layer;
}

function findShapeById(id) {
  for (const layer of state.layers) {
    const shape = layer.shapes.find(s => s.id === id);
    if (shape) return { layer, shape };
  }
  return null;
}

// ── History ───────────────────────────────────────────────────────────────────
function snapshot() {
  return JSON.stringify({ layers: state.layers, activeLayerId: state.activeLayerId });
}

function saveHistory() {
  state.history.push(snapshot());
  if (state.history.length > 100) state.history.shift();
  state.future = [];
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
      sym.draw(ctx, (shape.size || 40) / 2);
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
    case 'text':
      return { x: shape.x - 4, y: shape.y - 20, w: 120, h: 24 };
    case 'symbol': {
      const r = (shape.size || 40) / 2 + 4;
      return { x: shape.x - r, y: shape.y - r, w: r * 2, h: r * 2 };
    }
    default:
      return { x: 0, y: 0, w: 0, h: 0 };
  }
}

function hitTest(shape, wx, wy) {
  const b = shapeBounds(shape);
  return wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h;
}

// ── Measurements ──────────────────────────────────────────────────────────────
function formatMeasurement(worldUnits) {
  if (worldUnits < 0.5) return '';
  const real = (worldUnits / GRID_SIZE) * state.scale.gridValue;
  const d = real >= 100 ? 0 : real >= 10 ? 1 : 2;
  return `${parseFloat(real.toFixed(d))} ${state.scale.unit}`;
}

function drawMeasLabel(ctx, text, x, y, scale) {
  if (!text) return;
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
}

function drawMeasurements(ctx, shape, scale) {
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
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(ang > Math.PI / 2 || ang < -Math.PI / 2 ? ang + Math.PI : ang);
      drawMeasLabel(ctx, formatMeasurement(len), 0, 0, scale);
      ctx.restore();
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
      drawMeasLabel(ctx, formatMeasurement(w), x + w / 2, y - off, scale);
      // Height label right of right edge, rotated
      ctx.save();
      ctx.translate(x + w + off, y + h / 2);
      ctx.rotate(Math.PI / 2);
      drawMeasLabel(ctx, formatMeasurement(h), 0, 0, scale);
      ctx.restore();
      break;
    }
    case 'circle': {
      const cx = (shape.x1 + shape.x2) / 2;
      const cy = (shape.y1 + shape.y2) / 2;
      const rx = Math.abs(shape.x2 - shape.x1) / 2;
      const ry = Math.abs(shape.y2 - shape.y1) / 2;
      if (rx < 1 && ry < 1) return;
      const label = rx === ry
        ? 'Ø ' + formatMeasurement(rx * 2)
        : formatMeasurement(rx * 2) + ' × ' + formatMeasurement(ry * 2);
      drawMeasLabel(ctx, label, cx, cy, scale);
      break;
    }
    case 'polygon': {
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
        ctx.save();
        ctx.translate(mx - Math.sin(ang) * off, my + Math.cos(ang) * off);
        ctx.rotate(ang > Math.PI / 2 || ang < -Math.PI / 2 ? ang + Math.PI : ang);
        drawMeasLabel(ctx, formatMeasurement(len), 0, 0, scale);
        ctx.restore();
      }
      break;
    }
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
function redrawGrid() {
  const W = gridCanvas.width;
  const H = gridCanvas.height;
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
  const W = mainCanvas.width;
  const H = mainCanvas.height;
  mCtx.clearRect(0, 0, W, H);
  mCtx.save();
  mCtx.translate(state.pan.x, state.pan.y);
  mCtx.scale(state.zoom, state.zoom);

  // Draw layers bottom-to-top (array index 0 = top layer visually, render reversed)
  for (let i = state.layers.length - 1; i >= 0; i--) {
    const layer = state.layers[i];
    if (!layer.visible) continue;
    for (const shape of layer.shapes) {
      drawShape(mCtx, shape, layer.color, state.zoom);
      drawMeasurements(mCtx, shape, state.zoom);
    }
  }
  mCtx.restore();
}

function redrawOverlay() {
  const W = overlayCanvas.width;
  const H = overlayCanvas.height;
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

  if (!state.selection.length && !drag.shape && !drag.polyPoints.length) return;

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

  // Selection highlights
  for (const id of state.selection) {
    const found = findShapeById(id);
    if (!found) continue;
    const b = shapeBounds(found.shape);
    oCtx.save();
    oCtx.strokeStyle = '#7c6aff';
    oCtx.lineWidth   = 1.5 / state.zoom;
    oCtx.setLineDash([4 / state.zoom, 3 / state.zoom]);
    oCtx.strokeRect(b.x, b.y, b.w, b.h);
    // Corner handles
    oCtx.fillStyle = '#7c6aff';
    oCtx.setLineDash([]);
    [[b.x, b.y],[b.x+b.w, b.y],[b.x, b.y+b.h],[b.x+b.w, b.y+b.h]].forEach(([hx,hy]) => {
      oCtx.fillRect(hx - HANDLE_R/state.zoom, hy - HANDLE_R/state.zoom, (HANDLE_R*2)/state.zoom, (HANDLE_R*2)/state.zoom);
    });
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
  if (!layer) { drag.polyPoints = []; redrawOverlay(); return; }
  const shape = {
    id: uid(), ...currentShapeProps(),
    type: 'polygon',
    points: [...drag.polyPoints],
    closed,
  };
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
    // Hit test visible layers
    let hit = null;
    for (const layer of state.layers) {
      if (!layer.visible) continue;
      for (let i = layer.shapes.length - 1; i >= 0; i--) {
        if (hitTest(layer.shapes[i], pos.wx, pos.wy)) { hit = layer.shapes[i]; break; }
      }
      if (hit) break;
    }
    if (hit) {
      if (!e.shiftKey) state.selection = [hit.id];
      else if (!state.selection.includes(hit.id)) state.selection.push(hit.id);
      else state.selection = state.selection.filter(id => id !== hit.id);
    } else {
      state.selection = [];
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

  if (state.tool === 'eraser') {
    eraseAt(pos.wx, pos.wy);
    drag.active = true; drag.tool = 'eraser';
    return;
  }

  if (state.tool === 'text') {
    openTextInput(pos);
    return;
  }

  if (state.tool === 'sym') {
    const layer = activeLayer();
    if (!layer || !state.currentSymbol) return;
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

  if (state.tool === 'polygon') {
    drag.polyPoints.push({ x: pos.wx, y: pos.wy });
    redrawOverlay();
    return;
  }

  // Line, rect, circle, stairs
  const layer = activeLayer();
  if (!layer) return;
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

  // Polygon cursor line
  if (state.tool === 'polygon' && drag.polyPoints.length) {
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
  if (state.tool === 'polygon') {
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
  for (const layer of state.layers) {
    if (!layer.visible) continue;
    const before = layer.shapes.length;
    layer.shapes = layer.shapes.filter(s => !hitTest(s, wx, wy));
    if (layer.shapes.length !== before) changed = true;
  }
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
    textInput.style.display = 'none';
    textPending = null;
  }
});

textInput.addEventListener('blur', () => {
  if (textInput.value.trim()) commitText();
  else { textInput.style.display = 'none'; textPending = null; }
});

function commitText() {
  const val = textInput.value.trim();
  textInput.style.display = 'none';
  if (!val || !textPending) return;
  const layer = activeLayer();
  if (!layer) return;
  layer.shapes.push({
    id: uid(), ...currentShapeProps(),
    type: 'text', text: val,
    x: textPending.wx, y: textPending.wy,
    fontSize: state.props.fontSize,
  });
  textPending = null;
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

  const map = { v:'select', h:'pan', l:'line', r:'rect', p:'polygon', c:'circle', t:'text', e:'eraser', m:'sym', s:'stairs' };
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
    for (const layer of state.layers) {
      layer.shapes = layer.shapes.filter(s => s.id !== id);
    }
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
  const target   = state.layers.find(l => l.id === targetId);
  if (!target) return;
  for (const id of state.selection) {
    const found = findShapeById(id);
    if (!found || found.layer.id === targetId) continue;
    found.layer.shapes = found.layer.shapes.filter(s => s.id !== id);
    target.shapes.push(found.shape);
  }
  saveHistory();
  redrawMain();
});

function updateMoveToLayer() {
  moveToLayerSel.innerHTML = state.layers
    .map(l => `<option value="${l.id}">${l.name}</option>`)
    .join('');
}

// ── Properties panel ──────────────────────────────────────────────────────────
function bindProp(id, key, transform) {
  const el = document.getElementById(id);
  el.addEventListener('input', () => {
    state.props[key] = transform ? transform(el.value) : el.value;
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
  this.textContent = state.props.stairsDirection === 'up' ? '⇅ UP' : '⇅ DN';
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
  const data = JSON.stringify({ layers: state.layers, scale: state.scale }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'floorplan.json';
  a.click();
  URL.revokeObjectURL(url);
}

function loadFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    try {
      const data = JSON.parse(evt.target.result);
      if (data.layers) {
        state.layers        = data.layers;
        state.activeLayerId = state.layers[0]?.id || null;
        state.selection     = [];
        if (data.scale) {
          Object.assign(state.scale, data.scale);
          syncScaleUI();
        }
        saveHistory();
        renderLayers();
        updateMoveToLayer();
        redrawAll();
      }
    } catch {
      alert('Invalid file.');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function exportPNG() {
  const W = mainCanvas.width;
  const H = mainCanvas.height;
  const tmp = document.createElement('canvas');
  tmp.width  = W; tmp.height = H;
  const ctx  = tmp.getContext('2d');
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
  for (let i = state.layers.length - 1; i >= 0; i--) {
    const layer = state.layers[i];
    if (!layer.visible) continue;
    for (const shape of layer.shapes) {
      drawShape(ctx, shape, layer.color, state.zoom);
      drawMeasurements(ctx, shape, state.zoom);
    }
  }
  ctx.restore();

  tmp.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href    = url; a.download = 'floorplan.png'; a.click();
    URL.revokeObjectURL(url);
  });
}

// ── Layer UI ──────────────────────────────────────────────────────────────────
document.getElementById('addLayerBtn').addEventListener('click', () => showModal());

function showModal(title = 'New Layer', defaultVal = '', onOk) {
  document.getElementById('modal-title').textContent = title;
  modalInput.value = defaultVal;
  modalOverlay.style.display = 'flex';
  modalInput.focus();
  modalInput.select();

  const ok = () => {
    const val = modalInput.value.trim();
    modalOverlay.style.display = 'none';
    if (onOk) onOk(val);
    else if (val) addLayer(val);
    else addLayer();
    cleanup();
  };

  const cancel = () => {
    modalOverlay.style.display = 'none';
    cleanup();
  };

  const keydown = e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') cancel(); };
  document.getElementById('modal-ok').onclick     = ok;
  document.getElementById('modal-cancel').onclick = cancel;
  modalInput.addEventListener('keydown', keydown);
  function cleanup() { modalInput.removeEventListener('keydown', keydown); }
}

function renderLayers() {
  layersList.innerHTML = '';
  state.layers.forEach((layer, index) => {
    const item = document.createElement('div');
    item.className = 'layer-item' + (layer.id === state.activeLayerId ? ' active' : '') + (!layer.visible ? ' hidden' : '');
    item.dataset.id = layer.id;

    // Visibility toggle
    const vis = document.createElement('div');
    vis.className = 'layer-visibility';
    vis.innerHTML = layer.visible
      ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`
      : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
    vis.addEventListener('click', e => { e.stopPropagation(); layer.visible = !layer.visible; renderLayers(); redrawMain(); });

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
    nameEl.addEventListener('dblclick', e => {
      e.stopPropagation();
      showModal('Rename Layer', layer.name, val => {
        if (val) { layer.name = val; renderLayers(); updateMoveToLayer(); saveHistory(); }
      });
    });

    // Actions
    const actions = document.createElement('div');
    actions.className = 'layer-actions';

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
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (state.layers.length === 1) return alert('Cannot delete the last layer.');
      if (!confirm(`Delete layer "${layer.name}" and all its shapes?`)) return;
      state.layers = state.layers.filter(l => l.id !== layer.id);
      if (state.activeLayerId === layer.id) state.activeLayerId = state.layers[0]?.id || null;
      saveHistory(); renderLayers(); updateMoveToLayer(); redrawAll();
    });

    actions.append(upBtn, downBtn, delBtn);
    item.append(vis, swatchWrapper, nameEl, actions);

    item.addEventListener('click', () => {
      state.activeLayerId = layer.id;
      renderLayers();
    });

    layersList.appendChild(item);
  });
}

function moveLayer(id, dir) {
  const idx = state.layers.findIndex(l => l.id === id);
  const to  = idx + dir;
  if (to < 0 || to >= state.layers.length) return;
  [state.layers[idx], state.layers[to]] = [state.layers[to], state.layers[idx]];
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
      if (state.tool === 'sym') redrawOverlay();
    }
  });

  document.getElementById('symRotateBtn').addEventListener('click', () => {
    state.symbolRotation = (state.symbolRotation + 90) % 360;
    document.getElementById('symRotLabel').textContent = state.symbolRotation + '°';
    redrawOverlay();
  });
}

// ── Scale UI ──────────────────────────────────────────────────────────────────
function syncScaleUI() {
  document.getElementById('scaleValue').value         = state.scale.gridValue;
  document.getElementById('scaleUnit').value          = state.scale.unit;
  document.getElementById('showMeasurements').checked = state.scale.showMeasurements;
  updateScaleHint();
}

function updateScaleHint() {
  const { gridValue, unit } = state.scale;
  document.getElementById('scaleHint').textContent =
    `1 grid cell = ${gridValue} ${unit}  ·  5 cells = ${gridValue * 5} ${unit}`;
}

function initScaleControls() {
  syncScaleUI();

  document.getElementById('scaleValue').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (v > 0) { state.scale.gridValue = v; updateScaleHint(); syncSymbolSizeUI(); redrawMain(); }
  });

  document.getElementById('scaleUnit').addEventListener('change', e => {
    state.scale.unit = e.target.value;
    updateScaleHint();
    syncSymbolSizeUI();
    redrawMain();
  });

  document.getElementById('showMeasurements').addEventListener('change', e => {
    state.scale.showMeasurements = e.target.checked;
    redrawMain();
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  resizeCanvases();
  window.addEventListener('resize', resizeCanvases);

  // Default layers
  addLayer('Base / Walls', '#e0e0e0');
  addLayer('Windows & Doors', '#6ab8ff');
  addLayer('In-Floor Heat', '#ff976a');
  addLayer('Electrical', '#ffca6a');

  // History baseline
  state.history = [snapshot()];

  renderLayers();
  updateMoveToLayer();
  updateSelectionPanel();
  renderSymbolLibrary();
  initSymbolControls();
  initScaleControls();
  setTool('select');
  redrawAll();
}

init();
