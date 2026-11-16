import { Dict, PosterFactCtx, RiverShare, SeaOverlay } from './i18n.types';

/**
 * Polish texts for the seas other than the Baltic (the base dictionary is the Baltic's). Each
 * overlay replaces only what names the sea; Polish needs it in several cases.
 */
interface SeaPl {
  /** Mianownik: „Morze Północne to…”. */
  nom: string;
  /** Dopełniacz: „do Morza Północnego”. */
  gen: string;
  /** Celownik: „ku Morzu Północnemu”. */
  dat: string;
  inOne: string;
  finale: string;
  flowLine: (top: RiverShare[]) => string;
  subs: string[];
  intro: string;
  method: string;
  facts: (c: PosterFactCtx) => ReturnType<NonNullable<Dict['posterFacts']>>;
  sources: { label: string; url: string }[];
}

const MOUTHS_NOTE = (gen: string) =>
  `Ujścia rzek na wybrzeżu ${gen} w bazie HydroRIVERS v1.0 (WWF / HydroSHEDS; Lehner i Grill 2013), obejmującej każdy ciek o zlewni co najmniej 10 km² lub średnim przepływie co najmniej 0,1 m³/s.`;
const POP_NOTE =
  'GHSL GHS-POP R2023A (Komisja Europejska, JRC), stan na 2025 r., zsumowane w granicach zlewiska z mapy (HydroBASINS v1c).';
const FLOW_NOTE = 'Średni przepływ u ujścia z modelu WaterGAP (1971–2000), za HydroRIVERS v1.0 (Lehner i Grill 2013).';
const COUNTRIES_NOTE = 'Granice państw z Natural Earth przecięte ze zlewiskiem z mapy; liczone państwa z co najmniej 0,1% jego powierzchni.';
const AREA_NOTE = 'Powierzchnie zlewni z HydroRIVERS v1.0 i HydroBASINS v1c (WWF / HydroSHEDS; Lehner i Grill 2013).';
const METHOD_COMMON =
  'Zlewisko zbudowano z HydroRIVERS v1.0 i HydroBASINS v1c (poziom 12): każde ujście rzeki nad tym morzem wraz z całą zlewnią; drobne rzeki, które dzielą jedną jednostkę HydroBASINS, tworzą wspólną zlewnię. Nazwy rzek pochodzą z Wikidanych (rzeki, których ujście leży w tym morzu) i Natural Earth, nazwy miejscowości z GeoNames, a liczba mieszkańców z siatki GHSL GHS-POP 2025 (JRC).';
const COMMON_SOURCES = [
  {
    label: 'Schiavina, M., Freire, S., Carioli, A., MacManus, K. (2023). GHS-POP R2023A — GHS population grid multitemporal (1975–2030). European Commission, Joint Research Centre.',
    url: 'https://ghsl.jrc.ec.europa.eu/ghs_pop2023.php'
  },
  { label: 'Wikidata — rzeki i ich ujścia (P403).', url: 'https://www.wikidata.org/' },
  { label: 'GeoNames — miejscowości od 1000 mieszkańców.', url: 'https://www.geonames.org/' }
];

function overlay(s: SeaPl): SeaOverlay {
  return base => ({
    appName: `Zlewisko ${s.gen}`,
    docTitle: `KMD · Zlewisko ${s.gen}`,
    metaDescription: `Interaktywny globus 3D zlewiska ${s.gen}: każda zlewnia rzeki uchodzącej do ${s.gen}, akweny, do których odprowadza wodę, i państwa, przez które przebiega.`,
    stageAriaLabel: `Trójwymiarowy globus ze zlewiskiem ${s.gen}, zlewniami i rzekami`,
    panelTitle: `Zlewisko ${s.gen}`,
    seasNote: `${s.nom} to ${s.inOne}. Kolory odpowiadają widokowi „Zlewiska akwenów”; kliknij akwen, aby przelecieć do niego.`,
    countriesNote: `Powierzchnia każdego państwa w granicach zlewiska ${s.gen} (zlewnie HydroBASINS przecięte z granicami Natural Earth).`,
    storyIntroTitle: `Dokąd płyną rzeki ${s.gen}?`,
    storyIntroText: (area, mouths, rivers) =>
      `${area} lądu odprowadza wodę do ${s.gen} przez ${mouths} ujść rzek (HydroRIVERS v1.0, Lehner i Grill 2013) i ${rivers} rzek. Ta woda nie trafia w jedno miejsce: ${s.nom} to ${s.inOne}. Prześledźmy rzeki akwen po akwenie.`,
    storySeaText: (area, share) => `Rzeki, które tu uchodzą, odwadniają ${area}, czyli ${share} całego zlewiska ${s.gen}.`,
    storyFinaleTitle: s.finale,
    storyFinaleText: (sa, pa, sf, pf, top) =>
      `Najwięcej lądu zbiera ${sa} (${pa} zlewiska), a najwięcej wody rzecznej przyjmuje ${sf} (${pf}). ${s.flowLine(top)}`,
    storyFinaleTextSame: (sea, pa, pf, top) =>
      `${sea} zbiera zarówno najwięcej lądu (${pa} zlewiska), jak i najwięcej wody rzecznej (${pf}). ${s.flowLine(top)}`,
    topIntroText: (n, area, share, rivers) =>
      `Spośród ${rivers} rzek uchodzących do ${s.gen} (HydroRIVERS v1.0, Lehner i Grill 2013) zaledwie ${n} odwadnia ${area}, czyli ${share} całego lądu wokół morza. Przejdźmy przez nie po kolei, od największej.`,
    topRiverText: (area, share, sea) => `Odwadnia ${area} (${share} zlewiska ${s.gen}) i uchodzi do akwenu: ${sea}.`,
    topFinaleTitle: n => `${n} rzek, większość zlewiska`,
    posterTitle: s.nom,
    posterWhole: `Całe zlewisko ${s.gen}`,
    factBasinShare: `całego zlewiska ${s.gen}`,
    factsHeading: `${s.nom} w liczbach`,
    posterLine: `Wiele rzek. Wiele krajobrazów. Jeden wspólny los płynący ku ${s.dat}.`,
    dropOutside: `To miejsce leży poza zlewiskiem ${s.gen}: woda trafia stąd do innego morza. Spróbuj punktu na piaskowym lądzie.`,
    methodIntro: s.intro,
    methodSeaTitle: 'Jak wyznaczono to zlewisko',
    methodSea: `${METHOD_COMMON} ${s.method}`,
    terms: [{ ...base.terms[0], def: `Cały ląd odwadniany do jednego zbiornika, tutaj do ${s.gen}.` }, ...base.terms.slice(1)],
    subNames: s.subs,
    posterFacts: s.facts,
    sourcesExtra: [...COMMON_SOURCES, ...s.sources]
  });
}

const share = (top: RiverShare[], n: number) => `${Math.round(top.slice(0, n).reduce((a, r) => a + r.frac, 0) * 100)}%`;

export const SEAS_PL: Record<'north' | 'black' | 'med' | 'caspian', SeaOverlay> = {
  north: overlay({
    nom: 'Morze Północne',
    gen: 'Morza Północnego',
    dat: 'Morzu Północnemu',
    inOne: 'pięć akwenów w jednym',
    finale: 'Pięć akwenów, jedno Morze Północne',
    flowLine: top => `Sam ${top[0].name} dostarcza ${top[0].share} całej wody, jaką rzeki wnoszą do Morza Północnego.`,
    subs: [
      'Skagerrak',
      'Północna część Morza Północnego',
      'Zatoka Niemiecka i Morze Wattowe',
      'Południowa część Morza Północnego',
      'Zachodnia część Morza Północnego'
    ],
    intro:
      'Zlewisko Morza Północnego to cały ląd, z którego woda z deszczu i roztopów trafia do Morza Północnego: od Alp, gdzie zaczyna się Ren, po fiordy Norwegii i wschodnie wybrzeże Wielkiej Brytanii. Każda zlewnia na mapie to obszar odwadniany przez jedną rzekę aż do jej ujścia; pasy wybrzeża bez większej rzeki oddają wodę wprost do morza.',
    method: 'Rzeki uchodzące do kanału La Manche i do Kattegatu (należy już do Bałtyku) nie są tu liczone.',
    facts: c => [
      { value: c.nout, caption: 'rzek uchodzi do Morza Północnego', note: MOUTHS_NOTE('Morza Północnego') },
      { value: c.pop, caption: 'ludzi mieszka w jego zlewisku', note: POP_NOTE },
      {
        value: 'ok. 8150 lat',
        caption: 'temu tsunami Storegga uderzyło w Doggerland, ląd łączący Brytanię z kontynentem',
        note: 'Walker J. i in. (2020), A great wave: the Storegga tsunami and the end of Doggerland?, Antiquity 94(378): 1409–1425.'
      },
      { value: c.top[0].share, caption: `wody rzecznej wnosi ${c.top[0].name}`, note: FLOW_NOTE },
      { value: c.countries, caption: 'państw dzieli to zlewisko', note: COUNTRIES_NOTE }
    ],
    sources: [
      {
        label: 'Walker, J. et al. (2020). A great wave: the Storegga tsunami and the end of Doggerland? Antiquity 94(378): 1409–1425.',
        url: 'https://doi.org/10.15184/aqy.2020.49'
      }
    ]
  }),
  black: overlay({
    nom: 'Morze Czarne',
    gen: 'Morza Czarnego',
    dat: 'Morzu Czarnemu',
    inOne: 'pięć akwenów w jednym',
    finale: 'Pięć akwenów, jedno Morze Czarne',
    flowLine: top => `Sam ${top[0].name} dostarcza ${top[0].share} całej wody, jaką rzeki wnoszą do Morza Czarnego.`,
    subs: ['Morze Azowskie', 'Szelf północno-zachodni', 'Wschodnia część (Kaukaz)', 'Zachodnia część', 'Południowa część (Anatolia)'],
    intro:
      'Zlewisko Morza Czarnego to cały ląd, z którego woda z deszczu i roztopów trafia do Morza Czarnego i Azowskiego: od Schwarzwaldu, gdzie bije źródło Dunaju, przez stepy Ukrainy i Rosji po Kaukaz i Anatolię. Każda zlewnia na mapie to obszar odwadniany przez jedną rzekę aż do jej ujścia; pasy wybrzeża bez większej rzeki oddają wodę wprost do morza.',
    method: 'Morze Azowskie liczone jest razem z Morzem Czarnym; Morze Marmara już nie (należy do zlewiska Morza Śródziemnego).',
    facts: c => [
      { value: c.nout, caption: 'rzek uchodzi do Morza Czarnego i Azowskiego', note: MOUTHS_NOTE('Morza Czarnego i Azowskiego') },
      { value: c.pop, caption: 'ludzi mieszka w jego zlewisku', note: POP_NOTE },
      {
        value: '87%',
        caption: 'wód Morza Czarnego nie ma tlenu: głębiny wypełnia siarkowodór',
        note: 'Tlen jest tylko w górnych 150–200 m, czyli w 13% objętości morza: ODEMM, Black Sea Background (University of Liverpool).'
      },
      { value: c.top[0].share, caption: `wody rzecznej wnosi ${c.top[0].name}`, note: FLOW_NOTE },
      { value: c.countries, caption: 'państw dzieli to zlewisko', note: COUNTRIES_NOTE }
    ],
    sources: [
      {
        label: 'ODEMM (University of Liverpool). Black Sea Background: oxygen only in the upper 150–200 m (13% of the sea volume).',
        url: 'https://www.liverpool.ac.uk/media/livacuk/odemmnew/docs/Black_Sea_Background.pdf'
      }
    ]
  }),
  med: overlay({
    nom: 'Morze Śródziemne',
    gen: 'Morza Śródziemnego',
    dat: 'Morzu Śródziemnemu',
    inOne: 'sześć akwenów w jednym',
    finale: 'Sześć akwenów, jedno Morze Śródziemne',
    flowLine: top =>
      `Najwięcej wody wnoszą ${top[0].name}, ${top[1].name} i ${top[2].name}: razem ${share(top, 3)} całej wody, jaką rzeki niosą do Morza Śródziemnego.`,
    subs: ['Morze Adriatyckie', 'Morze Tyrreńskie', 'Morze Egejskie i Marmara', 'Morze Lewantyńskie', 'Basen zachodni', 'Morze Jońskie i środkowe'],
    intro:
      'Zlewisko Morza Śródziemnego to cały ląd, z którego woda z deszczu i roztopów trafia do Morza Śródziemnego: od Alp i Pirenejów po Atlas, Anatolię i deltę Nilu. Każda zlewnia na mapie to obszar odwadniany przez jedną rzekę aż do jej ujścia; pasy wybrzeża bez większej rzeki oddają wodę wprost do morza.',
    method:
      'Nil pokazano tylko w Egipcie, na północ od 22°N: jego dorzecze w górnym biegu (ok. 3 mln km²) pominięto, a powierzchnię i liczbę mieszkańców liczono tylko dla tej części. Przepływ Nilu to przepływ naturalny z modelu, bez wpływu tamy w Asuanie. Morze Marmara liczone jest razem z Morzem Egejskim.',
    facts: c => [
      { value: c.nout, caption: 'rzek uchodzi do Morza Śródziemnego', note: MOUTHS_NOTE('Morza Śródziemnego') },
      { value: c.pop, caption: 'ludzi mieszka w jego zlewisku (z dolnym Nilem)', note: POP_NOTE },
      {
        value: '80–100 lat',
        caption: 'trwa wymiana wody w morzu przez Cieśninę Gibraltarską',
        note: 'Karydis M., Kitsiou D. (2012), Eutrophication and environmental policy in the Mediterranean Sea: a review, Environmental Monitoring and Assessment 184(8): 4931–4984.'
      },
      {
        value: '5,33 mln lat',
        caption: 'temu Atlantyk ponownie wypełnił wyschnięte morze',
        note: 'Potop zanklejski: Garcia-Castellanos D. i in. (2009), Catastrophic flood of the Mediterranean after the Messinian salinity crisis, Nature 462: 778–781.'
      },
      { value: c.countries, caption: 'państw dzieli to zlewisko', note: COUNTRIES_NOTE }
    ],
    sources: [
      {
        label: 'Karydis, M., Kitsiou, D. (2012). Eutrophication and environmental policy in the Mediterranean Sea: a review. Environmental Monitoring and Assessment 184(8): 4931–4984.',
        url: 'https://doi.org/10.1007/s10661-011-2313-2'
      },
      {
        label: 'Garcia-Castellanos, D. et al. (2009). Catastrophic flood of the Mediterranean after the Messinian salinity crisis. Nature 462: 778–781.',
        url: 'https://doi.org/10.1038/nature08555'
      }
    ]
  }),
  caspian: overlay({
    nom: 'Morze Kaspijskie',
    gen: 'Morza Kaspijskiego',
    dat: 'Morzu Kaspijskiemu',
    inOne: 'trzy akweny w jednym',
    finale: 'Trzy akweny, jedno Morze Kaspijskie',
    flowLine: top => `Sama ${top[0].name} dostarcza ${top[0].share} całej wody, jaką rzeki wnoszą do Morza Kaspijskiego.`,
    subs: ['Północny Kaspij', 'Środkowy Kaspij', 'Południowy Kaspij'],
    intro:
      'Zlewisko Morza Kaspijskiego to cały ląd, z którego woda z deszczu i roztopów trafia do największego zamkniętego zbiornika na Ziemi: przede wszystkim dorzecze Wołgi, a także rzeki Kaukazu, Iranu i Kazachstanu. Każda zlewnia na mapie to obszar odwadniany przez jedną rzekę aż do jej ujścia; pasy wybrzeża bez większej rzeki oddają wodę wprost do morza.',
    method:
      'Liczone są tylko obszary, z których woda rzekami dociera do morza. Bezodpływowe niecki w głębi lądu do zlewiska nie należą, dlatego wychodzi ono mniejsze niż często podawane ok. 3,6 mln km².',
    facts: c => [
      { value: c.nout, caption: 'rzek uchodzi do Morza Kaspijskiego', note: MOUTHS_NOTE('Morza Kaspijskiego') },
      { value: c.pop, caption: 'ludzi mieszka w jego zlewisku', note: POP_NOTE },
      {
        value: '80%',
        caption: 'wody wpływającej do morza niesie Wołga',
        note: 'GRID-Arendal (UNEP), Annual flow of water to the Caspian Sea: „The Volga alone accounts for 80% of inflow”.'
      },
      { value: c.topArea.share, caption: 'zlewiska zajmuje dorzecze Wołgi', note: AREA_NOTE },
      { value: c.countries, caption: 'państw dzieli to zlewisko', note: COUNTRIES_NOTE }
    ],
    sources: [{ label: 'GRID-Arendal (UNEP). Annual flow of water to the Caspian Sea.', url: 'https://www.grida.no/resources/6099' }]
  })
};
