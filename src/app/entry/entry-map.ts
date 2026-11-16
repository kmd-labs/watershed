import { SEA_IDS, SeaId } from '../core/sea';

/** River size classes on the entry map (HydroRIVERS mean flow: 2 ≥ 10, 3 ≥ 100, 4 ≥ 1000 m³/s). */
const CLASSES = ['2', '3', '4'] as const;
type RiverClass = (typeof CLASSES)[number];

/** src/assets/data/seas-map.json (scripts/build-seas-map.py). */
export interface SeasMap {
  basins: Record<SeaId, { rings: [number, number][][]; area: number; mouths: number; pop: number | null }>;
  land: [number, number][][];
  lakes: [number, number][][];
  /** Per sea and class: lines as flat integers in 0.01°, first point then differences. */
  rivers: Record<SeaId, Record<RiverClass, number[][]>>;
}

export type Rgb = [number, number, number];

/** A look of the map, from the design tokens (`--color-entry-*`). */
export interface EntryStyle {
  /** Midnight: rivers glow on a night ground; otherwise fine ink lines on paper. */
  night: boolean;
  sea: Rgb;
  land: Rgb;
  ink: Rgb;
  seas: Record<SeaId, Rgb>;
  font: string;
}

/** The space the map must leave free for the panels around it (CSS px). */
export interface Insets { top: number; right: number; bottom: number; left: number }

/** Where the map sits: scale (CSS px per orthographic unit) and the box's top-left corner. Two
 * fits differ by a uniform scale and a shift, so one can be animated into the other with a CSS
 * transform of the drawn canvas. */
export interface Fit { k: number; ox: number; oy: number }

export interface RenderOptions {
  /** Sea under the pointer (index in SEA_IDS), or −1. */
  hot?: number;
  /** Sea names on the water (in SEA_IDS order), or none. */
  names?: string[];
  /** What to draw: everything, the map without its glow, or the glow alone (on transparent). */
  layer?: 'all' | 'base' | 'glow';
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

const WHITE: Rgb = [255, 255, 255];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: Rgb, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

/** The colour as a neon tube: full saturation, bright. */
export function neon(c: Rgb): Rgb {
  const [r, g, b] = c.map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  if (max !== min) {
    const d = max - min;
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  const l = Math.min(0.68, Math.max(0.6, (max + min) / 2 + 0.12)), s = 1;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const ch = (t: number) => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  return [ch(h + 1 / 3) * 255, ch(h) * 255, ch(h - 1 / 3) * 255];
}

/** Canvas `filter` (blur) support; without it the glow is built from downscaled copies. */
const FILTER_OK = (() => {
  if (typeof document === 'undefined') return false;
  const x = document.createElement('canvas').getContext('2d');
  if (!x || !('filter' in x)) return false;
  x.filter = 'blur(2px)';
  return x.filter === 'blur(2px)';
})();

/** Line widths per class (× scale) and opacities, per look. */
const WIDTH: Record<'night' | 'paper', Record<RiverClass, number>> = {
  night: { '2': 0.55, '3': 1.0, '4': 1.7 },
  paper: { '2': 0.5, '3': 0.9, '4': 1.5 }
};
const ALPHA: Record<'night' | 'paper', Record<RiverClass, number>> = {
  night: { '2': 0.6, '3': 0.9, '4': 1 },
  paper: { '2': 0.75, '3': 0.92, '4': 1 }
};
/** Glow: blur radius (× scale) and strength of each pass, tight to wide. */
const GLOW: [number, number][] = [[1, 0.85], [3, 0.55], [8, 0.36], [20, 0.24], [44, 0.14]];

/**
 * The entry map: Europe with the five seas' drainage basins and their rivers (≥ 10 m³/s) —
 * neon veins on a night-blue map (Midnight) or fine coloured ink on paper (White & Classy).
 * Hit testing: the basin under the pointer, or on water the sea whose basin's coast is nearest.
 */
export class EntryMap {
  private readonly box: [number, number, number, number];
  /** Rivers in lon/lat, per sea and class. */
  private readonly lines: Record<SeaId, Record<RiverClass, Float32Array[]>>;
  private paths?: {
    land: Path2D;
    lakes: Path2D;
    basins: Path2D[];
    rivers: Record<RiverClass, Path2D>[];
  };
  private P: (lon: number, lat: number) => [number, number] = () => [0, 0];
  private W = 0;
  private H = 0;
  private dpr = 1;
  private mapW = 0;
  private frame = { cx: 0, cy: 0, rx: 1, ry: 1 };
  private pickGrid?: { w: number; h: number; s: number; id: Int8Array };
  /** Per-sea glow (half resolution), built on first use after a layout or with other colours. */
  private glow: (HTMLCanvasElement | null)[] = [];
  private glowKey = '';

  constructor(private readonly geo: SeasMap) {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const s of SEA_IDS) for (const r of geo.basins[s].rings) for (const [lon, lat] of r) {
      const [u, v] = ortho(lon, lat);
      x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v);
    }
    const px = (x1 - x0) * 0.04, py = (y1 - y0) * 0.04;
    this.box = [x0 - px, x1 + px, y0 - py, y1 + py];
    this.lines = {} as Record<SeaId, Record<RiverClass, Float32Array[]>>;
    for (const s of SEA_IDS) {
      const per = {} as Record<RiverClass, Float32Array[]>;
      for (const c of CLASSES) {
        per[c] = (geo.rivers[s]?.[c] ?? []).map(d => {
          const out = new Float32Array(d.length);
          let x = 0, y = 0;
          for (let i = 0; i < d.length; i += 2) {
            x += d[i]; y += d[i + 1];
            out[i] = x / 100; out[i + 1] = y / 100;
          }
          return out;
        });
      }
      this.lines[s] = per;
    }
  }

  /** Width of the drawn basins in CSS px. */
  get width() {
    return this.mapW;
  }

  /**
   * Fits the basins into the free part of a `w × h` CSS-px canvas, × `zoom` around its centre.
   * `pick` builds the hit-test grid (the interactive map only).
   */
  /** Scale and offset (CSS px) that fit the basins into the free part of a `w × h` canvas. */
  fit(w: number, h: number, inset: Insets, zoom = 1): Fit {
    const [x0, x1, y0, y1] = this.box;
    const aw = Math.max(80, w - inset.left - inset.right), ah = Math.max(80, h - inset.top - inset.bottom);
    const k = Math.min(aw / (x1 - x0), ah / (y1 - y0)) * zoom;
    return { k, ox: inset.left + (aw - k * (x1 - x0)) / 2, oy: inset.top + (ah - k * (y1 - y0)) / 2 };
  }

  /** The current fit (see layout). */
  get current(): Fit {
    return this.fitNow;
  }

  private fitNow: Fit = { k: 1, ox: 0, oy: 0 };

  layout(w: number, h: number, dpr: number, inset: Insets, zoom = 1, pick = true) {
    const [x0, x1, y0, y1] = this.box;
    const { k, ox, oy } = (this.fitNow = this.fit(w, h, inset, zoom));
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
        const per = {} as Record<RiverClass, Path2D>;
        for (const c of CLASSES) {
          const p = new Path2D();
          for (const ln of this.lines[s][c]) {
            for (let i = 0; i < ln.length; i += 2) {
              const [a, b] = this.P(ln[i], ln[i + 1]);
              i ? p.lineTo(a, b) : p.moveTo(a, b);
            }
          }
          per[c] = p;
        }
        return per;
      })
    };
    this.glow = [];
    if (pick) this.buildPick();
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

  /** Line-width scale: device px per unit, following the map's size. */
  private get scale() {
    return this.dpr * Math.min(1.4, Math.max(0.75, this.mapW / 900));
  }

  /** Draws the map into a canvas of the laid-out size. */
  render(x: CanvasRenderingContext2D, st: EntryStyle, o: RenderOptions = {}) {
    const p = this.paths;
    if (!p) return;
    const hot = o.hot ?? -1, layer = o.layer ?? 'all';
    const W = this.W * this.dpr, H = this.H * this.dpr, scale = this.scale;
    const look = st.night ? 'night' : 'paper';
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, W, H);

    if (layer === 'glow') {
      if (st.night) this.drawGlow(x, st, hot);
      return;
    }

    x.fillStyle = css(st.sea); x.fillRect(0, 0, W, H);
    x.fillStyle = css(st.land); x.fill(p.land, 'evenodd');
    x.fillStyle = css(st.sea); x.fill(p.lakes, 'evenodd');

    // Basins: a whisper of their sea's colour and a fine outline; the one pointed at stronger.
    x.lineJoin = 'round';
    SEA_IDS.forEach((s, i) => {
      const on = hot === i, dim = hot >= 0 && !on;
      const c = st.night ? neon(st.seas[s]) : st.seas[s];
      x.fillStyle = css(c, st.night ? (on ? 0.09 : dim ? 0.02 : 0.045) : on ? 0.16 : dim ? 0.04 : 0.08);
      x.fill(p.basins[i], 'evenodd');
      x.strokeStyle = css(c, st.night ? (on ? 0.55 : dim ? 0.1 : 0.2) : on ? 0.7 : dim ? 0.15 : 0.3);
      x.lineWidth = (on ? 1.1 : 0.7) * scale;
      x.stroke(p.basins[i]);
    });

    if (st.night && layer === 'all') this.drawGlow(x, st, hot);

    // Rivers: crisp lines, smallest first; at night the large ones get a white-hot core.
    x.lineCap = 'round';
    x.lineJoin = 'round';
    for (const c of CLASSES) {
      SEA_IDS.forEach((s, i) => {
        const on = hot === i, dim = hot >= 0 && !on;
        const base = st.night ? mix(neon(st.seas[s]), WHITE, c === '4' ? 0.3 : c === '3' ? 0.15 : 0) : mix(st.seas[s], st.ink, 0.42);
        x.globalCompositeOperation = 'source-over';
        x.strokeStyle = css(base, ALPHA[look][c] * (dim ? 0.3 : 1));
        x.lineWidth = WIDTH[look][c] * scale * (on ? 1.2 : 1);
        x.stroke(p.rivers[i][c]);
        if (st.night && c !== '2' && !dim) {
          x.globalCompositeOperation = 'lighter';
          x.strokeStyle = css(mix(neon(st.seas[s]), WHITE, 0.8), c === '4' ? 0.75 : 0.45);
          x.lineWidth = WIDTH.night[c] * scale * 0.4;
          x.stroke(p.rivers[i][c]);
        }
      });
    }
    x.globalCompositeOperation = 'source-over';

    // The map fades out in an ellipse around the basins (the land data ends further out).
    const f = this.frame, rx = f.rx * 1.3, ry = f.ry * 1.5;
    x.save();
    x.translate(f.cx, f.cy);
    x.scale(1, ry / rx);
    const v = x.createRadialGradient(0, 0, rx * 0.68, 0, 0, rx);
    v.addColorStop(0, css(st.sea, 0));
    v.addColorStop(0.55, css(st.sea, 0.6));
    v.addColorStop(1, css(st.sea, 1));
    x.fillStyle = v;
    x.fillRect(-W * 2, (-H * 2 * rx) / ry, W * 4, (H * 4 * rx) / ry);
    x.restore();

    if (o.names) this.drawNames(x, st, hot, o.names);
  }

  /** The glow of every sea's rivers (cached per sea), dimmed around the one pointed at. */
  private drawGlow(x: CanvasRenderingContext2D, st: EntryStyle, hot: number) {
    const key = SEA_IDS.map(s => st.seas[s].join()).join('|');
    if (key !== this.glowKey) {
      this.glow = [];
      this.glowKey = key;
    }
    const W = this.W * this.dpr, H = this.H * this.dpr;
    x.save();
    x.globalCompositeOperation = 'lighter';
    SEA_IDS.forEach((s, i) => {
      const g = (this.glow[i] ??= this.buildGlow(st, i));
      const on = hot === i, dim = hot >= 0 && !on;
      x.globalAlpha = dim ? 0.18 : 1;
      x.drawImage(g, 0, 0, W, H);
      // The sea pointed at burns brighter.
      if (on) {
        x.globalAlpha = 0.6;
        x.drawImage(g, 0, 0, W, H);
      }
    });
    x.restore();
  }

  /** One sea's glow: its rivers in neon at half resolution, blurred at several radii and added up. */
  private buildGlow(st: EntryStyle, i: number): HTMLCanvasElement {
    const p = this.paths!;
    const W = this.W * this.dpr, H = this.H * this.dpr;
    const gw = Math.max(1, Math.ceil(W / 2)), gh = Math.max(1, Math.ceil(H / 2));
    const k = 0.5, scale = this.scale;
    const src = document.createElement('canvas');
    src.width = gw; src.height = gh;
    const sx = src.getContext('2d')!;
    sx.setTransform(k, 0, 0, k, 0, 0);
    sx.lineCap = 'round';
    sx.lineJoin = 'round';
    const c = neon(st.seas[SEA_IDS[i]]);
    for (const cl of CLASSES) {
      // The many small rivers glow faintly, or the dense networks would melt into one field.
      sx.strokeStyle = css(c, cl === '2' ? 0.3 : cl === '3' ? 0.75 : 1);
      // At least one half-resolution pixel wide, so the thin streams still feed the glow.
      sx.lineWidth = Math.max(2, WIDTH.night[cl] * scale);
      sx.stroke(p.rivers[i][cl]);
    }
    const out = document.createElement('canvas');
    out.width = gw; out.height = gh;
    const ox = out.getContext('2d')!;
    ox.globalCompositeOperation = 'lighter';
    // Radii in half-resolution px: the map's line scale, halved.
    const unit = (scale * k) / Math.max(1, this.dpr / 1.5);
    for (const [r, a] of GLOW) {
      const rad = r * unit;
      ox.globalAlpha = a;
      if (FILTER_OK) {
        ox.filter = `blur(${rad.toFixed(2)}px)`;
        ox.drawImage(src, 0, 0);
      } else {
        // No canvas blur: shrink and stretch back (bilinear) for a soft spread of about `rad`.
        const f = Math.max(1, rad / 1.5), tw = Math.max(1, Math.round(gw / f)), th = Math.max(1, Math.round(gh / f));
        const t = document.createElement('canvas');
        t.width = tw; t.height = th;
        const tx = t.getContext('2d')!;
        tx.imageSmoothingQuality = 'high';
        tx.drawImage(src, 0, 0, tw, th);
        ox.imageSmoothingQuality = 'high';
        ox.drawImage(t, 0, 0, gw, gh);
      }
    }
    ox.filter = 'none';
    return out;
  }

  /**
   * Names on the water: spaced italic caps, the last word on a second line ("Morze / Bałtyckie"),
   * neon signs at night; names that would overlap on a small map are moved apart vertically.
   */
  private drawNames(x: CanvasRenderingContext2D, st: EntryStyle, hot: number, names: string[]) {
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    const size = Math.max(7.5, Math.min(12.5, this.mapW / 50)) * this.dpr;
    const spacing = size * 0.2;
    const labels = SEA_IDS.map((s, i) => {
      const [a, b] = this.P(...LABEL_AT[s]);
      const words = (names[i] ?? '').toUpperCase().split(' ');
      const lines = words.length > 1 ? [words.slice(0, -1).join(' '), words[words.length - 1]] : words;
      x.font = `italic 500 ${size}px ${st.font}`;
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
      const c = st.night ? neon(st.seas[L.s]) : st.seas[L.s];
      x.globalAlpha = hot < 0 || hot === L.i ? 1 : 0.45;
      x.font = `italic ${hot === L.i ? 600 : 500} ${size}px ${st.font}`;
      x.letterSpacing = `${spacing}px`;
      if (st.night) {
        x.shadowColor = css(c, 0.9);
        x.shadowBlur = size * (hot === L.i ? 1.1 : 0.7);
        x.fillStyle = css(mix(c, WHITE, 0.7));
      } else {
        x.fillStyle = css(mix(c, st.ink, 0.45));
      }
      L.lines.forEach((ln, k) => x.fillText(ln, L.a, L.b + (k - (L.lines.length - 1) / 2) * size * 1.25));
      x.shadowBlur = 0;
      x.shadowColor = 'transparent';
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
