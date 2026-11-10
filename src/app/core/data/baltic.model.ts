/**
 * Data format v2, written by scripts/build-data.mjs. Coordinate streams are base64 uint16 lon/lat
 * pairs quantised over `bbox` (world: over the globe), delta-encoded per axis with wrap-around.
 */

/** Packed polygon set: ring lengths per polygon + delta-encoded coordinate stream. */
export type PackedPolys = [number[][], string | null];

export interface RawGroup {
  name: string | null;
  kind: 'basin' | 'coast';
  sub: number;
  place?: string;
  pcc?: string;
  pkm?: number;
  area: number;
  dis: number;
  nreach: number;
  rkm: number;
  len?: number;
  mouth?: [number, number];
  lbl?: [number, number] | null;
  parea: number;
  ctry: [string, number][];
}

export interface RawSub {
  name: string;
  lbl: [number, number];
  parea: number;
  dis: number;
  nout: number;
  nreach: number;
  rkm: number;
  top: [string, number][];
  ctry: [string, number][];
}

export interface RawRiverClass {
  /** River size class 0 (smallest streams) … 4 (largest rivers). */
  cls: number;
  n: number;
  /** Vertex count per reach (uint16, plain base64). */
  cnt: string;
  /** Delta-encoded coordinates. */
  xy: string;
  /** Basin id per reach (uint16, plain base64). */
  g: string;
  /** Bitset over segments: 1 = the segment lies on a lake. */
  wet: string;
}

export interface RawBaltic {
  v: 2;
  bbox: [number, number, number, number];
  rivers: RawRiverClass[];
  groups: RawGroup[];
  subs: RawSub[];
  total: { parea: number; dis: number; nout: number; nreach: number; rkm: number; ctry: [string, number][] };
  basinRings: number[][];
  basinXY: string;
  outlines: PackedPolys;
  land: PackedPolys;
  lakes: PackedPolys;
  borders: [number[], string];
  world: PackedPolys;
  /** Cut-out box the world land was clipped to: [lon0, lon1, lat0, lat1]. */
  worldBox: [number, number, number, number];
}

export interface RawStreams {
  v: 2;
  rivers: RawRiverClass[];
}

/** A polygon = list of rings, each ring a flat [lon, lat, lon, lat, …] array. */
export type Poly = Float32Array[];

/** One drainage unit: a river basin, or a river-less coastal strip draining straight to the sea. */
export interface Basin extends RawGroup {
  id: number;
  /** A river basin with a mouth and a modelled discharge (coastal strips are false). */
  river: boolean;
  /** "Basin mosaic" palette slot; neighbouring basins never share one where it can be avoided. */
  mosaic: number;
  bb: [number, number, number, number];
  cen: [number, number];
}

export interface SubBasin extends RawSub {
  id: number;
}

/** A country's part of the whole Baltic drainage basin. */
export interface CountryArea {
  /** Dataset country name (Polish). */
  name: string;
  /** Area within the drainage basin, km². */
  area: number;
  /** Share of the whole drainage basin, %. */
  pct: number;
  /** Number of river basins with any part in the country. */
  rivers: number;
}

/** One river size class. Reaches are oriented downstream; each reach ends where the next begins. */
export interface RiverClassGeometry {
  cls: number;
  /** Vertex count per reach. */
  cnt: Uint16Array;
  /** Quantised lon/lat pairs. */
  xy: Uint16Array;
  /** Basin id per reach. */
  g: Uint16Array;
  /** Bitset over segments: set = the segment lies on a lake. */
  wet: Uint8Array;
}

export interface BalticData {
  bbox: [number, number, number, number];
  basins: Basin[];
  subs: SubBasin[];
  countries: CountryArea[];
  total: RawBaltic['total'];
  basinPolys: Poly[];
  outlines: Poly[];
  land: Poly[];
  lakes: Poly[];
  world: Poly[];
  worldBox: [number, number, number, number];
  borders: Float32Array[];
  /** River classes 1–4; class 0 arrives later (BalticDataService.streams). */
  rivers: RiverClassGeometry[];
  qx: (v: number) => number;
  qy: (v: number) => number;
}

/** A traced raindrop: from where it fell, over land to the nearest stream, then down to the sea. */
export interface RaindropPath {
  /** lon/lat pairs; the first segment is the overland part. */
  points: Float32Array;
  /** Index of the point where the drop enters the river network (1 unless it fell on a river). */
  riverStart: number;
  /** Cumulative distance (km) at every point. */
  km: Float32Array;
  totalKm: number;
  overlandKm: number;
  lakeKm: number;
  /** Separate stretches through lakes. */
  lakes: number;
  basin: number;
  start: [number, number];
}
