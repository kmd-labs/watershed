import { RaindropPath, RiverClassGeometry } from './baltic.model';

const KM_PER_DEG = 111.32;
const DEG = Math.PI / 180;

/**
 * Downstream topology rebuilt from geometry: HydroRIVERS reaches are oriented downstream and each
 * reach's last vertex is exactly the first vertex of the reach it flows into (checked on the whole
 * dataset: 88,602 reaches, one dead end per basin — its mouth). So `next` comes from matching
 * end points to start points; no explicit topology needs to ship.
 */
export class RiverNetwork {
  private readonly classes: RiverClassGeometry[] = [];
  /** Per reach: class, first vertex in the class stream, vertex count, first segment, basin. */
  private cls: number[] = [];
  private off: number[] = [];
  private cnt: number[] = [];
  private seg: number[] = [];
  private basin: number[] = [];
  private next: number[] = [];
  private readonly startAt = new Map<number, number>();
  private readonly byBasin = new Map<number, number[]>();

  constructor(
    private readonly qx: (v: number) => number,
    private readonly qy: (v: number) => number
  ) {}

  /** Registers a river class (class 0 arrives after the first render). */
  add(rc: RiverClassGeometry) {
    const ci = this.classes.length;
    this.classes.push(rc);
    const first = this.cls.length;
    let o = 0, s = 0;
    for (let i = 0; i < rc.cnt.length; i++) {
      const id = this.cls.length;
      const n = rc.cnt[i];
      this.cls.push(ci); this.off.push(o); this.cnt.push(n); this.seg.push(s); this.basin.push(rc.g[i]); this.next.push(-1);
      this.startAt.set(rc.xy[o * 2] * 65536 + rc.xy[o * 2 + 1], id);
      const list = this.byBasin.get(rc.g[i]);
      if (list) list.push(id); else this.byBasin.set(rc.g[i], [id]);
      o += n; s += n - 1;
    }
    // Re-link every reach: new starts may complete older ends and vice versa.
    for (let id = 0; id < this.cls.length; id++) {
      if (this.next[id] >= 0 && id < first) continue;
      const c = this.classes[this.cls[id]];
      const e = (this.off[id] + this.cnt[id] - 1) * 2;
      this.next[id] = this.startAt.get(c.xy[e] * 65536 + c.xy[e + 1]) ?? -1;
    }
  }

  private len: number[] = [];
  private downKm: number[] = [];

  /** Length of a reach in km. */
  private reachKm(id: number): number {
    if (this.len[id] !== undefined) return this.len[id];
    const c = this.classes[this.cls[id]];
    let km = 0;
    for (let k = 1; k < this.cnt[id]; k++) km += this.segKm(c, this.off[id] + k - 1);
    return (this.len[id] = km);
  }

  private segKm(c: RiverClassGeometry, v: number): number {
    const a = v * 2, b = a + 2;
    const la = (this.qy(c.xy[a + 1]) + this.qy(c.xy[b + 1])) / 2;
    return Math.hypot((this.qx(c.xy[b]) - this.qx(c.xy[a])) * Math.cos(la * DEG), this.qy(c.xy[b + 1]) - this.qy(c.xy[a + 1])) * KM_PER_DEG;
  }

  /** Distance (km) from the end of a reach to its basin's mouth, along the network. */
  private toMouth(id: number): number {
    if (this.downKm[id] !== undefined) return this.downKm[id];
    // Walk down to the first reach with a known distance, then unwind (no recursion: chains are long).
    const chain: number[] = [];
    let cur = id;
    while (cur >= 0 && this.downKm[cur] === undefined) { chain.push(cur); cur = this.next[cur]; }
    let acc = cur >= 0 ? this.downKm[cur] + this.reachKm(cur) : 0;
    for (let i = chain.length - 1; i >= 0; i--) {
      this.downKm[chain[i]] = acc;
      acc += this.reachKm(chain[i]);
    }
    return this.downKm[id];
  }

  /**
   * Distance to the mouth (km) at the upstream end of every segment of a river class, in segment
   * order (n − 1 per reach). Drives the "rivers flow to the sea" reveal.
   */
  mouthKm(rc: RiverClassGeometry): Float32Array {
    const ci = this.classes.indexOf(rc);
    let nseg = 0;
    for (const n of rc.cnt) nseg += n - 1;
    const out = new Float32Array(nseg);
    if (ci < 0) return out;
    for (let id = 0; id < this.cls.length; id++) {
      if (this.cls[id] !== ci) continue;
      let km = this.toMouth(id) + this.reachKm(id);
      for (let k = 1; k < this.cnt[id]; k++) {
        out[this.seg[id] + k - 1] = km;
        km -= this.segKm(rc, this.off[id] + k - 1);
      }
    }
    return out;
  }

  /**
   * Traces a raindrop falling at lon/lat inside `basin`: straight over land to the nearest river
   * vertex of that basin, then downstream reach by reach to the mouth.
   */
  trace(lon: number, lat: number, basin: number): RaindropPath | null {
    const reaches = this.byBasin.get(basin);
    if (!reaches?.length) return null;
    const kx = Math.cos(lat * DEG);
    let best = -1, bestK = 0, bestD = Infinity;
    for (const id of reaches) {
      const c = this.classes[this.cls[id]];
      for (let k = 0; k < this.cnt[id]; k++) {
        const p = (this.off[id] + k) * 2;
        const dx = (this.qx(c.xy[p]) - lon) * kx, dy = this.qy(c.xy[p + 1]) - lat;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = id; bestK = k; }
      }
    }
    if (best < 0) return null;

    // wet[i]: the step from point i-1 to point i lies on a lake (wet[0] unused).
    const pts: number[] = [lon, lat];
    const wet: boolean[] = [false];
    let id = best, k = bestK, first = true, guard = 0;
    while (id >= 0 && guard++ < 100_000) {
      const c = this.classes[this.cls[id]];
      for (; k < this.cnt[id]; k++) {
        if (!first && k === 0) continue; // a reach starts on the previous reach's last vertex
        const p = (this.off[id] + k) * 2;
        pts.push(this.qx(c.xy[p]), this.qy(c.xy[p + 1]));
        if (first) {
          wet.push(false); // the overland step
          first = false;
        } else {
          const s = this.seg[id] + k - 1;
          wet.push((c.wet[s >> 3] & (1 << (s & 7))) !== 0);
        }
      }
      id = this.next[id];
      k = 0;
    }

    const n = pts.length / 2;
    const km = new Float32Array(n);
    let lakeKm = 0, lakes = 0, inLake = false;
    for (let i = 1; i < n; i++) {
      const la = (pts[i * 2 - 1] + pts[i * 2 + 1]) / 2;
      const d = Math.hypot((pts[i * 2] - pts[i * 2 - 2]) * Math.cos(la * DEG), pts[i * 2 + 1] - pts[i * 2 - 1]) * KM_PER_DEG;
      km[i] = km[i - 1] + d;
      if (wet[i]) { lakeKm += d; if (!inLake) lakes++; }
      inLake = wet[i];
    }
    return {
      points: Float32Array.from(pts),
      riverStart: 1,
      km,
      totalKm: km[n - 1],
      overlandKm: n > 1 ? km[1] : 0,
      lakeKm,
      lakes,
      basin,
      start: [lon, lat]
    };
  }
}
