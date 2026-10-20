import { Injectable, signal } from '@angular/core';

export type SeaLayer = 'none' | 'oxygen' | 'cyano';

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
  readonly oxygen = signal<SeaGrid | null>(null);
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
    if (layer === 'none' || this.started.has(layer)) return;
    this.started.add(layer);
    this.load(layer);
  }

  private async load(layer: 'oxygen' | 'cyano') {
    try {
      const res = await fetch(`assets/data/${layer}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const grid = decodeGrid(await res.json());
      (layer === 'oxygen' ? this.oxygen : this.cyano).set(grid);
    } catch (err) {
      console.warn(`Sea layer "${layer}" unavailable`, err);
      if (layer === 'cyano') this.cyanoMissing.set(true);
    }
  }
}

function decodeGrid(r: RawSeaGrid): SeaGrid {
  const s = atob(r.values);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  const raw = r.dtype === 'uint8' ? u : new Int16Array(u.buffer);
  const scale = r.scale ?? 1;
  const values = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) values[i] = raw[i] === r.noData ? NaN : raw[i] * scale;
  return { lat0: r.lat0, lon0: r.lon0, d: r.d, nlat: r.nlat, nlon: r.nlon, values, window: r.window, source: r.source, meta: r.meta ?? {} };
}
