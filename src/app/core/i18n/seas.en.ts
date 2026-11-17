import { Dict, PosterFactCtx, RiverShare, SeaOverlay } from './i18n.types';

/** English texts for the seas other than the Baltic (the base dictionary is the Baltic's). */
interface SeaEn {
  /** "the North Sea" (in running text). */
  the: string;
  /** "North Sea" (titles). */
  name: string;
  /** Poster title. */
  title: string;
  inOne: string;
  finale: string;
  flowLine: (top: RiverShare[]) => string;
  subs: string[];
  intro: string;
  method: string;
  facts: (c: PosterFactCtx) => ReturnType<NonNullable<Dict['posterFacts']>>;
  sources: { label: string; url: string }[];
}

const MOUTHS_NOTE = (the: string) =>
  `River mouths on the coast of ${the} in HydroRIVERS v1.0 (WWF / HydroSHEDS; Lehner & Grill 2013), which maps every stream with a catchment of at least 10 km² or a mean flow of at least 0.1 m³/s.`;
const POP_NOTE = 'GHSL GHS-POP R2023A (European Commission, JRC), 2025, summed within the drainage basin shown (HydroBASINS v1c).';
const FLOW_NOTE = 'Mean flow at the mouth modelled by WaterGAP (1971–2000), after HydroRIVERS v1.0 (Lehner & Grill 2013).';
const COUNTRIES_NOTE = 'Natural Earth country borders intersected with the drainage basin shown; countries with at least 0.1% of it.';
const AREA_NOTE = 'Catchment areas from HydroRIVERS v1.0 and HydroBASINS v1c (WWF / HydroSHEDS; Lehner & Grill 2013).';
const METHOD_COMMON =
  'The basin is built from HydroRIVERS v1.0 and HydroBASINS v1c (level 12): every river mouth on this sea with its whole catchment; small rivers sharing one HydroBASINS unit form one catchment. River names come from Wikidata (rivers whose mouth lies in this sea) and Natural Earth, place names from GeoNames, and populations from the GHSL GHS-POP 2025 grid (JRC).';
const COMMON_SOURCES = [
  {
    label: 'Schiavina, M., Freire, S., Carioli, A., MacManus, K. (2023). GHS-POP R2023A — GHS population grid multitemporal (1975–2030). European Commission, Joint Research Centre.',
    url: 'https://ghsl.jrc.ec.europa.eu/ghs_pop2023.php'
  },
  { label: 'Wikidata — rivers and their mouths (P403).', url: 'https://www.wikidata.org/' },
  { label: 'GeoNames — places of at least 1,000 people.', url: 'https://www.geonames.org/' }
];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function overlay(s: SeaEn): SeaOverlay {
  return base => ({
    appName: `${s.name} Watershed`,
    docTitle: `KMD · ${s.name} Watershed`,
    metaDescription: `Interactive 3D globe of the ${s.name} drainage basin: every river catchment that drains to ${s.the}, the sea sub-basins they feed and the countries they cross.`,
    stageAriaLabel: `3D globe of the ${s.name} drainage basin with river catchments and rivers`,
    panelTitle: `${s.name} drainage basin`,
    seasNote: `${cap(s.the)} is ${s.inOne}. The colours match the "Sea sub-basins" view; click a sea to fly to it.`,
    countriesNote: `Area of each country inside the ${s.name} drainage basin (HydroBASINS catchments intersected with Natural Earth borders).`,
    storyIntroTitle: `Where do the rivers of ${s.the} end?`,
    storyIntroText: (area, mouths, rivers) =>
      `${area} of land drains into ${s.the} through ${mouths} river mouths (HydroRIVERS v1.0, Lehner & Grill 2013) and ${rivers} of rivers. The water does not all end up in the same place: ${s.the} is ${s.inOne}. Let’s follow the rivers, sea by sea.`,
    storySeaText: (area, share) => `Rivers that end here drain ${area} — ${share} of the whole ${s.name} basin.`,
    storyFinaleTitle: s.finale,
    storyFinaleText: (sa, pa, sf, pf, top) =>
      `The ${sa} collects the most land (${pa} of the basin), while the ${sf} receives the most river water (${pf}). ${s.flowLine(top)}`,
    storyFinaleTextSame: (sea, pa, pf, top) =>
      `The ${sea} both collects the most land (${pa} of the basin) and receives the most river water (${pf}). ${s.flowLine(top)}`,
    topIntroText: (n, area, share, rivers) =>
      `Of the ${rivers} rivers that flow into ${s.the} (HydroRIVERS v1.0, Lehner & Grill 2013), just ${n} drain ${area} — ${share} of all the land around the sea. Let’s go through them one by one, from the largest.`,
    topRiverText: (area, share, sea) => `Drains ${area} (${share} of the ${s.name} basin) into the ${sea}.`,
    topFinaleTitle: n => `${n} rivers, most of the basin`,
    posterTitle: s.title,
    posterWhole: `The whole ${s.name} drainage basin`,
    factBasinShare: `of the ${s.name} drainage basin`,
    factsHeading: `${cap(s.the)} in numbers`,
    posterLine: `Many Rivers. Many Landscapes. One shared destiny flowing towards ${s.the}.`,
    dropOutside: `That spot is outside the ${s.name} drainage basin: its water ends up in another sea. Try a point on the sand-coloured land.`,
    methodIntro: s.intro,
    methodSeaTitle: 'How this basin was drawn',
    methodSea: `${METHOD_COMMON} ${s.method}`,
    terms: [{ ...base.terms[0], def: `All land that drains to one water body, here ${s.the}.` }, ...base.terms.slice(1)],
    subNames: s.subs,
    posterFacts: s.facts,
    sourcesExtra: [...COMMON_SOURCES, ...s.sources]
  });
}

const share = (top: RiverShare[], n: number) => `${Math.round(top.slice(0, n).reduce((a, r) => a + r.frac, 0) * 100)}%`;

export const SEAS_EN: Record<'north' | 'black' | 'med' | 'caspian', SeaOverlay> = {
  north: overlay({
    the: 'the North Sea',
    name: 'North Sea',
    title: 'The North Sea',
    inOne: 'five seas in one',
    finale: 'Five seas, one North Sea',
    flowLine: top => `The ${top[0].name} alone brings ${top[0].share} of everything the rivers deliver to the North Sea.`,
    subs: ['Skagerrak', 'Northern North Sea', 'German Bight & Wadden Sea', 'Southern North Sea', 'Western North Sea'],
    intro:
      'The North Sea drainage basin is all the land whose rain and snowmelt ends up in the North Sea: from the Alps, where the Rhine begins, to the fjords of Norway and the east coast of Britain. Every catchment on the map is the area drained by one river down to its mouth; coastal strips without a sizeable river drain straight to the sea.',
    method: 'Rivers flowing into the English Channel or the Kattegat (which belongs to the Baltic) are not counted here. Rivers ending in the IJsselmeer and Markermeer (which drain through the Afsluitdijk sluices into the Wadden Sea) or in the Rhine–Meuse delta waters (Haringvliet, Hollands Diep) count as flowing into the North Sea.',
    facts: c => [
      { value: c.nout, caption: 'rivers flow into the North Sea', note: MOUTHS_NOTE('the North Sea') },
      { value: c.pop, caption: 'people live in its drainage basin', note: POP_NOTE },
      {
        value: '≈ 8,150 years',
        caption: 'since the Storegga tsunami struck Doggerland, the land linking Britain to the continent',
        note: 'Walker J. et al. (2020), A great wave: the Storegga tsunami and the end of Doggerland?, Antiquity 94(378): 1409–1425.'
      },
      { value: c.top[0].share, caption: `of all river water comes from the ${c.top[0].name}`, note: FLOW_NOTE },
      { value: c.countries, caption: 'countries share the basin', note: COUNTRIES_NOTE }
    ],
    sources: [
      {
        label: 'Walker, J. et al. (2020). A great wave: the Storegga tsunami and the end of Doggerland? Antiquity 94(378): 1409–1425.',
        url: 'https://doi.org/10.15184/aqy.2020.49'
      }
    ]
  }),
  black: overlay({
    the: 'the Black Sea',
    name: 'Black Sea',
    title: 'The Black Sea',
    inOne: 'five seas in one',
    finale: 'Five seas, one Black Sea',
    flowLine: top => `The ${top[0].name} alone brings ${top[0].share} of everything the rivers deliver to the Black Sea.`,
    subs: ['Sea of Azov', 'North-western shelf', 'Eastern Black Sea (Caucasus)', 'Western Black Sea', 'Southern Black Sea (Anatolia)'],
    intro:
      'The Black Sea drainage basin is all the land whose rain and snowmelt ends up in the Black Sea and the Sea of Azov: from the Black Forest, where the Danube rises, across the steppes of Ukraine and Russia to the Caucasus and Anatolia. Every catchment on the map is the area drained by one river down to its mouth; coastal strips without a sizeable river drain straight to the sea.',
    method: 'The Sea of Azov is counted with the Black Sea; the Sea of Marmara is not (it belongs to the Mediterranean basin).',
    facts: c => [
      { value: c.nout, caption: 'rivers flow into the Black Sea and the Sea of Azov', note: MOUTHS_NOTE('the Black Sea and the Sea of Azov') },
      { value: c.pop, caption: 'people live in its drainage basin', note: POP_NOTE },
      {
        value: '87%',
        caption: 'of the Black Sea’s water holds no oxygen: its depths are full of hydrogen sulphide',
        note: 'Oxygen only in the upper 150–200 m, 13% of the sea’s volume: ODEMM, Black Sea Background (University of Liverpool).'
      },
      { value: c.top[0].share, caption: `of all river water comes from the ${c.top[0].name}`, note: FLOW_NOTE },
      { value: c.countries, caption: 'countries share the basin', note: COUNTRIES_NOTE }
    ],
    sources: [
      {
        label: 'ODEMM (University of Liverpool). Black Sea Background: oxygen only in the upper 150–200 m (13% of the sea volume).',
        url: 'https://www.liverpool.ac.uk/media/livacuk/odemmnew/docs/Black_Sea_Background.pdf'
      }
    ]
  }),
  med: overlay({
    the: 'the Mediterranean',
    name: 'Mediterranean',
    title: 'The Mediterranean',
    inOne: 'six seas in one',
    finale: 'Six seas, one Mediterranean',
    flowLine: top =>
      `The ${top[0].name}, the ${top[1].name} and the ${top[2].name} bring the most water: together ${share(top, 3)} of everything the rivers carry to the Mediterranean.`,
    subs: ['Adriatic Sea', 'Tyrrhenian Sea', 'Aegean & Marmara', 'Levantine Sea', 'Western basin', 'Ionian & Central Med.'],
    intro:
      'The Mediterranean drainage basin is all the land whose rain and snowmelt ends up in the Mediterranean: from the Alps and the Pyrenees to the Atlas, Anatolia and the Nile delta. Every catchment on the map is the area drained by one river down to its mouth; coastal strips without a sizeable river drain straight to the sea.',
    method:
      'The Nile is shown in Egypt only, north of 22°N: its upstream basin (about 3 million km²) is left out, and its area and population count that part alone. Its flow is the model’s natural flow, without the Aswan dam. The Sea of Marmara is counted with the Aegean.',
    facts: c => [
      { value: c.nout, caption: 'rivers flow into the Mediterranean', note: MOUTHS_NOTE('the Mediterranean') },
      { value: c.pop, caption: 'people live in its drainage basin (with the lower Nile)', note: POP_NOTE },
      {
        value: '80–100 years',
        caption: 'for the sea to renew its water through the Strait of Gibraltar',
        note: 'Karydis M., Kitsiou D. (2012), Eutrophication and environmental policy in the Mediterranean Sea: a review, Environmental Monitoring and Assessment 184(8): 4931–4984.'
      },
      {
        value: '5.33 million years',
        caption: 'since the Atlantic refilled the dried-out sea',
        note: 'The Zanclean flood: Garcia-Castellanos D. et al. (2009), Catastrophic flood of the Mediterranean after the Messinian salinity crisis, Nature 462: 778–781.'
      },
      { value: c.countries, caption: 'countries share the basin', note: COUNTRIES_NOTE }
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
    the: 'the Caspian',
    name: 'Caspian Sea',
    title: 'The Caspian',
    inOne: 'three seas in one',
    finale: 'Three seas, one Caspian',
    flowLine: top => `The ${top[0].name} alone brings ${top[0].share} of everything the rivers deliver to the Caspian.`,
    subs: ['North Caspian', 'Middle Caspian', 'South Caspian'],
    intro:
      'The Caspian Sea drainage basin is all the land whose rain and snowmelt ends up in the largest enclosed body of water on Earth: above all the Volga basin, but also rivers of the Caucasus, Iran and Kazakhstan. Every catchment on the map is the area drained by one river down to its mouth; coastal strips without a sizeable river drain straight to the sea.',
    method:
      'Only land whose water reaches the sea by river is counted. Closed basins further inland are not part of it, which is why it comes out smaller than the often-quoted 3.6 million km².',
    facts: c => [
      { value: c.nout, caption: 'rivers flow into the Caspian', note: MOUTHS_NOTE('the Caspian') },
      { value: c.pop, caption: 'people live in its drainage basin', note: POP_NOTE },
      {
        value: '80%',
        caption: 'of the water flowing into the sea comes from the Volga',
        note: 'GRID-Arendal (UNEP), Annual flow of water to the Caspian Sea: “The Volga alone accounts for 80% of inflow”.'
      },
      { value: c.topArea.share, caption: 'of the drainage basin is the Volga’s', note: AREA_NOTE },
      { value: c.countries, caption: 'countries share the basin', note: COUNTRIES_NOTE }
    ],
    sources: [{ label: 'GRID-Arendal (UNEP). Annual flow of water to the Caspian Sea.', url: 'https://www.grida.no/resources/6099' }]
  })
};
