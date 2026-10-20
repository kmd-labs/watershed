import { Injectable, signal } from '@angular/core';

/** `oxygenChange` paints change categories (see `OXYGEN_CHANGE`) instead of oxygen classes. */
export type SeaLayer = 'none' | 'oxygen' | 'oxygenChange' | 'cyano';

/** Regular lon/lat grid over the sea; NaN = no data (land or outside the analysis). */
export interface SeaGrid {
  lat0: number;
  lon0: number;
  d: number;
  nlat: number;
  nlon: number;
  values: Float32Array;
  /** Free-form period metadata from the asset (e.g. "2020-10" or "1998–2024"). */
  window: string;
  source: string;
  /** Extra numbers shipped with the asset (e.g. year range used). */
  meta: Record<string, number>;
}

interface RawSeaGrid {
  lat0: number;
  lon0: number;
  d: number;
  nlat: number;
  nlon: number;
  noData: number;
  window: string;
  source: string;
  /** Int16 (oxygen, µmol/l) or Uint8 (cyano, %) little-endian base64. */
  values: string;
  dtype?: 'int16' | 'uint8';
  scale?: number;
  meta?: Record<string, number>;
}

/** µmol/l per ml/l of dissolved O₂. */
export const UMOL_PER_ML = 44.66;

/** Near-bottom oxygen thresholds (µmol/l): anoxia ≈ < 0.2 ml/l, hypoxia < 2 ml/l. */
export const OXYGEN_THRESHOLDS = { anoxic: 0.2 * UMOL_PER_ML, hypoxic: 2 * UMOL_PER_ML };
export const OXYGEN_TOKENS = { anoxic: 'purple-600', hypoxic: 'purple-400' };

export function oxygenClass(v: number): 'anoxic' | 'hypoxic' | null {
  if (Number.isNaN(v)) return null;
  if (v < OXYGEN_THRESHOLDS.anoxic) return 'anoxic';
  if (v < OXYGEN_THRESHOLDS.hypoxic) return 'hypoxic';
  return null;
}

/** Change categories vs the baseline years: 1 persistent hypoxia, 2 new hypoxia, 3 recovered. */
export const OXYGEN_CHANGE = { persistent: 1, appeared: 2, recovered: 3 } as const;
export const OXYGEN_CHANGE_TOKENS: Record<number, string> = { 1: 'purple-400', 2: 'warning-500', 3: 'info-300' };
/** Baseline for the change view: mean state of the 1960s (6-year windows centred 1961–1970). */
export const OXYGEN_BASELINE = { from: 1961, to: 1970 };

/** Autumn near-bottom oxygen, one grid per year. */
export interface OxygenSeries {
  years: number[];
  frames: SeaGrid[];
  /** Hypoxic / anoxic seabed area per year, km². */
  hypoxic: number[];
  anoxic: number[];
}

/** Grid of change categories between the baseline decade and `year` (hypoxia threshold). */
export function oxygenChangeGrid(s: OxygenSeries, year: number): SeaGrid {
  const cur = s.frames[s.years.indexOf(year)];
  const base = s.frames.filter((_, i) => s.years[i] >= OXYGEN_BASELINE.from && s.years[i] <= OXYGEN_BASELINE.to);
  const values = new Float32Array(cur.values.length).fill(NaN);
  for (let k = 0; k < values.length; k++) {
    const v = cur.values[k];
    if (Number.isNaN(v)) continue;
    // A cell counts as hypoxic in the baseline when it was hypoxic in at least half of its years.
    let n = 0, hyp = 0;
    for (const b of base) {
      const bv = b.values[k];
      if (Number.isNaN(bv)) continue;
      n++;
      if (bv < OXYGEN_THRESHOLDS.hypoxic) hyp++;
    }
    const was = n > 0 && hyp * 2 >= n;
    const is = v < OXYGEN_THRESHOLDS.hypoxic;
    values[k] = was && is ? OXYGEN_CHANGE.persistent : is ? OXYGEN_CHANGE.appeared : was ? OXYGEN_CHANGE.recovered : 0;
  }
  return { ...cur, values };
}

/** Bloom probability classes (0–1) and their single-hue ramp. */
export const CYANO_BREAKS = [0.1, 0.25, 0.4, 0.55, 0.7];
export const CYANO_TOKENS = ['info-100', 'info-200', 'info-300', 'info-400', 'info-600', 'info-800'];

export function cyanoClass(p: number): number {
  if (Number.isNaN(p) || p <= 0) return -1;
  let k = 0;
  while (k < CYANO_BREAKS.length && p >= CYANO_BREAKS[k]) k++;
  return k;
}

export function gridValueAt(g: SeaGrid, lon: number, lat: number): number {
  const i = Math.round((lat - g.lat0) / g.d), j = Math.round((lon - g.lon0) / g.d);
  if (i < 0 || j < 0 || i >= g.nlat || j >= g.nlon) return NaN;
  return g.values[i * g.nlon + j];
}

/** Sea area (km²) of cells matching a predicate. */
export function gridArea(g: SeaGrid, pred: (v: number) => boolean): number {
  let a = 0;
  const cellLat = g.d * 111.32;
  for (let i = 0; i < g.nlat; i++) {
    const cellKm2 = cellLat * g.d * 111.32 * Math.cos(((g.lat0 + i * g.d) * Math.PI) / 180);
    for (let j = 0; j < g.nlon; j++) {
      const v = g.values[i * g.nlon + j];
      if (!Number.isNaN(v) && pred(v)) a += cellKm2;
    }
  }
  return a;
}

/** Lazily loads the sea overlay grids (`assets/data/oxygen.json`, `assets/data/cyano.json`). */
@Injectable({ providedIn: 'root' })
export class SeaLayersService {
  readonly oxygen = signal<OxygenSeries | null>(null);
  readonly cyano = signal<SeaGrid | null>(null);
  /** True once a load attempt finished without data (e.g. asset not generated yet). */
  readonly cyanoMissing = signal(false);
  /** Whether the optional cyanobacteria asset is deployed (probed once at startup). */
  readonly cyanoAvailable = signal(false);

  private started = new Set<SeaLayer>();

  constructor() {
    fetch('assets/data/cyano.json', { method: 'HEAD' })
      .then(r => this.cyanoAvailable.set(r.ok))
      .catch(() => this.cyanoAvailable.set(false));
  }

  ensure(layer: SeaLayer) {
    const asset = layer === 'oxygenChange' ? 'oxygen' : layer;
    if (asset === 'none' || this.started.has(asset)) return;
    this.started.add(asset);
    this.load(asset);
  }

  private async load(layer: 'oxygen' | 'cyano') {
    try {
      const res = await fetch(`assets/data/${layer}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      if (layer === 'oxygen') this.oxygen.set(decodeSeries(raw));
      else this.cyano.set(decodeGrid(raw));
    } catch (err) {
      console.warn(`Sea layer "${layer}" unavailable`, err);
      if (layer === 'cyano') this.cyanoMissing.set(true);
    }
  }
}

interface RawOxygenSeries {
  lat0: number;
  lon0: number;
  d: number;
  nlat: number;
  nlon: number;
  years: number[];
  scale: number;
  noData: number;
  source: string;
  /** Uint16 grid indices of the sea cells. */
  cells: string;
  /** Uint8 [year][cell], value × scale = µmol/l. */
  values: string;
}

function bytes(b64: string): Uint8Array {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

function decodeSeries(r: RawOxygenSeries): OxygenSeries {
  const cells = new Uint16Array(bytes(r.cells).buffer);
  const packed = bytes(r.values);
  const frames = r.years.map((y, yi) => {
    const values = new Float32Array(r.nlat * r.nlon).fill(NaN);
    for (let c = 0; c < cells.length; c++) {
      const v = packed[yi * cells.length + c];
      if (v !== r.noData) values[cells[c]] = v * r.scale;
    }
    return { lat0: r.lat0, lon0: r.lon0, d: r.d, nlat: r.nlat, nlon: r.nlon, values, window: String(y), source: r.source, meta: { year: y } };
  });
  return {
    years: r.years,
    frames,
    hypoxic: frames.map(f => gridArea(f, v => v < OXYGEN_THRESHOLDS.hypoxic)),
    anoxic: frames.map(f => gridArea(f, v => v < OXYGEN_THRESHOLDS.anoxic))
  };
}

function decodeGrid(r: RawSeaGrid): SeaGrid {
  const u = bytes(r.values);
  const raw = r.dtype === 'uint8' ? u : new Int16Array(u.buffer);
  const scale = r.scale ?? 1;
  const values = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) values[i] = raw[i] === r.noData ? NaN : raw[i] * scale;
  return { lat0: r.lat0, lon0: r.lon0, d: r.d, nlat: r.nlat, nlon: r.nlon, values, window: r.window, source: r.source, meta: r.meta ?? {} };
}
