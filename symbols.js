'use strict';

// Symbol draw functions receive (ctx, r) where:
//   ctx is already translated to the symbol center with strokeStyle/lineWidth set
//   r   is the half-size in world units
// Use ctx.strokeStyle for fill color to stay monochrome per layer.

const SYMBOL_CATEGORIES = [
  { id: 'outlets',   label: 'Outlets & Receptacles' },
  { id: 'switches',  label: 'Switches' },
  { id: 'lighting',  label: 'Lighting' },
  { id: 'panel',     label: 'Panel & Service' },
  { id: 'special',   label: 'Detectors & Special' },
  { id: 'hvac',      label: 'HVAC' },
  { id: 'plumbing',  label: 'Plumbing' },
  { id: 'furniture', label: 'Furniture' },
  { id: 'openings',  label: 'Doors & Windows' },
];

const SYMBOLS = [
  // ── Outlets ──────────────────────────────────────────────────────────────────
  {
    key: 'outlet', label: 'Duplex Outlet', category: 'outlets', sizeIn: 4.5,
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
    key: 'outlet_gfci', label: 'GFCI Outlet', category: 'outlets', sizeIn: 4.5,
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
    key: 'outlet_floor', label: 'Floor Outlet', category: 'outlets', sizeIn: 4,
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
    key: 'outlet_240', label: '240V Outlet', category: 'outlets', sizeIn: 5.5,
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
    key: 'outlet_wp', label: 'Weatherproof', category: 'outlets', sizeIn: 5,
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
    key: 'switch_s1', label: 'Switch (S)', category: 'switches', sizeIn: 4.5,
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
    key: 'switch_s2', label: 'Double Pole (S2)', category: 'switches', sizeIn: 4.5,
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
    key: 'switch_s3', label: '3-Way Switch (S3)', category: 'switches', sizeIn: 4.5,
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
    key: 'switch_dim', label: 'Dimmer (SD)', category: 'switches', sizeIn: 4.5,
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
    key: 'light_ceiling', label: 'Ceiling Light', category: 'lighting', sizeIn: 12,
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
    key: 'light_recessed', label: 'Recessed Light', category: 'lighting', sizeIn: 6,
    draw(ctx, r) {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.88, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.48, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.1, 0, Math.PI * 2); ctx.fill();
    },
  },
  {
    key: 'light_wall', label: 'Wall Sconce', category: 'lighting', sizeIn: 8,
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
    key: 'light_fan', label: 'Ceiling Fan', category: 'lighting', sizeIn: 48,
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
    key: 'panel', label: 'Breaker Panel', category: 'panel', sizeIn: 30,
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
    key: 'junction', label: 'Junction Box', category: 'panel', sizeIn: 4,
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
    key: 'subpanel', label: 'Sub-panel', category: 'panel', sizeIn: 24,
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
    key: 'smoke', label: 'Smoke Detector', category: 'special', sizeIn: 5,
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
    key: 'co', label: 'CO Detector', category: 'special', sizeIn: 5,
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
    key: 'thermostat', label: 'Thermostat', category: 'special', sizeIn: 4,
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
    key: 'tv', label: 'TV Outlet', category: 'special', sizeIn: 4.5,
    draw(ctx, r) {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.88, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = `bold ${r * 0.46}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('TV', 0, 0);
    },
  },
  {
    key: 'phone', label: 'Phone / Data', category: 'special', sizeIn: 4.5,
    draw(ctx, r) {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.88, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = `bold ${r * 0.34}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('TEL', 0, 0);
    },
  },
  {
    key: 'doorbell', label: 'Doorbell / Chime', category: 'special', sizeIn: 5,
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

  // ── HVAC ─────────────────────────────────────────────────────────────────────
  {
    key: 'floor_register', label: 'Floor Register', category: 'hvac', sizeIn: 12,
    draw(ctx, r) {
      const w = r * 1.6, h = r * 1.1;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      const slats = 4;
      ctx.beginPath();
      for (let i = 1; i < slats; i++) {
        const x = -w / 2 + (w / slats) * i;
        ctx.moveTo(x, -h / 2 + h * 0.12); ctx.lineTo(x, h / 2 - h * 0.12);
      }
      ctx.stroke();
    },
  },
  {
    key: 'supply_register', label: 'Supply Register', category: 'hvac', sizeIn: 12,
    draw(ctx, r) {
      const w = r * 1.6, h = r * 1.1;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.beginPath();
      for (let i = -1; i <= 1; i++) {
        ctx.moveTo(-w / 2 + w * 0.15, i * h * 0.28);
        ctx.lineTo( w / 2 - w * 0.15, i * h * 0.28);
      }
      ctx.stroke();
      // Airflow arrow pointing out
      ctx.beginPath();
      ctx.moveTo(0, h / 2); ctx.lineTo(0, h / 2 + r * 0.5);
      ctx.moveTo(-r * 0.14, h / 2 + r * 0.32); ctx.lineTo(0, h / 2 + r * 0.5);
      ctx.lineTo(r * 0.14, h / 2 + r * 0.32);
      ctx.stroke();
    },
  },
  {
    key: 'return_register', label: 'Return Register', category: 'hvac', sizeIn: 14,
    draw(ctx, r) {
      const w = r * 1.6, h = r * 1.1;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.beginPath();
      ctx.moveTo(-w / 2 + w * 0.15, -h / 2 + h * 0.15);
      ctx.lineTo( w / 2 - w * 0.15,  h / 2 - h * 0.15);
      ctx.moveTo( w / 2 - w * 0.15, -h / 2 + h * 0.15);
      ctx.lineTo(-w / 2 + w * 0.15,  h / 2 - h * 0.15);
      ctx.stroke();
      // Airflow arrow pointing in
      ctx.beginPath();
      ctx.moveTo(0, h / 2 + r * 0.5); ctx.lineTo(0, h / 2);
      ctx.moveTo(-r * 0.14, h / 2 + r * 0.18); ctx.lineTo(0, h / 2);
      ctx.lineTo(r * 0.14, h / 2 + r * 0.18);
      ctx.stroke();
    },
  },
  {
    key: 'radiator', label: 'Radiator / Baseboard', category: 'hvac', sizeIn: 48,
    draw(ctx, r) {
      const w = r * 1.7, h = r * 0.7;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      const fins = 6;
      ctx.beginPath();
      for (let i = 1; i < fins; i++) {
        const x = -w / 2 + (w / fins) * i;
        ctx.moveTo(x, -h / 2); ctx.lineTo(x, h / 2);
      }
      ctx.stroke();
    },
  },
  {
    key: 'exhaust_fan', label: 'Exhaust Fan', category: 'hvac', sizeIn: 8,
    draw(ctx, r) {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.rotate((i / 3) * Math.PI * 2);
        ctx.beginPath();
        ctx.ellipse(r * 0.36, 0, r * 0.34, r * 0.16, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = `bold ${r * 0.3}px sans-serif`;
      ctx.fillText('EF', 0, r * 1.1);
    },
  },

  // ── Plumbing ─────────────────────────────────────────────────────────────────
  {
    key: 'sink', label: 'Sink', category: 'plumbing', sizeIn: 22,
    draw(ctx, r) {
      const w = r * 1.6, h = r * 1.1;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.beginPath(); ctx.ellipse(0, r * 0.05, w * 0.32, h * 0.3, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath(); ctx.arc(0, -h / 2 + h * 0.12, r * 0.08, 0, Math.PI * 2); ctx.fill();
    },
  },
  {
    key: 'toilet', label: 'Toilet', category: 'plumbing', sizeIn: 26,
    draw(ctx, r) {
      const tw = r * 1.1, th = r * 0.5;
      ctx.strokeRect(-tw / 2, -r * 0.9, tw, th);
      ctx.beginPath();
      ctx.ellipse(0, r * 0.25, r * 0.55, r * 0.62, 0, 0, Math.PI * 2);
      ctx.stroke();
    },
  },
  {
    key: 'bathtub', label: 'Bathtub', category: 'plumbing', sizeIn: 60,
    draw(ctx, r) {
      const w = r * 1.8, h = r * 1.1, rad = h * 0.4;
      ctx.beginPath();
      ctx.moveTo(-w / 2 + rad, -h / 2);
      ctx.arcTo( w / 2, -h / 2,  w / 2,  h / 2, rad);
      ctx.arcTo( w / 2,  h / 2, -w / 2,  h / 2, rad);
      ctx.arcTo(-w / 2,  h / 2, -w / 2, -h / 2, rad);
      ctx.arcTo(-w / 2, -h / 2,  w / 2, -h / 2, rad);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-w / 2 + rad * 1.1, 0, r * 0.08, 0, Math.PI * 2);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
    },
  },
  {
    key: 'shower', label: 'Shower', category: 'plumbing', sizeIn: 36,
    draw(ctx, r) {
      const s = r * 1.5;
      ctx.strokeRect(-s / 2, -s / 2, s, s);
      ctx.beginPath();
      ctx.moveTo(-s / 2, -s / 2); ctx.lineTo(s / 2, s / 2);
      ctx.moveTo(s / 2, -s / 2); ctx.lineTo(-s / 2, s / 2);
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2); ctx.fill();
    },
  },
  {
    key: 'water_heater', label: 'Water Heater', category: 'plumbing', sizeIn: 20,
    draw(ctx, r) {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = `bold ${r * 0.36}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('WH', 0, 0);
    },
  },
  {
    key: 'floor_drain', label: 'Floor Drain', category: 'plumbing', sizeIn: 4,
    draw(ctx, r) {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, -r * 0.4); ctx.lineTo(r * 0.4, r * 0.4);
      ctx.moveTo(r * 0.4, -r * 0.4); ctx.lineTo(-r * 0.4, r * 0.4);
      ctx.stroke();
    },
  },
  {
    key: 'shutoff_valve', label: 'Shutoff Valve', category: 'plumbing', sizeIn: 3,
    draw(ctx, r) {
      ctx.beginPath();
      ctx.moveTo(-r * 0.9, 0); ctx.lineTo(r * 0.9, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.35, -r * 0.35);
      ctx.lineTo( r * 0.35, -r * 0.35);
      ctx.lineTo(-r * 0.35,  r * 0.35);
      ctx.lineTo( r * 0.35,  r * 0.35);
      ctx.closePath();
      ctx.stroke();
    },
  },

  // ── Furniture ────────────────────────────────────────────────────────────────
  {
    key: 'bed', label: 'Bed', category: 'furniture', sizeIn: 80,
    draw(ctx, r) {
      const w = r * 1.5, h = r * 1.9;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      const pw = w * 0.38, ph = h * 0.22, gap = w * 0.06;
      ctx.strokeRect(-w / 2 + gap, -h / 2 + gap, pw, ph);
      ctx.strokeRect( w / 2 - gap - pw, -h / 2 + gap, pw, ph);
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h / 2 + ph + gap * 2); ctx.lineTo(w / 2, -h / 2 + ph + gap * 2);
      ctx.stroke();
    },
  },
  {
    key: 'sofa', label: 'Sofa', category: 'furniture', sizeIn: 84,
    draw(ctx, r) {
      const w = r * 1.9, h = r * 1.0;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      const arm = w * 0.14;
      ctx.strokeRect(-w / 2, -h / 2, arm, h);
      ctx.strokeRect( w / 2 - arm, -h / 2, arm, h);
      ctx.beginPath();
      ctx.moveTo(-w / 2 + arm, -h / 2 + h * 0.25); ctx.lineTo(w / 2 - arm, -h / 2 + h * 0.25);
      ctx.stroke();
    },
  },
  {
    key: 'table', label: 'Table', category: 'furniture', sizeIn: 60,
    draw(ctx, r) {
      const w = r * 1.7, h = r * 1.1;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
    },
  },
  {
    key: 'chair', label: 'Chair', category: 'furniture', sizeIn: 24,
    draw(ctx, r) {
      const s = r * 1.1;
      ctx.strokeRect(-s / 2, -s / 2, s, s);
      ctx.beginPath();
      ctx.arc(0, -s / 2, s / 2, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    },
  },
  {
    key: 'range', label: 'Range / Stove', category: 'furniture', sizeIn: 30,
    draw(ctx, r) {
      const w = r * 1.6, h = r * 1.6;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      const positions = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      positions.forEach(([sx, sy]) => {
        ctx.beginPath();
        ctx.arc(sx * w * 0.22, sy * h * 0.22, r * 0.2, 0, Math.PI * 2);
        ctx.stroke();
      });
    },
  },
  {
    key: 'fridge', label: 'Refrigerator', category: 'furniture', sizeIn: 34,
    draw(ctx, r) {
      const w = r * 1.4, h = r * 1.8;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h / 2 + h * 0.3); ctx.lineTo(w / 2, -h / 2 + h * 0.3);
      ctx.stroke();
    },
  },

  // ── Doors & Windows ────────────────────────────────────────────────────────────
  {
    key: 'door_single', label: 'Door (Single)', category: 'openings', sizeIn: 32,
    draw(ctx, r) {
      const w = r * 1.7;
      ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(-w / 2, -w); ctx.stroke();
      ctx.beginPath(); ctx.arc(-w / 2, 0, w, -Math.PI / 2, 0); ctx.stroke();
    },
  },
  {
    key: 'door_double', label: 'Door (Double)', category: 'openings', sizeIn: 64,
    draw(ctx, r) {
      const w = r * 1.8, half = w / 2;
      ctx.beginPath(); ctx.moveTo(-half, 0); ctx.lineTo(half, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-half, 0); ctx.lineTo(-half, -half); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(half, 0); ctx.lineTo(half, -half); ctx.stroke();
      ctx.beginPath(); ctx.arc(-half, 0, half, -Math.PI / 2, 0); ctx.stroke();
      ctx.beginPath(); ctx.arc(half, 0, half, -Math.PI, -Math.PI / 2); ctx.stroke();
    },
  },
  {
    key: 'door_sliding', label: 'Door (Sliding)', category: 'openings', sizeIn: 72,
    draw(ctx, r) {
      const w = r * 1.8;
      ctx.beginPath();
      ctx.moveTo(-w / 2, -r * 0.12); ctx.lineTo(w / 2, -r * 0.12);
      ctx.moveTo(-w / 2, r * 0.12);  ctx.lineTo(w / 2, r * 0.12);
      ctx.stroke();
      ctx.save();
      ctx.lineWidth = ctx.lineWidth * 2.2;
      ctx.beginPath();
      ctx.moveTo(-w * 0.05, -r * 0.12); ctx.lineTo(w * 0.5, -r * 0.12);
      ctx.stroke();
      ctx.restore();
    },
  },
  {
    key: 'window', label: 'Window', category: 'openings', sizeIn: 36,
    draw(ctx, r) {
      const w = r * 1.9, h = r * 0.55;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.beginPath();
      ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0);
      ctx.stroke();
    },
  },
];
