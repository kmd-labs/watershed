import { Injectable, inject, signal } from '@angular/core';
import { ThemeService } from '@kmd/design-system';
import { cssToHex, hexToRgb } from '../color';
import {
  BalticData,
  Basin,
  CountryArea,
  PackedPolys,
  Poly,
  RaindropPath,
  RawBaltic,
  RawRiverClass,
  RawStreams,
  RiverClassGeometry,
  SubBasin
} from './baltic.model';
import { RiverNetwork } from './river-network';
import { MOSAIC_COUNT, mosaicToken } from './views';

/** Margin (degrees) by which bounding boxes are grown when looking for neighbouring basins. */
const NEIGHBOUR_MARGIN = 0.05;
/** Minimum RGB distance between a basin's colour and its neighbours' (blue vs cyan ≈ 58). */
const DISTINCT_RGB = 110;

/**
 * Greedy colouring for the "Basin mosaic" view. Basins are visited largest first, so the big
 * rivers take the strongest slots. Each basin then takes, among slots no neighbour uses, the
 * least-used one that is also clearly different from its neighbours' colours (not blue next to
 * cyan); failing that, the most different free slot. Neighbours = bounding boxes overlapping after
 * a small margin, a cheap and slightly over-cautious stand-in for shared borders.
 */
function assignMosaic(basins: Basin[], palettes: [number, number, number][][]): void {
  const m = NEIGHBOUR_MARGIN;
  const slots = palettes[0].length;
  // Two slots count as similar if they look alike on either ground.
  const dist = palettes[0].map((_, i) =>
    palettes[0].map((_, j) => Math.min(...palettes.map(p => Math.hypot(p[i][0] - p[j][0], p[i][1] - p[j][1], p[i][2] - p[j][2]))))
  );
  const order = [...basins].sort((a, b) => b.parea - a.parea);
  const used = new Array<number>(slots).fill(0);
  const done: Basin[] = [];
  for (const b of order) {
    const taken = new Set<number>();
    for (const o of done) {
      if (o.bb[0] - m <= b.bb[1] && b.bb[0] - m <= o.bb[1] && o.bb[2] - m <= b.bb[3] && b.bb[2] - m <= o.bb[3]) taken.add(o.mosaic);
    }
    const sep = (s: number) => {
      let d = Infinity;
      for (const t of taken) d = Math.min(d, dist[s][t]);
      return d;
    };
    let best = -1, bestFallback = -1;
    for (let s = 0; s < slots; s++) {
      if (taken.has(s)) continue;
      if (sep(s) >= DISTINCT_RGB && (best < 0 || used[s] < used[best])) best = s;
      if (bestFallback < 0 || sep(s) > sep(bestFallback)) bestFallback = s;
    }
    if (best < 0) best = bestFallback;
    b.mosaic = best >= 0 ? best : used.indexOf(Math.min(...used));
    used[b.mosaic]++;
    done.push(b);
  }
}

function bytes(b64: string | null): Uint8Array {
  if (!b64) return new Uint8Array(0);
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

const u16 = (b64: string | null) => new Uint16Array(bytes(b64).buffer);

/** Reverses the per-axis wrapping delta encoding of scripts/build-data.mjs. */
function undelta(b64: string | null): Uint16Array {
  const d = u16(b64);
  for (let i = 2; i < d.length; i++) d[i] = (d[i] + d[i - 2]) & 0xffff;
  return d;
}

/** Yields to the browser (a task boundary; rAF would pause in background tabs). */
const frame = () => new Promise<void>(r => setTimeout(r, 0));

/**
 * Loads the Baltic dataset in two steps: `baltic.json` (everything the first frame needs) and,
 * once that is on screen, `streams.json` (the smallest streams) and the relief shading.
 */
@Injectable({ providedIn: 'root' })
export class BalticDataService {
  private readonly theme = inject(ThemeService);

  readonly data = signal<BalticData | null>(null);
  readonly error = signal<boolean>(false);
  /** 0–1 while the core data downloads and decodes (feeds the splash). */
  readonly progress = signal(0);
  /** Smallest streams (river class 0), arriving after the core data. */
  readonly streams = signal<RiverClassGeometry | null>(null);
  /** Greyscale hillshade over `worldBox` (128 = flat). */
  readonly relief = signal<ImageBitmap | HTMLImageElement | null>(null);

  private network?: RiverNetwork;

  constructor() {
    this.load();
  }

  /** Per-segment distance to the mouth (km) for a loaded river class. */
  readonly mouthKm = (rc: RiverClassGeometry): Float32Array | null => this.network?.mouthKm(rc) ?? null;

  /** Raindrop path from lon/lat inside `basin` down to the sea, or null for river-less strips. */
  trace(lon: number, lat: number, basin: number): RaindropPath | null {
    return this.network?.trace(lon, lat, basin) ?? null;
  }

  private async load() {
    try {
      this.progress.set(0.05);
      const res = await fetch('assets/data/baltic.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = (await res.json()) as RawBaltic;
      this.progress.set(0.6);
      // Start the deferred downloads now; they are not needed for the first frame.
      const streams = fetch('assets/data/streams.json').then(r => (r.ok ? (r.json() as Promise<RawStreams>) : null));
      const relief = this.loadImage('assets/data/relief.webp');
      await frame();
      const data = this.build(raw);
      this.progress.set(1);
      performance.mark('watershed:data');
      this.data.set(data);
      this.loadLater(data, streams, relief);
    } catch (err) {
      console.error(err);
      this.error.set(true);
    }
  }

  private async loadLater(data: BalticData, streams: Promise<RawStreams | null>, relief: Promise<ImageBitmap | HTMLImageElement | null>) {
    relief.then(img => img && this.relief.set(img)).catch(() => undefined);
    try {
      const s = await streams;
      if (!s?.rivers[0]) return;
      await frame();
      const rc = this.riverClass(s.rivers[0]);
      this.network?.add(rc);
      this.streams.set(rc);
      performance.mark('watershed:streams');
    } catch (err) {
      // The map is complete without the smallest streams; keep going.
      console.warn('streams.json', err);
    }
  }

  private async loadImage(url: string): Promise<ImageBitmap | HTMLImageElement | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      if (typeof createImageBitmap === 'function') return await createImageBitmap(blob);
      const img = new Image();
      img.src = URL.createObjectURL(blob);
      await img.decode();
      return img;
    } catch {
      return null;
    }
  }

  private riverClass(r: RawRiverClass): RiverClassGeometry {
    return { cls: r.cls, cnt: u16(r.cnt), xy: undelta(r.xy), g: u16(r.g), wet: bytes(r.wet) };
  }

  private build(B: RawBaltic): BalticData {
    const [LON0, LON1, LAT0, LAT1] = B.bbox;
    const qx = (v: number) => LON0 + ((LON1 - LON0) * v) / 65535;
    const qy = (v: number) => LAT0 + ((LAT1 - LAT0) * v) / 65535;

    const polys = ([lens, buf]: PackedPolys, global = false): Poly[] => {
      const xy = undelta(buf);
      let o = 0;
      return lens.map(rl =>
        rl.map(n => {
          const ring = new Float32Array(n * 2);
          for (let k = 0; k < n; k++, o++) {
            ring[k * 2] = global ? -180 + (360 * xy[o * 2]) / 65535 : qx(xy[o * 2]);
            ring[k * 2 + 1] = global ? -90 + (180 * xy[o * 2 + 1]) / 65535 : qy(xy[o * 2 + 1]);
          }
          return ring;
        })
      );
    };

    const basinPolys = polys([B.basinRings, B.basinXY]);

    const basins: Basin[] = B.groups.map((g, id) => {
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, sx = 0, sy = 0, n = 0;
      for (const ring of basinPolys[id]) {
        for (let k = 0; k < ring.length; k += 2) {
          const x = ring[k], y = ring[k + 1];
          x0 = Math.min(x0, x); x1 = Math.max(x1, x);
          y0 = Math.min(y0, y); y1 = Math.max(y1, y);
          sx += x; sy += y; n++;
        }
      }
      return {
        ...g,
        id,
        river: g.kind === 'basin' && g.dis > 0,
        mosaic: 0,
        bb: [x0, x1, y0, y1],
        cen: [sx / Math.max(n, 1), sy / Math.max(n, 1)]
      };
    });

    const palette = (ground: 'light' | 'dark') =>
      Array.from({ length: MOSAIC_COUNT }, (_, i) => hexToRgb(cssToHex(this.theme.getTokenColor(mosaicToken(i, ground), '#888888'))));
    assignMosaic(basins, [palette('light'), palette('dark')]);

    const subs: SubBasin[] = B.subs.map((s, id) => ({ ...s, id }));

    const riversIn = new Map<string, number>();
    for (const b of basins) if (b.river) for (const [name] of b.ctry) riversIn.set(name, (riversIn.get(name) ?? 0) + 1);
    const countries: CountryArea[] = B.total.ctry.map(([name, pct]) => ({
      name,
      pct,
      area: (B.total.parea * pct) / 100,
      rivers: riversIn.get(name) ?? 0
    }));

    const borderXY = undelta(B.borders[1]);
    let bo = 0;
    const borders = B.borders[0].map(n => {
      const a = new Float32Array(n * 2);
      for (let k = 0; k < n; k++, bo++) { a[k * 2] = qx(borderXY[bo * 2]); a[k * 2 + 1] = qy(borderXY[bo * 2 + 1]); }
      return a;
    });

    const rivers = B.rivers.map(r => this.riverClass(r));
    this.network = new RiverNetwork(qx, qy);
    for (const rc of rivers) this.network.add(rc);

    return {
      bbox: B.bbox,
      basins,
      subs,
      countries,
      total: B.total,
      basinPolys,
      outlines: polys(B.outlines),
      land: polys(B.land),
      lakes: polys(B.lakes),
      world: polys(B.world, true),
      worldBox: B.worldBox,
      borders,
      rivers,
      qx,
      qy
    };
  }
}
