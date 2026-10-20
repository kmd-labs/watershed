export type Lang = 'en' | 'pl';

/**
 * Every user-facing text of the application in one language.
 * Add new translation keys here first so TypeScript enforces parity across en.ts and pl.ts.
 */
export interface Dict {
  htmlLang: string;
  docTitle: string;
  langName: string;
  /** BCP 47 locale used for number formatting. */
  numberLocale: string;

  // Top HUD & Navigation
  appName: string;
  changeLanguage: string;
  chooseView: string;
  viewNitrogen: string;
  viewPhosphorus: string;
  stageAriaLabel: string;
  loading: string;
  loadError: string;

  // Bottom Dock & Glossary
  glossary: string;
  glossaryDesc: string;
  close: string;

  // Application-specific keys (add below in both en.ts and pl.ts):
  nutrientName: { n: string; p: string };
  nutrientGenitive: { n: string; p: string };
  hint: string;
  panelTitle: string;
  totalFromRivers: string;
  perYear: string;
  tonnes: string;
  kilotonnes: string;
  specUnit: string;
  concUnit: string;
  flowUnit: string;
  areaUnit: string;
  km: string;
  collapsePanel: string;
  expandPanel: string;
  layers: string;
  layerRivers: string;
  layerDischarge: string;
  nutrientSwitch: string;
  tabRivers: string;
  tabCountries: string;
  countriesTitle: (nutrientGen: string) => string;
  countriesNote: string;
  layerBorders: string;
  layerLabels: string;
  layerOxygen: string;
  layerCyano: string;
  seaLayers: string;

  oxygenLegendTitle: string;
  oxygenWindow: string;
  oxygenAnoxic: string;
  oxygenHypoxic: string;
  oxygenModeLabel: string;
  oxygenModeState: string;
  oxygenModeChange: string;
  oxygenAppeared: string;
  oxygenPersistent: string;
  oxygenRecovered: string;
  oxygenChartTitle: string;
  oxygenChartHyp: string;
  oxygenChartAnox: string;
  oxygenChartPoint: (year: number, hypoxic: string, anoxic: string) => string;
  oxygenInflow: (year: number) => string;
  oxygenStateNote: string;
  oxygenChangeNote: string;
  thousandKm2: string;
  timelineLabel: string;
  play: string;
  pause: string;
  oxygenTooltip: (mlPerL: string) => string;
  oxygenTooltipAnoxic: string;
  oxygenTooltipHypoxic: string;
  cyanoLegendTitle: string;
  cyanoPeriod: (from: number, to: number) => string;
  cyanoTooltip: (pct: string) => string;
  cyanoUnavailable: string;
  layerLoading: string;
  noSeaData: string;
  methodOxygenTitle: string;
  methodOxygen: string;
  methodCyanoTitle: string;
  methodCyano: string;
  searchPlaceholder: string;
  search: string;
  subBasinFilter: string;
  allSubBasins: string;
  sortBy: string;
  sortLoad: string;
  sortSpec: string;
  sortFlow: string;
  sortName: string;
  listAll: (rivers: string) => string;
  listFound: (shown: string, total: string) => string;
  noResults: string;
  unnamed: string;
  coastName: string;
  estimatedMark: string;

  legendTitle: (nutrientGen: string) => string;
  legendDiscsTitle: (nutrientGen: string) => string;
  legendDiscs: (symbol: string) => string;
  legendNoData: string;

  detailMeasured: (year: number) => string;
  detailEstimated: string;
  detailCoast: string;
  drainsTo: string;
  basinKind: string;
  smallBasinKind: string;
  loadOf: (nutrientGen: string) => string;
  specLoad: string;
  concentration: string;
  shareOfTotal: string;
  rankLabel: string;
  rank: (rank: string, total: string) => string;
  hydrology: string;
  meanFlow: string;
  basinArea: string;
  mouth: string;
  nearestPlace: string;
  fromMouth: string;
  countriesInBasin: string;
  nutrientLoads: string;

  methodIntro: string;
  methodMeasuredTitle: string;
  methodMeasured: string;
  methodEstimatedTitle: string;
  methodEstimated: string;
  methodCheckTitle: string;
  methodCheck: (modelN: string, modelP: string, helcomN: string, helcomP: string) => string;
  methodTermsTitle: string;
  terms: { term: string; def: string }[];
  sourcesTitle: string;

  subNames: string[];
  countries: Record<string, string>;
  riverNames: Record<string, string>;
}
