'use strict';

// Symbol draw functions receive (ctx, r) where:
//   ctx is already translated to the symbol center with strokeStyle/lineWidth set
//   r   is the half-size in world units
// Use ctx.strokeStyle for fill color to stay monochrome per layer.

const SYMBOL_CATEGORIES = [
  { id: 'outlets',  label: 'Outlets & Receptacles' },
  { id: 'switches', label: 'Switches' },
  { id: 'lighting', label: 'Lighting' },
  { id: 'panel',    label: 'Panel & Service' },
  { id: 'special',  label: 'Detectors & Special' },
];

const SYMBOLS = [
  // ── Outlets ──────────────────────────────────────────────────────────────────
  {
    key: 'outlet', label: 'Duplex Outlet', category: 'outlets',
    draw(ctx, r) {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.88, 0, Math.PI * 2); ctx.stroke();
      const sw = r * 0.13, sh = r * 0.32, gap = r * 0.24;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillRect(-gap - sw, -sh, sw * 2, sh * 2);
      ctx.fillRect( gap - sw, -sh, sw * 2, sh * 2);
      ctx.beginPath(); ctx.arc(0, r * 0.28, r * 0.13, Math.PI, 0); ctx.closePath(); ctx.fill();
    },
  },
  {
    key: 'outlet_gfci', label: 'GFCI Outlet', category: 'outlets',
    draw(ctx, r) {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.88, 0, Math.PI * 2); ctx.stroke();
      const sw = r * 0.12, sh = r * 0.24, gap = r * 0.22;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillRect(-gap - sw, -sh * 0.6, sw * 2, sh * 1.5);
      ctx.fillRect( gap - sw, -sh * 0.6, sw * 2, sh * 1.5);
      ctx.beginPath(); ctx.arc(0, r * 0.24, r * 0.12, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.font = `bold ${r * 0.28}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('GFI', 0, -r * 0.62);
    },
  },
  {
    key: 'outlet_floor', label: 'Floor Outlet', category: 'outlets',
    draw(ctx, r) {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.88, 0, Math.PI * 2); ctx.stroke();
      const ir = r * 0.55;
      ctx.beginPath();
      ctx.moveTo(-ir, 0); ctx.lineTo(ir, 0);
      ctx.moveTo(0, -ir); ctx.lineTo(0, ir);
      ctx.stroke();
    },
  },
  {
    key: 'outlet_240', label: '240V Outlet', category: 'outlets',
    draw(ctx, r) {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.88, 0, Math.PI * 2); ctx.stroke();
      // L-shaped slot pattern
      ctx.fillStyle = ctx.strokeStyle;
      const sw = r * 0.12, sh = r * 0.3;
      ctx.fillRect(-r * 0.35 - sw, -sh, sw * 2, sh * 1.6);
      // L leg
      ctx.fillRect(-r * 0.35 - sw, sh * 0.6 - sw, sh * 0.5, sw * 2);
      // Right slot (straight)
      ctx.fillRect( r * 0.15 - sw, -sh, sw * 2, sh * 1.6);
      ctx.font = `bold ${r * 0.28}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('240', 0, r * 0.66);
    },
  },
  {
    key: 'outlet_wp', label: 'Weatherproof', category: 'outlets',
    draw(ctx, r) {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.88, 0, Math.PI * 2); ctx.stroke();
      const sw = r * 0.13, sh = r * 0.28, gap = r * 0.22;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillRect(-gap - sw, -sh, sw * 2, sh * 2);
      ctx.fillRect( gap - sw, -sh, sw * 2, sh * 2);
      // Cover bubble at top
      ctx.beginPath(); ctx.arc(0, -r * 0.35, r * 0.55, Math.PI, 0); ctx.stroke();
      ctx.font = `bold ${r * 0.28}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('WP', 0, r * 0.62);
    },
  },

  // ── Switches ─────────────────────────────────────────────────────────────────
  {
    key: 'switch_s1', label: 'Switch (S)', category: 'switches',
    draw(ctx, r) {
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath(); ctx.arc(0, r * 0.52, r * 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, r * 0.52); ctx.lineTo(r * 0.52, -r * 0.28); ctx.stroke();
      ctx.font = `bold ${r * 0.52}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('S', r * 0.08, -r * 0.62);
    },
  },
  {
    key: 'switch_s2', label: 'Double Pole (S2)', category: 'switches',
    draw(ctx, r) {
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath(); ctx.arc(0, r * 0.52, r * 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, r * 0.52); ctx.lineTo(r * 0.52, -r * 0.28); ctx.stroke();
      ctx.font = `bold ${r * 0.44}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('S2', r * 0.1, -r * 0.62);
    },
  },
  {
    key: 'switch_s3', label: '3-Way Switch (S3)', category: 'switches',
    draw(ctx, r) {
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath(); ctx.arc(0, r * 0.52, r * 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, r * 0.52); ctx.lineTo(r * 0.52, -r * 0.28); ctx.stroke();
      ctx.font = `bold ${r * 0.44}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('S3', r * 0.1, -r * 0.62);
    },
  },
  {
    key: 'switch_dim', label: 'Dimmer (SD)', category: 'switches',
    draw(ctx, r) {
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath(); ctx.arc(0, r * 0.52, r * 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, r * 0.52); ctx.lineTo(r * 0.52, -r * 0.28); ctx.stroke();
      // Wavy tilde on the arm
      ctx.beginPath();
      ctx.moveTo(r * 0.08, r * 0.3);
      ctx.quadraticCurveTo(r * 0.2, r * 0.15, r * 0.3, r * 0.24);
      ctx.quadraticCurveTo(r * 0.42, r * 0.34, r * 0.52, r * 0.18);
      ctx.stroke();
      ctx.font = `bold ${r * 0.44}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('SD', r * 0.1, -r * 0.62);
    },
  },

  // ── Lighting ─────────────────────────────────────────────────────────────────
  {
    key: 'light_ceiling', label: 'Ceiling Light', category: 'lighting',
    draw(ctx, r) {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.38, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5);
        ctx.lineTo(Math.cos(a) * r * 0.88, Math.sin(a) * r * 0.88);
        ctx.stroke();
      }
    },
  },
  {
    key: 'light_recessed', label: 'Recessed Light', category: 'lighting',
    draw(ctx, r) {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.88, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.48, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.1, 0, Math.PI * 2); ctx.fill();
    },
  },
  {
    key: 'light_wall', label: 'Wall Sconce', category: 'lighting',
    draw(ctx, r) {
      ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.82, -Math.PI, 0); ctx.closePath(); ctx.stroke();
      for (let i = -2; i <= 2; i++) {
        const a = -Math.PI / 2 + i * (Math.PI / 8);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5);
        ctx.lineTo(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82);
        ctx.stroke();
      }
    },
  },
  {
    key: 'light_fan', label: 'Ceiling Fan', category: 'lighting',
    draw(ctx, r) {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.88, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 4; i++) {
        ctx.save();
        ctx.rotate((i / 4) * Math.PI * 2);
        ctx.beginPath();
        ctx.ellipse(r * 0.46, 0, r * 0.34, r * 0.17, 0, Math.PI * 0.08, Math.PI * 0.92);
        ctx.stroke();
        ctx.restore();
      }
    },
  },

  // ── Panel & Service ───────────────────────────────────────────────────────────
  {
    key: 'panel', label: 'Breaker Panel', category: 'panel',
    draw(ctx, r) {
      const w = r * 1.3, h = r * 1.7;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      for (let i = 1; i <= 5; i++) {
        const y = -h / 2 + (h / 6) * i;
        ctx.beginPath(); ctx.moveTo(-w / 2 + r * 0.1, y); ctx.lineTo(w / 2 - r * 0.1, y); ctx.stroke();
      }
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = `bold ${r * 0.36}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('P', 0, -h / 2 - r * 0.32);
    },
  },
  {
    key: 'junction', label: 'Junction Box', category: 'panel',
    draw(ctx, r) {
      const s = r * 1.5;
      ctx.strokeRect(-s / 2, -s / 2, s, s);
      ctx.beginPath();
      ctx.moveTo(-s / 2 + r * 0.15, -s / 2 + r * 0.15);
      ctx.lineTo( s / 2 - r * 0.15,  s / 2 - r * 0.15);
      ctx.moveTo( s / 2 - r * 0.15, -s / 2 + r * 0.15);
      ctx.lineTo(-s / 2 + r * 0.15,  s / 2 - r * 0.15);
      ctx.stroke();
    },
  },
  {
    key: 'subpanel', label: 'Sub-panel', category: 'panel',
    draw(ctx, r) {
      const w = r * 1.3, h = r * 1.7;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.save();
      ctx.setLineDash([r * 0.14, r * 0.14]);
      ctx.strokeRect(-w / 2 + r * 0.14, -h / 2 + r * 0.14, w - r * 0.28, h - r * 0.28);
      ctx.restore();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = `bold ${r * 0.36}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('SP', 0, 0);
    },
  },

  // ── Detectors & Special ───────────────────────────────────────────────────────
  {
    key: 'smoke', label: 'Smoke Detector', category: 'special',
    draw(ctx, r) {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.88, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = `bold ${r * 0.38}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('S', -r * 0.12, 0);
      ctx.font = `${r * 0.3}px sans-serif`;
      ctx.fillText('D', r * 0.26, r * 0.18);
    },
  },
  {
    key: 'co', label: 'CO Detector', category: 'special',
    draw(ctx, r) {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.88, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = `bold ${r * 0.38}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('CO', 0, 0);
    },
  },
  {
    key: 'thermostat', label: 'Thermostat', category: 'special',
    draw(ctx, r) {
      ctx.strokeRect(-r * 0.82, -r * 0.82, r * 1.64, r * 1.64);
      // Thermometer stem
      ctx.beginPath(); ctx.moveTo(0, -r * 0.5); ctx.lineTo(0, r * 0.28); ctx.stroke();
      // Bulb
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath(); ctx.arc(0, r * 0.48, r * 0.22, 0, Math.PI * 2); ctx.fill();
      // Tick marks
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.5);  ctx.lineTo(r * 0.2, -r * 0.5);
      ctx.moveTo(0, -r * 0.15); ctx.lineTo(r * 0.2, -r * 0.15);
      ctx.moveTo(0,  r * 0.15); ctx.lineTo(r * 0.2,  r * 0.15);
      ctx.stroke();
    },
  },
  {
    key: 'tv', label: 'TV Outlet', category: 'special',
    draw(ctx, r) {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.88, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = `bold ${r * 0.46}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('TV', 0, 0);
    },
  },
  {
    key: 'phone', label: 'Phone / Data', category: 'special',
    draw(ctx, r) {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.88, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = `bold ${r * 0.34}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('TEL', 0, 0);
    },
  },
  {
    key: 'doorbell', label: 'Doorbell / Chime', category: 'special',
    draw(ctx, r) {
      ctx.strokeRect(-r * 0.7, -r * 0.82, r * 1.4, r * 1.64);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath(); ctx.arc(0, -r * 0.22, r * 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-r * 0.35, r * 0.2); ctx.lineTo(-r * 0.35, r * 0.55);
      ctx.moveTo( r * 0.35, r * 0.2); ctx.lineTo( r * 0.35, r * 0.55);
      ctx.moveTo(-r * 0.35, r * 0.38); ctx.lineTo(r * 0.35, r * 0.38);
      ctx.stroke();
    },
  },
];
