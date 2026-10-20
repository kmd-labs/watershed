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

export type LoadSource = 'measured' | 'estimated' | 'none';

export interface NutrientPair {
  n: number;
  p: number;
}

/** One drainage unit (river basin or river-less coastal strip) enriched with nutrient loads. */
export interface Basin extends RawGroup {
  id: number;
  /** Annual loads to the sea, tonnes per year. */
  load: NutrientPair;
  /** Area-specific loads, kg per km² per year. */
  spec: NutrientPair;
  /** Flow-weighted concentration, mg/l. */
  conc: NutrientPair;
  source: LoadSource;
  bb: [number, number, number, number];
  cen: [number, number];
}

export interface SubBasin extends RawSub {
  id: number;
  load: NutrientPair;
}

/** River loads apportioned to a country by its share of each basin's area. */
export interface CountryLoad {
  /** Dataset country name (Polish). */
  name: string;
  load: NutrientPair;
  /** Basin area within the country, km². */
  area: number;
  /** Number of rivers with any part of their basin in the country. */
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
  countries: CountryLoad[];
  total:{ parea: number; dis: number; nout: number; load: NutrientPair };
  basinPolys: Poly[];
  outlines: Poly[];
  land: Poly[];
  lakes: Poly[];
  world: Poly[];
  borders: Float32Array[];
  rivers: RiverClassGeometry[];
  qx: (v: number) => number;
  qy: (v: number) => number;
}
