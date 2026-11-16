import { SEA_IDS, SeaId } from '../core/sea';

/** src/assets/data/seas-map.json (scripts/build-seas-map.py): lon/lat rings and lines. */
export interface SeasMap {
  basins: Record<SeaId, { rings: [number, number][][]; area: number; mouths: number; pop: number | null }>;
  land: [number, number][][];
  lakes: [number, number][][];
  rivers: Record<SeaId, { w: number; p: [number, number][] }[]>;
}

export type Rgb = [number, number, number];

/** Colours from the design tokens (`--color-entry-*`), font, and which look is on. */
export interface EntryPalette {
  sea: Rgb;
  land: Rgb;
  seas: Record<SeaId, Rgb>;
  ink: Rgb;
  night: boolean;
  font: string;
}

/** Where each sea's name sits (lon, lat): on its water. */
const LABEL_AT: Record<SeaId, [number, number]> = {
  baltic: [19.6, 57.6],
  north: [3.2, 56.2],
  med: [17.2, 35.3],
  black: [34.2, 43.3],
  caspian: [50.9, 42.3]
};

const DEG = Math.PI / 180;
/** Orthographic view centred on Europe. */
const L0 = 23 * DEG, P0 = 47 * DEG;
const ortho = (lon: number, lat: number): [number, number] => {
  const l = lon * DEG - L0, p = lat * DEG;
  return [Math.cos(p) * Math.sin(l), Math.cos(P0) * Math.sin(p) - Math.sin(P0) * Math.cos(p) * Math.cos(l)];
};

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: Rgb, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const WHITE: Rgb = [255, 255, 255];

/** The space the map must leave free for the panels around it (CSS px). */
export interface Insets { top: number; right: number; bottom: number; left: number }

/**
 * The entry map: Europe with the five seas' drainage basins and their main rivers — glowing
 * veins on a night-blue map (Midnight), or fine coloured lines on a pale one (White & Classy).
 * Hit testing: the basin under the pointer, or on water the sea whose basin's coast is nearest.
 */
export class EntryMap {
  private readonly box: [number, number, number, number];
  private paths?: {
    land: Path2D;
    lakes: Path2D;
    basins: Path2D[];
    /** Rivers grouped by line weight, per sea (one stroke per group). */
    rivers: { w: number; path: Path2D }[][];
  };
  private P: (lon: number, lat: number) => [number, number] = () => [0, 0];
  private W = 0;
  private H = 0;
  private dpr = 1;
  private mapW = 0;
  /** The basins' frame (device px): centre and half sizes. */
  private frame = { cx: 0, cy: 0, rx: 1, ry: 1 };
  private pickGrid?: { w: number; h: number; s: number; id: Int8Array };

  constructor(private readonly geo: SeasMap) {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const s of SEA_IDS) for (const r of geo.basins[s].rings) for (const [lon, lat] of r) {
      const [u, v] = ortho(lon, lat);
      x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v);
    }
    const px = (x1 - x0) * 0.04, py = (y1 - y0) * 0.04;
    this.box = [x0 - px, x1 + px, y0 - py, y1 + py];
  }

  /** Fits the basins into the free part of a `w × h` CSS-px canvas. */
  layout(w: number, h: number, dpr: number, inset: Insets) {
    const [x0, x1, y0, y1] = this.box;
    const aw = Math.max(80, w - inset.left - inset.right), ah = Math.max(80, h - inset.top - inset.bottom);
    const k = Math.min(aw / (x1 - x0), ah / (y1 - y0));
    const ox = inset.left + (aw - k * (x1 - x0)) / 2, oy = inset.top + (ah - k * (y1 - y0)) / 2;
    this.W = w; this.H = h; this.dpr = dpr; this.mapW = k * (x1 - x0);
    this.frame = {
      cx: (ox + (k * (x1 - x0)) / 2) * dpr,
      cy: (oy + (k * (y1 - y0)) / 2) * dpr,
      rx: ((k * (x1 - x0)) / 2) * dpr,
      ry: ((k * (y1 - y0)) / 2) * dpr
    };
    this.P = (lon, lat) => {
      const [u, v] = ortho(lon, lat);
      return [(ox + (u - x0) * k) * dpr, (oy + (y1 - v) * k) * dpr];
    };
    const rings = (rs: [number, number][][]) => {
      const p = new Path2D();
      for (const r of rs) {
        r.forEach(([lon, lat], i) => { const [a, b] = this.P(lon, lat); i ? p.lineTo(a, b) : p.moveTo(a, b); });
        p.closePath();
      }
      return p;
    };
    const g = this.geo;
    this.paths = {
      land: rings(g.land),
      lakes: rings(g.lakes),
      basins: SEA_IDS.map(s => rings(g.basins[s].rings)),
      rivers: SEA_IDS.map(s => {
        const by = new Map<number, Path2D>();
        for (const r of g.rivers[s]) {
          const p = by.get(r.w) ?? new Path2D();
          r.p.forEach(([lon, lat], i) => { const [a, b] = this.P(lon, lat); i ? p.lineTo(a, b) : p.moveTo(a, b); });
          by.set(r.w, p);
        }
        return [...by].map(([w, path]) => ({ w, path }));
      })
    };
    this.buildPick();
  }

  /** Hit-test grid at half CSS resolution: basin ids on land, the nearest basin's id on water. */
  private buildPick() {
    const s = 0.5, w = Math.max(1, Math.round(this.W * s)), h = Math.max(1, Math.round(this.H * s));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    const f = s / this.dpr;
    // One mask per shape, thresholded: colour-coded ids would blend along anti-aliased edges.
    const mask = (p: Path2D) => {
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.fillStyle = '#000';
      x.fillRect(0, 0, w, h);
      x.setTransform(f, 0, 0, f, 0, 0);
      x.fillStyle = '#fff';
      x.fill(p, 'evenodd');
      return x.getImageData(0, 0, w, h).data;
    };
    const N = w * h, id = new Int8Array(N).fill(-1), land = new Uint8Array(N), dist = new Float32Array(N);
    const lp = mask(this.paths!.land);
    for (let i = 0; i < N; i++) land[i] = lp[i * 4] > 127 ? 1 : 0;
    this.paths!.basins.forEach((p, b) => {
      const m = mask(p);
      for (let i = 0; i < N; i++) if (m[i * 4] > 127) { id[i] = b; land[i] = 1; }
    });
    for (let i = 0; i < N; i++) dist[i] = land[i] ? 0 : 1e9;
    // Water: the id of the nearest land (two-pass chamfer); far from any basin's coast, nothing.
    const relax = (i: number, j: number, wgt: number) => { if (dist[j] + wgt < dist[i]) { dist[i] = dist[j] + wgt; id[i] = id[j]; } };
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
      const i = y * w + xx;
      if (land[i]) continue;
      if (xx > 0) relax(i, i - 1, 1);
      if (y > 0) { relax(i, i - w, 1); if (xx > 0) relax(i, i - w - 1, 1.414); if (xx < w - 1) relax(i, i - w + 1, 1.414); }
    }
    for (let y = h - 1; y >= 0; y--) for (let xx = w - 1; xx >= 0; xx--) {
      const i = y * w + xx;
      if (land[i]) continue;
      if (xx < w - 1) relax(i, i + 1, 1);
      if (y < h - 1) { relax(i, i + w, 1); if (xx < w - 1) relax(i, i + w + 1, 1.414); if (xx > 0) relax(i, i + w - 1, 1.414); }
    }
    const reach = this.mapW * s * 0.12;
    for (let i = 0; i < N; i++) if (!land[i] && dist[i] > reach) id[i] = -1;
    this.pickGrid = { w, h, s, id };
  }

  /** The sea (index in SEA_IDS) at a CSS-px point, or −1. */
  pick(x: number, y: number): number {
    const g = this.pickGrid;
    if (!g) return -1;
    const gx = Math.round(x * g.s), gy = Math.round(y * g.s);
    if (gx < 0 || gy < 0 || gx >= g.w || gy >= g.h) return -1;
    return g.id[gy * g.w + gx];
  }

  /** Draws the map; `hot` = sea under the pointer, `sel` = the open (or last) sea; −1 = none. */
  draw(x: CanvasRenderingContext2D, pal: EntryPalette, hot: number, sel: number, names: string[]) {
    const p = this.paths;
    if (!p) return;
    const W = this.W * this.dpr, H = this.H * this.dpr;
    const scale = this.dpr * Math.min(1.3, Math.max(0.7, this.mapW / 900));
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.fillStyle = css(pal.sea); x.fillRect(0, 0, W, H);
    x.fillStyle = css(pal.land); x.fill(p.land, 'evenodd');
    x.fillStyle = css(pal.sea); x.fill(p.lakes, 'evenodd');

    // Basins: a tint of their sea's colour and a fine outline; the one in focus stronger.
    SEA_IDS.forEach((s, i) => {
      const on = hot === i, dim = hot >= 0 && !on;
      x.fillStyle = css(pal.seas[s], on ? 0.22 : dim ? 0.05 : sel === i ? 0.15 : 0.1);
      x.fill(p.basins[i], 'evenodd');
      x.strokeStyle = css(pal.seas[s], on ? 0.75 : dim ? 0.18 : 0.3);
      x.lineWidth = (on ? 1.1 : 0.8) * scale;
      x.lineJoin = 'round';
      x.stroke(p.basins[i]);
    });

    // Rivers: glowing veins at night, fine coloured lines on the pale map.
    x.lineCap = 'round';
    x.lineJoin = 'round';
    SEA_IDS.forEach((s, i) => {
      const on = hot === i, dim = hot >= 0 && !on, c = pal.seas[s];
      const line = pal.night ? mix(c, WHITE, 0.35) : mix(c, pal.ink, 0.25);
      if (pal.night) {
        x.shadowColor = css(c, dim ? 0 : 0.9);
        x.shadowBlur = (on ? 10 : 6) * scale;
      }
      x.strokeStyle = css(line, dim ? 0.35 : on ? 1 : 0.85);
      for (const r of p.rivers[i]) {
        x.lineWidth = (0.35 + r.w * (on ? 0.32 : 0.24)) * scale;
        x.stroke(r.path);
      }
    });
    x.shadowBlur = 0;
    x.shadowColor = 'transparent';

    // The map fades out in an ellipse around the basins (the land data ends further out), and at
    // the canvas edges.
    const f = this.frame, rx = f.rx * 1.3, ry = f.ry * 1.5;
    x.save();
    x.translate(f.cx, f.cy);
    x.scale(1, ry / rx);
    const v = x.createRadialGradient(0, 0, rx * 0.68, 0, 0, rx);
    v.addColorStop(0, css(pal.sea, 0));
    v.addColorStop(0.55, css(pal.sea, 0.6));
    v.addColorStop(1, css(pal.sea, 1));
    x.fillStyle = v;
    x.fillRect(-W * 2, (-H * 2 * rx) / ry, W * 4, (H * 4 * rx) / ry);
    x.restore();
    const fade = Math.min(W, H) * 0.08;
    const edge = (g: CanvasGradient) => { g.addColorStop(0, css(pal.sea, 1)); g.addColorStop(1, css(pal.sea, 0)); return g; };
    x.fillStyle = edge(x.createLinearGradient(0, 0, fade, 0)); x.fillRect(0, 0, fade, H);
    x.fillStyle = edge(x.createLinearGradient(W, 0, W - fade, 0)); x.fillRect(W - fade, 0, fade, H);
    x.fillStyle = edge(x.createLinearGradient(0, 0, 0, fade)); x.fillRect(0, 0, W, fade);
    x.fillStyle = edge(x.createLinearGradient(0, H, 0, H - fade)); x.fillRect(0, H - fade, W, fade);

    // Names on the water: spaced italic caps; the last word on a second line ("Morze / Bałtyckie").
    // On a small map, names that would overlap are moved apart vertically.
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    const size = Math.max(7.5, Math.min(12, this.mapW / 50)) * this.dpr;
    const spacing = size * 0.2;
    const labels = SEA_IDS.map((s, i) => {
      const [a, b] = this.P(...LABEL_AT[s]);
      const words = (names[i] ?? '').toUpperCase().split(' ');
      const lines = words.length > 1 ? [words.slice(0, -1).join(' '), words[words.length - 1]] : words;
      x.font = `italic 500 ${size}px ${pal.font}`;
      x.letterSpacing = `${spacing}px`;
      const w = Math.max(...lines.map(l => x.measureText(l).width));
      return { s, i, a, b, lines, w, h: lines.length * size * 1.25 };
    });
    for (let pass = 0; pass < 4; pass++) {
      for (const p of labels) for (const q of labels) {
        if (p.i >= q.i) continue;
        const ox = (p.w + q.w) / 2 - Math.abs(p.a - q.a), oy = (p.h + q.h) / 2 + 2 * this.dpr - Math.abs(p.b - q.b);
        if (ox <= 0 || oy <= 0) continue;
        const d = oy / 2, up = p.b <= q.b ? p : q, down = up === p ? q : p;
        up.b -= d;
        down.b += d;
      }
    }
    for (const L of labels) {
      x.fillStyle = css(pal.night ? mix(pal.seas[L.s], WHITE, 0.6) : mix(pal.seas[L.s], pal.ink, 0.45));
      x.globalAlpha = hot < 0 || hot === L.i ? 1 : 0.5;
      x.font = `italic ${hot === L.i ? 500 : 400} ${size}px ${pal.font}`;
      x.letterSpacing = `${spacing}px`;
      L.lines.forEach((ln, k) => x.fillText(ln, L.a, L.b + (k - (L.lines.length - 1) / 2) * size * 1.25));
    }
    x.globalAlpha = 1;
    x.letterSpacing = '0px';
  }
}

/** `#rrggbb` or `rgb(a)()` → [r, g, b]. */
export function parseRgb(v: string, fallback: Rgb): Rgb {
  const s = v.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (m) {
    const [r, g, b] = m[1].split(/[ ,/]+/).map(Number);
    if ([r, g, b].every(Number.isFinite)) return [r, g, b];
  }
  return fallback;
}
