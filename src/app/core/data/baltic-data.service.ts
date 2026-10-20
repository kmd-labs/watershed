import { Injectable, signal } from '@angular/core';
import { BalticData, Basin, CountryLoad, PackedPolys, Poly, RawBaltic, SubBasin } from './baltic.model';
import { computeLoads } from './nutrients';

function decode<T>(b64: string, Ctor: new (buf: ArrayBuffer) => T): T {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return new Ctor(u.buffer);
}

/**
 * Loads the packed HydroSHEDS / Natural Earth Baltic dataset (`assets/data/baltic.json`),
 * decodes quantized geometry and enriches every catchment with nutrient loads.
 */
@Injectable({ providedIn: 'root' })
export class BalticDataService {
  readonly data = signal<BalticData | null>(null);
  readonly error = signal<boolean>(false);

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
      const { load, conc, source } = computeLoads(g);
      const area = g.kind === 'basin' ? g.area : g.parea;
      return {
        ...g,
        id,
        load,
        conc,
        source,
        spec: { n: area > 0 ? (load.n * 1000) / area : 0, p: area > 0 ? (load.p * 1000) / area : 0 },
        bb: [x0, x1, y0, y1],
        cen: [sx / Math.max(n, 1), sy / Math.max(n, 1)]
      };
    });

    const subs: SubBasin[] = B.subs.map((s, id) => {
      const load = { n: 0, p: 0 };
      for (const b of basins) if (b.sub === id) { load.n += b.load.n; load.p += b.load.p; }
      return { ...s, id, load };
    });

    // Apportion each river's load to countries by their (normalised) share of the basin area.
    const byCountry = new Map<string, CountryLoad>();
    for (const b of basins) {
      if (b.source === 'none') continue;
      const sum = b.ctry.reduce((s, [, pct]) => s + pct, 0);
      if (sum <= 0) continue;
      for (const [name, pct] of b.ctry) {
        const f = pct / sum;
        const c = byCountry.get(name) ?? { name, load: { n: 0, p: 0 }, area: 0, rivers: 0 };
        c.load.n += b.load.n * f;
        c.load.p += b.load.p * f;
        c.area += b.area * f;
        c.rivers++;
        byCountry.set(name, c);
      }
    }
    const countries = [...byCountry.values()].sort((a, b) => b.load.n - a.load.n);

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
      total: {
        parea: B.total.parea,
        dis: B.total.dis,
        nout: B.total.nout,
        load: subs.reduce((a, s) => ({ n: a.n + s.load.n, p: a.p + s.load.p }), { n: 0, p: 0 })
      },
      basinPolys,
      outlines: polys(B.outlines),
      land: polys(B.land),
      lakes: polys(B.lakes),
      world: polys(B.world, true),
      borders,
      rivers,
      qx,
      qy
    };
  }
}
