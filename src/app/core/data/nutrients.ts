import type { LoadSource, NutrientPair, RawGroup } from './baltic.model';

export type Nutrient = 'n' | 'p';

/**
 * Nutrient load model.
 *
 * 1. The seven biggest rivers use loads reported to HELCOM for 2017 (PLC-7, BSEP n°178
 *    "Input of nutrients by the seven biggest rivers in the Baltic Sea region", 2021).
 *    Kemijoki and Daugava TP are derived from the reported area-specific loads × catchment area.
 * 2. Every other river: load = modelled mean discharge (HydroRIVERS / WaterGAP) × flow-weighted
 *    total N / total P concentration typical for its sub-basin, refined by the countries
 *    that share the catchment where HELCOM sub-basin averages are dominated by big rivers.
 *    Sub-basin concentrations: HELCOM BSEFS 2025, Tables 1a/1b (2013–2022 averages).
 */

const SECONDS_PER_YEAR = 31_557_600;

/** mg/l (= g/m³) × m³/s → tonnes per year. */
export const concToLoad = (concMgL: number, flowM3s: number) => (concMgL * flowM3s * SECONDS_PER_YEAR) / 1e6;

/** Reported loads (t/yr, 2017) keyed by the river name used in the HydroSHEDS dataset. */
export const MEASURED_LOADS: Record<string, NutrientPair> = {
  'Wisła': { n: 111_000, p: 3_730 },
  'Niemen': { n: 82_000, p: 2_560 },
  'Odra': { n: 66_000, p: 2_500 },
  'Newa': { n: 53_600, p: 2_310 },
  'Dźwina (Daugawa)': { n: 43_000, p: 1_850 },
  'Göta älv': { n: 7_300, p: 217 },
  'Kemijoki': { n: 6_800, p: 300 }
};

export const MEASURED_YEAR = 2017;

/** HELCOM waterborne inputs to the whole Baltic Sea, 2013–2022 average (BSEFS 2025, Tables 1a/1b), t/yr. */
export const HELCOM_REFERENCE: NutrientPair = { n: 578_342, p: 22_689 };

/** HELCOM flow-weighted riverine concentrations (mg/l), 2013–2022, per sub-basin index of the dataset. */
export const SUB_BASIN_CONC: NutrientPair[] = [
  { n: 0.40, p: 0.020 }, // 0 Bothnian Bay (BOB)
  { n: 0.47, p: 0.019 }, // 1 Bothnian Sea + Åland (BOS)
  { n: 0.80, p: 0.032 }, // 2 Gulf of Finland (GUF)
  { n: 2.42, p: 0.061 }, // 3 Gulf of Riga (GUR)
  { n: 2.46, p: 0.108 }, // 4 Baltic Proper (BAP)
  { n: 1.39, p: 0.038 }  // 5 Danish Straits + Kattegat (KAT value, Swedish west-coast rivers dominate flow)
];

/** Representative concentrations (mg/l) used to split mixed sub-basins by country. */
const POLISH: NutrientPair = { n: 3.60, p: 0.128 };   // mean of Vistula & Oder, PLC-7 2017
const NEMUNAS: NutrientPair = { n: 2.79, p: 0.087 };  // Nemunas, PLC-7 2017
const DAUGAVA: NutrientPair = { n: 1.63, p: 0.067 };  // Daugava, PLC-7 2017
const KATTEGAT: NutrientPair = { n: 1.39, p: 0.038 }; // HELCOM KAT 2013–2022 (southern Swedish rivers)
const DANISH: NutrientPair = { n: 4.77, p: 0.132 };   // HELCOM Danish Straits 2013–2022

const COUNTRY_CONC: Record<number, Record<string, NutrientPair>> = {
  4: {
    'Polska': POLISH,
    'Czechy': POLISH,
    'Słowacja': POLISH,
    'Litwa': NEMUNAS,
    'Rosja': NEMUNAS,
    'Białoruś': NEMUNAS,
    'Ukraina': NEMUNAS,
    'Łotwa': DAUGAVA,
    'Szwecja': KATTEGAT,
    'Niemcy': DANISH,
    'Dania': DANISH
  },
  5: {
    'Niemcy': DANISH,
    'Dania': DANISH,
    'Szwecja': KATTEGAT,
    'Norwegia': KATTEGAT
  }
};

/** Country-share-weighted concentration for a catchment draining to the given sub-basin. */
export function estimateConc(g: RawGroup): NutrientPair {
  const fallback = SUB_BASIN_CONC[g.sub];
  const table = COUNTRY_CONC[g.sub];
  if (!table) return fallback;
  let w = 0, n = 0, p = 0;
  for (const [country, pct] of g.ctry) {
    const c = table[country] ?? fallback;
    w += pct; n += c.n * pct; p += c.p * pct;
  }
  return w > 0 ? { n: n / w, p: p / w } : fallback;
}

export interface LoadResult {
  load: NutrientPair;
  conc: NutrientPair;
  source: LoadSource;
}

export function computeLoads(g: RawGroup): LoadResult {
  if (g.kind !== 'basin' || g.dis <= 0) {
    return { load: { n: 0, p: 0 }, conc: { n: 0, p: 0 }, source: 'none' };
  }
  const measured = g.name ? MEASURED_LOADS[g.name] : undefined;
  if (measured) {
    return {
      load: { ...measured },
      conc: { n: measured.n * 1e6 / (g.dis * SECONDS_PER_YEAR), p: measured.p * 1e6 / (g.dis * SECONDS_PER_YEAR) },
      source: 'measured'
    };
  }
  const conc = estimateConc(g);
  return { load: { n: concToLoad(conc.n, g.dis), p: concToLoad(conc.p, g.dis) }, conc, source: 'estimated' };
}

/** Class breaks for area-specific load (kg/km²/yr); 7 classes per nutrient. */
export const SPEC_BREAKS: Record<Nutrient, number[]> = {
  n: [150, 250, 400, 600, 900, 1400],
  p: [6, 9, 13, 20, 30, 45]
};

/** Design-system palette tokens (single hue, light → dark) for each nutrient. */
export const RAMP_TOKENS: Record<Nutrient, string[]> = {
  n: ['warning-100', 'warning-200', 'warning-300', 'warning-400', 'warning-500', 'warning-700', 'warning-900'],
  p: ['success-100', 'success-200', 'success-300', 'success-400', 'success-500', 'success-700', 'success-900']
};

export function specClass(nutrient: Nutrient, value: number): number {
  const br = SPEC_BREAKS[nutrient];
  let k = 0;
  while (k < br.length && value >= br[k]) k++;
  return k;
}
