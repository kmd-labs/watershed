import { Dict } from './i18n.types';

export const PL: Dict = {
  htmlLang: 'pl',
  docTitle: 'KMD · Ładunki biogenów do Bałtyku',
  langName: 'Polski',
  numberLocale: 'pl-PL',

  // Top HUD & Navigation
  appName: 'Biogeny w zlewisku Bałtyku',
  changeLanguage: 'Język',
  chooseView: 'Pierwiastek',
  viewNitrogen: 'Azot (N)',
  viewPhosphorus: 'Fosfor (P)',
  stageAriaLabel: 'Trójwymiarowy globus ze zlewiskiem Morza Bałtyckiego i ładunkami azotu oraz fosforu',
  loading: 'Wczytywanie danych…',
  loadError: 'Nie udało się wczytać danych.',

  // Bottom Dock & Glossary
  glossary: 'Metodologia',
  glossaryDesc: 'Skąd pochodzą liczby na mapie i jak je liczymy.',
  close: 'Zamknij',

  // Application-specific keys:
  nutrientName: { n: 'Azot', p: 'Fosfor' },
  nutrientGenitive: { n: 'azotu', p: 'fosforu' },
  hint: 'Kliknij zlewnię lub słupek · przeciągnij, aby obracać · przewiń, aby przybliżyć',
  panelTitle: 'Rzeki → Bałtyk',
  totalFromRivers: 'Łącznie z rzek',
  perYear: '/rok',
  tonnes: 't',
  kilotonnes: 'tys. t',
  specUnit: 'kg/km² · rok',
  concUnit: 'mg/l',
  flowUnit: 'm³/s',
  areaUnit: 'km²',
  km: 'km',
  collapsePanel: 'Zwiń panel',
  expandPanel: 'Rozwiń panel',
  layers: 'Warstwy',
  layerRivers: 'Rzeki',
  layerColumns: 'Słupki',
  layerBorders: 'Granice',
  layerLabels: 'Nazwy',
  searchPlaceholder: 'Szukaj rzeki lub miejscowości…',
  search: 'Szukaj',
  subBasinFilter: 'Akwen',
  allSubBasins: 'Wszystkie akweny',
  sortBy: 'Sortowanie',
  sortLoad: 'wg ładunku',
  sortSpec: 'wg ładunku jednostkowego',
  sortFlow: 'wg przepływu',
  sortName: 'wg nazwy',
  listAll: rivers => `Wszystkie rzeki: ${rivers}`,
  listFound: (shown, total) => `Znaleziono: ${shown} z ${total}`,
  noResults: 'Brak wyników.',
  unnamed: 'bez nazwy',
  coastName: 'Wybrzeże bez większych cieków',
  estimatedMark: '≈ szacunek',

  legendTitle: g => `Ładunek jednostkowy ${g}`,
  legendColumns: 'Wysokość słupka = roczny ładunek u ujścia',
  legendNoData: 'brak rzek',

  detailMeasured: year => `Pomiar HELCOM PLC-7 (${year})`,
  detailEstimated: 'Szacunek: przepływ × typowe stężenie',
  detailCoast: 'Pasy wybrzeża i wysp odwadniane bezpośrednio do morza, bez rzek o zlewni ≥ 10 km². Ładunki z tych obszarów nie są tu liczone.',
  drainsTo: 'uchodzi do',
  basinKind: 'Dorzecze',
  smallBasinKind: 'Zlewnia małej rzeki',
  loadOf: g => `Ładunek ${g}`,
  specLoad: 'Ładunek jednostkowy',
  concentration: 'Stężenie (ważone przepływem)',
  shareOfTotal: 'Udział w ładunku z rzek',
  rankLabel: 'Miejsce w rankingu',
  rank: (rank, total) => `${rank}. z ${total}`,
  hydrology: 'Hydrologia',
  meanFlow: 'Średni przepływ u ujścia',
  basinArea: 'Powierzchnia dorzecza',
  mouth: 'Ujście',
  nearestPlace: 'Najbliższa miejscowość',
  fromMouth: 'od ujścia',
  countriesInBasin: 'Kraje w dorzeczu',
  nutrientLoads: 'Ładunki biogenów',

  methodIntro:
    'Azot (N) i fosfor (P) spływające rzekami są główną przyczyną eutrofizacji Bałtyku: zakwitów sinic, przyduchy i stref beztlenowych przy dnie. Mapa pokazuje roczny ładunek, który każda rzeka wnosi do morza.',
  methodMeasuredTitle: 'Pomiary (7 największych rzek)',
  methodMeasured:
    'Wisła, Niemen, Odra, Newa, Dźwina, Göta älv i Kemijoki: ładunki całkowitego azotu i fosforu raportowane do HELCOM za rok 2017 (PLC-7). Rok 2017 był na południu zlewiska mokry, więc np. Niemen niósł prawie dwa razy więcej azotu niż średnio.',
  methodEstimatedTitle: 'Szacunki (pozostałe rzeki)',
  methodEstimated:
    'Ładunek = modelowany średni przepływ u ujścia (HydroRIVERS / WaterGAP) × typowe stężenie N i P ważone przepływem. Stężenia to średnie HELCOM 2013–2022 dla akwenu, do którego uchodzi rzeka. W Bałtyku Właściwym i w Cieśninach Duńskich stężenie ważono udziałem krajów w dorzeczu (rzeki polskie jak Wisła i Odra, litewskie i białoruskie jak Niemen, szwedzkie jak Kattegat, duńskie i niemieckie jak Cieśniny Duńskie). To przybliżenie: lokalne zrzuty ścieków czy rolnictwo mogą zmienić wynik konkretnej rzeki nawet kilkukrotnie.',
  methodCheckTitle: 'Kontrola sumy',
  methodCheck: (mN, mP, hN, hP) =>
    `Suma modelu: ${mN} azotu i ${mP} fosforu rocznie. HELCOM podaje dla całego Bałtyku (rzeki + zrzuty bezpośrednie, średnia 2013–2022) ${hN} azotu i ${hP} fosforu. Wyższa suma azotu wynika głównie z mokrego roku 2017 w pomiarach dużych rzek.`,
  methodTermsTitle: 'Słowniczek',
  terms: [
    { term: 'Ładunek', def: 'Masa pierwiastka wnoszona przez rzekę do morza w ciągu roku (tony/rok).' },
    { term: 'Ładunek jednostkowy', def: 'Ładunek podzielony przez powierzchnię dorzecza (kg/km² · rok). Pokazuje, jak intensywnie zlewnia „wypłukuje” biogeny, niezależnie od jej wielkości.' },
    { term: 'Azot całkowity (TN)', def: 'Suma wszystkich form azotu: azotanów, amonu i azotu organicznego. Pochodzi głównie z nawożenia pól.' },
    { term: 'Fosfor całkowity (TP)', def: 'Suma rozpuszczonego i zawieszonego fosforu. Ważne źródła to ścieki komunalne oraz erozja gleb rolnych.' },
    { term: 'Eutrofizacja', def: 'Przeżyźnienie wód biogenami, prowadzące do zakwitów glonów i niedoboru tlenu przy dnie.' }
  ],
  sourcesTitle: 'Źródła',

  subNames: [
    'Zatoka Botnicka',
    'Morze Botnickie i Alandzkie',
    'Zatoka Fińska',
    'Zatoka Ryska',
    'Bałtyk Właściwy',
    'Cieśniny Duńskie i Kattegat'
  ],
  countries: {},
  riverNames: {}
};
