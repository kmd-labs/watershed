export type Lang = 'en' | 'pl';

/**
 * Every user-facing text of the application in one language.
 * Add new translation keys here first so TypeScript enforces parity across en.ts and pl.ts.
 */
export interface Dict {
  htmlLang: string;
  docTitle: string;
  /** Page description for search engines and social previews (SeoService). */
  metaDescription: string;
  langName: string;
  /** BCP 47 locale used for number formatting. */
  numberLocale: string;

  // Top HUD & Navigation
  appName: string;
  changeLanguage: string;
  chooseView: string;
  stageAriaLabel: string;
  loading: string;
  loadError: string;
  splashBuilding: string;

  // Bottom Dock & Glossary
  glossary: string;
  glossaryDesc: string;
  close: string;

  // Application-specific keys (add below in both en.ts and pl.ts):
  hint: string;
  panelTitle: string;
  statArea: string;
  statOutflow: string;
  statRivers: string;
  statRiverKm: string;
  areaUnit: string;
  millionKm2: string;
  thousandKm: string;
  flowUnit: string;
  km: string;
  collapsePanel: string;
  expandPanel: string;
  layers: string;
  layerRivers: string;
  layerBorders: string;
  layerLabels: string;
  tabRivers: string;
  tabCountries: string;
  countriesTitle: string;
  countriesNote: string;
  countryRivers: (count: string) => string;

  viewCatchments: string;
  viewSeas: string;
  viewMosaic: string;
  legendMosaicTitle: string;
  viewRaindrop: string;
  layerFlow: string;
  layerRelief: string;
  groundLabel: string;
  groundWhite: string;
  groundBlack: string;
  poster: string;
  posterBusy: string;
  posterHint: string;
  posterStats: (area: string, mouths: string, rivers: string) => string;
  posterCredits: string;
  legendDrop: string;
  hintRaindrop: string;
  dropTitle: string;
  dropToSea: (km: string) => string;
  dropReaches: string;
  dropOverland: string;
  dropLakes: string;
  dropNoLakes: string;
  dropLakesValue: (count: string, km: string) => string;
  dropTime: string;
  dropTimeValue: (days: string) => string;
  dropTimeNote: string;
  dropHint: string;
  dropOutside: string;
  dropCoast: string;
  dropClear: string;
  methodReliefTitle: string;
  methodRelief: string;
  methodRaindropTitle: string;
  methodRaindrop: string;
  legendCatchment: string;
  legendCoast: string;
  legendLake: string;
  legendRiver: string;
  legendOutline: string;
  legendSeasTitle: string;

  searchPlaceholder: string;
  search: string;
  subBasinFilter: string;
  allSubBasins: string;
  sortBy: string;
  sortArea: string;
  sortFlow: string;
  sortName: string;
  listAll: (rivers: string) => string;
  listFound: (shown: string, total: string) => string;
  noResults: string;
  unnamed: string;
  coastName: string;

  detailCoast: string;
  drainsTo: string;
  basinKind: string;
  smallBasinKind: string;
  rankLabel: string;
  rank: (rank: string, total: string) => string;
  hydrology: string;
  meanFlow: string;
  basinArea: string;
  mainRiver: string;
  riverNetwork: string;
  mouth: string;
  nearestPlace: string;
  fromMouth: string;
  countriesInBasin: string;

  methodIntro: string;
  methodDataTitle: string;
  methodData: string;
  methodLakesTitle: string;
  methodLakes: string;
  methodTermsTitle: string;
  terms: { term: string; def: string }[];
  sourcesTitle: string;

  subNames: string[];
  countries: Record<string, string>;
  riverNames: Record<string, string>;
}
