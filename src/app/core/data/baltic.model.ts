/** Packed polygon set: ring lengths per polygon + base64 Uint16 quantized lon/lat pairs. */
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
  n: number;
  cnt: string;
  xy: string;
  g: string;
}

export interface RawBaltic {
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

export interface RiverClassGeometry {
  /** Vertex count per polyline. */
  cnt: Uint16Array;
  /** Quantized lon/lat pairs. */
  xy: Uint16Array;
  /** Basin id per polyline. */
  g: Uint16Array;
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
  /** True where the point lies on one of `lakes` (rasterised, ~0.005° resolution). */
  inLake: (lon: number, lat: number) => boolean;
  world: Poly[];
  borders: Float32Array[];
  rivers: RiverClassGeometry[];
  qx: (v: number) => number;
  qy: (v: number) => number;
}
