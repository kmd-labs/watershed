import { Injectable, inject, signal } from '@angular/core';
import { ThemeService } from '@kmd/design-system';
import { cssToHex, hexToRgb } from '../color';
import { BalticData, Basin, CountryArea, PackedPolys, Poly, RawBaltic, SubBasin } from './baltic.model';
import { MOSAIC_COUNT, mosaicToken } from './views';

/** Share of a hole's vertices that must lie on a lake for the hole to count as a lake artefact. */
const LAKE_HOLE_SHARE = 0.8;

function ringArea(r: Float32Array): number {
  let a = 0;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += r[j] * r[i + 1] - r[i] * r[j + 1];
  return a / 2;
}

/**
 * Rasterises the lakes once into a bbox-wide 1-bit mask and returns a point-in-lake test.
 * ~540 m per pixel: enough to tell lake interiors from the shore, while the transient RGBA
 * buffer stays around 50 MB and the retained mask under 2 MB.
 */
function lakeTester(lakes: Poly[], bbox: [number, number, number, number]): (lon: number, lat: number) => boolean {
  const [LON0, LON1, LAT0, LAT1] = bbox;
  const W = 3072;
  const H = Math.round((W * (LAT1 - LAT0)) / (LON1 - LON0) / Math.cos(59 * (Math.PI / 180)));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const x = canvas.getContext('2d', { willReadFrequently: true })!;
  x.fillStyle = '#000';
  for (const poly of lakes) {
    x.beginPath();
    for (const ring of poly) {
      for (let k = 0; k < ring.length; k += 2) {
        const px = ((ring[k] - LON0) / (LON1 - LON0)) * W, py = ((LAT1 - ring[k + 1]) / (LAT1 - LAT0)) * H;
        k ? x.lineTo(px, py) : x.moveTo(px, py);
      }
      x.closePath();
    }
    x.fill('evenodd');
  }
  const alpha = x.getImageData(0, 0, W, H).data;
  const bits = new Uint8Array(Math.ceil((W * H) / 8));
  for (let p = 0; p < W * H; p++) if (alpha[p * 4 + 3] > 127) bits[p >> 3] |= 1 << (p & 7);
  canvas.width = canvas.height = 0;
  return (lon, lat) => {
    const i = Math.floor(((LAT1 - lat) / (LAT1 - LAT0)) * H), j = Math.floor(((lon - LON0) / (LON1 - LON0)) * W);
    if (i < 0 || i >= H || j < 0 || j >= W) return false;
    const p = i * W + j;
    return (bits[p >> 3] & (1 << (p & 7))) !== 0;
  };
}

/**
 * HydroBASINS leaves holes inside the biggest lakes (Ladoga, Peipus); drawn as outlines they read
 * as stray jagged shapes in the middle of the water. Drops hole rings that lie on a lake.
 */
function dropLakeHoles(poly: Poly, inLake: (lon: number, lat: number) => boolean): Poly {
  if (poly.length < 2) return poly;
  const areas = poly.map(ringArea);
  const outer = Math.sign(areas.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0));
  return poly.filter((ring, i) => {
    if (Math.sign(areas[i]) === outer) return true;
    let wet = 0;
    for (let k = 0; k < ring.length; k += 2) if (inLake(ring[k], ring[k + 1])) wet++;
    return wet / (ring.length / 2) < LAKE_HOLE_SHARE;
  });
}

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
function assignMosaic(basins: Basin[], palette: [number, number, number][]): void {
  const m = NEIGHBOUR_MARGIN;
  const slots = palette.length;
  const dist = palette.map(a => palette.map(b => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])));
  const order = [...basins].sort((a, b) => b.parea - a.parea);
  const used = new Array<number>(slots).fill(0);
  const done: Basin[] = [];
  for (const b of order) {
    const taken = new Set<number>();
    for (const o of done) {
      if (o.bb[0] - m <= b.bb[1] && b.bb[0] - m <= o.bb[1] && o.bb[2] - m <= b.bb[3] && b.bb[2] - m <= o.bb[3]) taken.add(o.mosaic);
    }
    const sep = (s: number) => (taken.size ? Math.min(...[...taken].map(t => dist[s][t])) : Infinity);
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

function decode<T>(b64: string, Ctor: new (buf: ArrayBuffer) => T): T {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return new Ctor(u.buffer);
}

/**
 * Loads the packed HydroSHEDS / Natural Earth Baltic dataset (`assets/data/baltic.json`),
 * decodes quantized geometry, removes lake artefacts and aggregates the basin by country.
 */
@Injectable({ providedIn: 'root' })
export class BalticDataService {
  readonly data = signal<BalticData | null>(null);
  readonly error = signal<boolean>(false);
  private readonly theme = inject(ThemeService);

  constructor() {
    this.load();
  }

  private async load() {
    try {
      const res = await fetch('assets/data/baltic.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.data.set(this.build(await res.json()));
    } catch (err) {
      console.error(err);
      this.error.set(true);
    }
  }

  private build(B: RawBaltic): BalticData {
    const [LON0, LON1, LAT0, LAT1] = B.bbox;
    const qx = (v: number) => LON0 + ((LON1 - LON0) * v) / 65535;
    const qy = (v: number) => LAT0 + ((LAT1 - LAT0) * v) / 65535;

    const polys = ([lens, buf]: PackedPolys, global = false): Poly[] => {
      const xy = buf ? decode(buf, Uint16Array) : new Uint16Array(0);
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

    const lakes = polys(B.lakes).filter(p => p.length > 0);
    const inLake = lakeTester(lakes, B.bbox);
    const basinPolys = polys([B.basinRings, B.basinXY]).map(p => dropLakeHoles(p, inLake));

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

    const palette = Array.from({ length: MOSAIC_COUNT }, (_, i) => hexToRgb(cssToHex(this.theme.getTokenColor(mosaicToken(i), '#888888'))));
    assignMosaic(basins, palette);

    const subs: SubBasin[] = B.subs.map((s, id) => ({ ...s, id }));

    const riversIn = new Map<string, number>();
    for (const b of basins) if (b.river) for (const [name] of b.ctry) riversIn.set(name, (riversIn.get(name) ?? 0) + 1);
    const countries: CountryArea[] = B.total.ctry.map(([name, pct]) => ({
      name,
      pct,
      area: (B.total.parea * pct) / 100,
      rivers: riversIn.get(name) ?? 0
    }));

    const borderXY = decode(B.borders[1], Uint16Array);
    let bo = 0;
    const borders = B.borders[0].map(n => {
      const a = new Float32Array(n * 2);
      for (let k = 0; k < n; k++, bo++) { a[k * 2] = qx(borderXY[bo * 2]); a[k * 2 + 1] = qy(borderXY[bo * 2 + 1]); }
      return a;
    });

    const rivers = B.rivers.map(rc => ({
      cnt: decode(rc.cnt, Uint16Array),
      xy: decode(rc.xy, Uint16Array),
      g: decode(rc.g, Uint16Array)
    }));

    return {
      bbox: B.bbox,
      basins,
      subs,
      countries,
      total: B.total,
      basinPolys,
      outlines: polys(B.outlines).map(p => dropLakeHoles(p, inLake)),
      land: polys(B.land),
      lakes,
      inLake,
      world: polys(B.world, true),
      borders,
      rivers,
      qx,
      qy
    };
  }
}
