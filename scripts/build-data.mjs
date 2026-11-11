#!/usr/bin/env node
/**
 * Builds the web data files from data/baltic.source.json (HydroSHEDS / Natural Earth export).
 *
 *   node scripts/build-data.mjs
 *
 * Output (src/assets/data/):
 *   baltic.json   everything the first frame needs: catchments, outlines, land, lakes, borders,
 *                 clipped world land, rivers of classes 1–4
 *   streams.json  the smallest streams (class 0, ~2/3 of all reaches), loaded after first render
 *
 * Work moved here from the browser:
 *   - coordinate streams are delta-encoded (wrapping uint16) → ~30% smaller after gzip
 *   - river segments lying on a lake are flagged (HydroRIVERS routes flow through lakes as
 *     straight connector reaches); the browser skips them without rasterising lakes
 *   - HydroBASINS hole rings lying ≥ 80% on a lake (Ladoga, Peipus) are dropped
 *   - world land is clipped to the cut-out around the basin
 *   - river geometry comes from data/rivers.hr.json when present (scripts/build-rivers.py: the
 *     original HydroRIVERS lines, smoothed), and the least reliable streams are left out:
 *       · streams with less than MIN_UPSTREAM_KM2 of upstream area (DEM-derived lines that, in flat
 *         land, often run where no stream exists — checked against OpenStreetMap),
 *       · unnamed river systems smaller than MIN_UNNAMED_KM2 (coastal creeks),
 *       · rivers on islands smaller than MIN_ISLAND_KM2.
 *     Leaving out whole headwaters keeps the downstream topology intact (upstream area only grows
 *     downstream, so every removed reach takes all of its own tributaries with it).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'data/baltic.source.json');
const OUT = path.join(root, 'src/assets/data');
/** Must match CONTEXT_MARGIN in globe.component.ts (lon°, lat°). */
const CONTEXT_MARGIN = [7, 3.5];
const LAKE_HOLE_SHARE = 0.8;
const MIN_UPSTREAM_KM2 = 50;
const MIN_UNNAMED_KM2 = 100;
const MIN_ISLAND_KM2 = 500;

const B = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const [LON0, LON1, LAT0, LAT1] = B.bbox;
const u16 = s => {
  if (!s) return new Uint16Array(0);
  const b = Buffer.from(s, 'base64');
  return new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
};
const b64 = typed => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64');
const qx = v => LON0 + ((LON1 - LON0) * v) / 65535;
const qy = v => LAT0 + ((LAT1 - LAT0) * v) / 65535;

/** Wrapping per-axis deltas of an interleaved x,y uint16 stream. */
function delta(xy) {
  const d = new Uint16Array(xy.length);
  for (let i = 0; i < xy.length; i++) d[i] = (xy[i] - (i >= 2 ? xy[i - 2] : 0)) & 0xffff;
  return b64(d);
}

/** Packed polygons → [[ring lengths]], flat uint16 xy. */
function unpack([lens, buf]) {
  const xy = u16(buf);
  let o = 0;
  return lens.map(rl => rl.map(n => { const r = xy.subarray(o * 2, (o + n) * 2); o += n; return r; }));
}
function pack(polys) {
  const lens = polys.map(p => p.map(r => r.length / 2));
  const total = lens.flat().reduce((a, b) => a + b, 0);
  const xy = new Uint16Array(total * 2);
  let o = 0;
  for (const p of polys) for (const r of p) { xy.set(r, o); o += r.length; }
  return [lens, delta(xy)];
}

// ─── lakes: exact point-in-lake ──────────────────────────────────────────────
const lakes = unpack(B.lakes).filter(p => p.length).map(p => {
  const rings = p.map(r => { const f = new Float64Array(r.length); for (let i = 0; i < r.length; i += 2) { f[i] = qx(r[i]); f[i + 1] = qy(r[i + 1]); } return f; });
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const r of rings) for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); }
  return { rings, bb: [x0, x1, y0, y1] };
});
function inRing(r, x, y) {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function inLake(x, y) {
  for (const l of lakes) {
    if (x < l.bb[0] || x > l.bb[1] || y < l.bb[2] || y > l.bb[3]) continue;
    let inside = false;
    for (const r of l.rings) if (inRing(r, x, y)) inside = !inside;
    if (inside) return true;
  }
  return false;
}

// ─── holes inside lakes ──────────────────────────────────────────────────────
function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += r[j] * r[i + 1] - r[i] * r[j + 1];
  return a / 2;
}
let holesDropped = 0;
function dropLakeHoles(poly) {
  if (poly.length < 2) return poly;
  const areas = poly.map(ringArea);
  const outer = Math.sign(areas.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0));
  return poly.filter((r, i) => {
    if (Math.sign(areas[i]) === outer) return true;
    let wet = 0;
    for (let k = 0; k < r.length; k += 2) if (inLake(qx(r[k]), qy(r[k + 1]))) wet++;
    const keep = wet / (r.length / 2) < LAKE_HOLE_SHARE;
    if (!keep) holesDropped++;
    return keep;
  });
}
const basinPolys = unpack([B.basinRings, B.basinXY]).map(dropLakeHoles);
const outlines = unpack(B.outlines).map(dropLakeHoles);

// ─── world land clipped to the cut-out (Sutherland–Hodgman per ring) ─────────
const box = [LON0 - CONTEXT_MARGIN[0], LON1 + CONTEXT_MARGIN[0], LAT0 - CONTEXT_MARGIN[1], LAT1 + CONTEXT_MARGIN[1]];
const gx = v => -180 + (360 * v) / 65535, gy = v => -90 + (180 * v) / 65535;
const qgx = v => Math.round(((v + 180) / 360) * 65535), qgy = v => Math.round(((v + 90) / 180) * 65535);
function clipRing(pts) {
  const edges = [
    [p => p[0] >= box[0], (a, b) => [box[0], a[1] + ((b[1] - a[1]) * (box[0] - a[0])) / (b[0] - a[0])]],
    [p => p[0] <= box[1], (a, b) => [box[1], a[1] + ((b[1] - a[1]) * (box[1] - a[0])) / (b[0] - a[0])]],
    [p => p[1] >= box[2], (a, b) => [a[0] + ((b[0] - a[0]) * (box[2] - a[1])) / (b[1] - a[1]), box[2]]],
    [p => p[1] <= box[3], (a, b) => [a[0] + ((b[0] - a[0]) * (box[3] - a[1])) / (b[1] - a[1]), box[3]]]
  ];
  let out = pts;
  for (const [inside, cut] of edges) {
    const src = out; out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[(i + src.length - 1) % src.length], b = src[i];
      if (inside(b)) { if (!inside(a)) out.push(cut(a, b)); out.push(b); }
      else if (inside(a)) out.push(cut(a, b));
    }
    if (!out.length) break;
  }
  return out;
}
const world = unpack(B.world)
  .map(p => p.map(r => {
    const pts = [];
    for (let i = 0; i < r.length; i += 2) pts.push([gx(r[i]), gy(r[i + 1])]);
    const c = clipRing(pts);
    if (c.length < 3) return null;
    const q = new Uint16Array(c.length * 2);
    c.forEach((p, i) => { q[i * 2] = qgx(p[0]); q[i * 2 + 1] = qgy(p[1]); });
    return q;
  }).filter(Boolean))
  .filter(p => p.length);

// ─── rivers: delta-encoded, with in-lake segment flags ───────────────────────
// ─── which river systems to leave out ────────────────────────────────────────
const sArea = r => { let a = 0; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += r[j] * r[i + 1] - r[i] * r[j + 1]; return a / 2; };
const km2 = r => Math.abs(sArea(r)) * 111.32 * 111.32 * Math.cos((r[1] * Math.PI) / 180);
const outlineRings = outlines[6].map(r => { const f = new Float64Array(r.length); for (let i = 0; i < r.length; i += 2) { f[i] = qx(r[i]); f[i + 1] = qy(r[i + 1]); } return f; });
const mainRing = outlineRings.reduce((a, r) => (Math.abs(sArea(r)) > Math.abs(sArea(a)) ? r : a));
const islands = outlineRings
  .filter(r => r !== mainRing && Math.sign(sArea(r)) === Math.sign(sArea(mainRing)))
  .map(r => { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); } return { r, km2: km2(r), bb: [x0, x1, y0, y1] }; });
const islandOf = g => {
  if (!g.mouth) return null;
  const [x, y] = g.mouth, t = g.lbl ?? g.mouth;
  for (const [px, py] of [[x, y], [x + (t[0] - x) * 0.2, y + (t[1] - y) * 0.2], t]) {
    const I = islands.find(I => px >= I.bb[0] && px <= I.bb[1] && py >= I.bb[2] && py <= I.bb[3] && inRing(I.r, px, py));
    if (I) return I;
  }
  return null;
};
const hiddenBasin = B.groups.map(g => {
  if (g.kind !== 'basin') return false;
  if (!g.name && g.area < MIN_UNNAMED_KM2) return true;
  const I = islandOf(g);
  return !!I && I.km2 < MIN_ISLAND_KM2;
});

const hrPath = path.join(root, 'data/rivers.hr.json');
const HR = fs.existsSync(hrPath) ? JSON.parse(fs.readFileSync(hrPath, 'utf8')) : null;
let wetCount = 0, keptReaches = 0, droppedReaches = 0, vertices = 0;
const rivers = (HR ? HR.rivers : B.rivers).map((rc0, cls) => {
  // Keep only reliable reaches; rebuild cnt / xy / g for the survivors.
  const cnt0 = u16(rc0.cnt), xy0 = u16(rc0.xy), g0 = u16(rc0.g);
  const upB = rc0.up ? Buffer.from(rc0.up, 'base64') : null;
  const up = upB ? new Uint32Array(upB.buffer.slice(upB.byteOffset, upB.byteOffset + upB.length)) : null;
  const keepCnt = [], keepG = [], parts = [];
  let v0 = 0;
  for (let i = 0; i < cnt0.length; i++) {
    const n = cnt0[i];
    const small = up && up[i] > 0 && up[i] < MIN_UPSTREAM_KM2;
    if (small || hiddenBasin[g0[i]]) droppedReaches++;
    else { keepCnt.push(n); keepG.push(g0[i]); parts.push(xy0.subarray(v0 * 2, (v0 + n) * 2)); keptReaches++; vertices += n; }
    v0 += n;
  }
  const xy = new Uint16Array(parts.reduce((a, q) => a + q.length, 0));
  { let k = 0; for (const q of parts) { xy.set(q, k); k += q.length; } }
  const cnt = Uint16Array.from(keepCnt);
  const rc = { n: rc0.n, cnt: b64(cnt), g: b64(Uint16Array.from(keepG)) };
  let nseg = 0;
  for (const n of cnt) nseg += n - 1;
  const wet = new Uint8Array(Math.ceil(nseg / 8));
  let o = 0, s = 0;
  for (const n of cnt) {
    for (let k = 1; k < n; k++, s++) {
      const a = (o + k - 1) * 2, b = (o + k) * 2;
      if (inLake((qx(xy[a]) + qx(xy[b])) / 2, (qy(xy[a + 1]) + qy(xy[b + 1])) / 2)) { wet[s >> 3] |= 1 << (s & 7); wetCount++; }
    }
    o += n;
  }
  return { cls, n: rc.n, cnt: rc.cnt, g: rc.g, xy: delta(xy), wet: b64(wet) };
});

const core = {
  v: 2,
  bbox: B.bbox,
  groups: B.groups,
  subs: B.subs,
  total: B.total,
  basinRings: basinPolys.map(p => p.map(r => r.length / 2)),
  basinXY: pack(basinPolys)[1],
  outlines: pack(outlines),
  land: pack(unpack(B.land)),
  lakes: pack(unpack(B.lakes)),
  borders: [B.borders[0], delta(u16(B.borders[1]))],
  world: pack(world),
  worldBox: box,
  rivers: rivers.filter(r => r.cls > 0)
};
const streams = { v: 2, rivers: rivers.filter(r => r.cls === 0) };

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'baltic.json'), JSON.stringify(core));
fs.writeFileSync(path.join(OUT, 'streams.json'), JSON.stringify(streams));
const kb = f => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0);
console.log(`baltic.json ${kb('baltic.json')} KB, streams.json ${kb('streams.json')} KB`);
console.log(`in-lake segments flagged: ${wetCount}, lake holes dropped: ${holesDropped}, world rings kept: ${world.flat().length}`);
console.log(`rivers: ${HR ? 'HydroRIVERS rebuild' : 'source export'}; reaches kept ${keptReaches}, left out ${droppedReaches} (upstream < ${MIN_UPSTREAM_KM2} km², unnamed < ${MIN_UNNAMED_KM2} km², islands < ${MIN_ISLAND_KM2} km²); vertices ${vertices}`);
