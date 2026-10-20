import { Component, computed, inject } from '@angular/core';
import { I18nService } from '../core/i18n/i18n.service';
import { BalticDataService } from '../core/data/baltic-data.service';
import { HELCOM_REFERENCE } from '../core/data/nutrients';
import { SeaLayersService } from '../core/data/sea-layers';

/** Bibliographic citations — proper titles, intentionally not translated. */
const SOURCES = [
  {
    label: 'HELCOM (2021). Input of nutrients by the seven biggest rivers in the Baltic Sea region. BSEP n°178.',
    url: 'https://helcom.fi/wp-content/uploads/2021/09/The-seven-biggest-rivers-in-the-Baltic-Sea-Region.pdf'
  },
  {
    label: 'HELCOM (2025). Waterborne nitrogen and phosphorus inputs and water flow to the Baltic Sea 1995–2023. BSEFS.',
    url: 'https://helcom.fi/wp-content/uploads/2026/01/Waterborne-nitrogen-and-phosphorus-inputs-and-water-flow-to-the-Baltic-Sea-1995-2023.pdf'
  },
  {
    label: 'Lehner, B., Grill, G. (2013). HydroRIVERS v1.0 & HydroBASINS v1c, WWF / HydroSHEDS.',
    url: 'https://www.hydrosheds.org/products/hydrorivers'
  },
  {
    label: 'EMODnet Chemistry / SMHI (2025). Baltic Sea DIVAnd 6-year seasonal analysis of dissolved oxygen 1950/2023, v2025.',
    url: 'https://doi.org/10.13120/7ec4c23e-84eb-4e9c-97b4-b2a1c02137db'
  },
  {
    label: 'Hansson, M., Viktorsson, L. (2024). Oxygen Survey in the Baltic Sea 2024. SMHI Report Oceanography No. 80.',
    url: 'https://www.smhi.se/download/18.4cdca89f195b3c486e53433/1743575814314/Oxygen_timeseries_1960_2024.pdf'
  },
  {
    label: 'Copernicus Marine Service. Baltic Sea summer bloom coverage (OMI_HEALTH_BLOOM_BALTIC_spatiotemporal_coverage).',
    url: 'https://doi.org/10.48670/mds-00366'
  },
  {
    label: 'Kahru, M., Elmgren, R., Kaiser, J. et al. (2018). Unexplained interannual oscillations of cyanobacterial blooms in the Baltic Sea. Sci. Rep. 8, 6365.',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5913306/'
  },
  {
    label: 'Natural Earth — land, lakes & country borders.',
    url: 'https://www.naturalearthdata.com/'
  }
];

/** Methodology, glossary and sources, projected into the design-system popup. */
@Component({
  selector: 'app-method',
  standalone: true,
  template: `
    @let t = i18n.t();
    <p>{{ t.methodIntro }}</p>
    <h3>{{ t.methodMeasuredTitle }}</h3>
    <p>{{ t.methodMeasured }}</p>
    <h3>{{ t.methodEstimatedTitle }}</h3>
    <p>{{ t.methodEstimated }}</p>
    @if (check(); as c) {
      <h3>{{ t.methodCheckTitle }}</h3>
      <p>{{ c }}</p>
    }
    <h3>{{ t.methodOxygenTitle }}</h3>
    <p>{{ t.methodOxygen }}</p>
    @if (sea.cyanoAvailable()) {
      <h3>{{ t.methodCyanoTitle }}</h3>
      <p>{{ t.methodCyano }}</p>
    }
    <h3>{{ t.methodTermsTitle }}</h3>
    <dl>
      @for (term of t.terms; track term.term) {
        <dt>{{ term.term }}</dt>
        <dd>{{ term.def }}</dd>
      }
    </dl>
    <h3>{{ t.sourcesTitle }}</h3>
    <ul>
      @for (s of sources; track s.url) {
        <li><a [href]="s.url" target="_blank" rel="noopener">{{ s.label }}</a></li>
      }
    </ul>
  `,
  styles: `
    @use "variables" as *;
    :host { display: block; font-size: font-size("sm"); line-height: 1.55; color: color("text-desc"); user-select: text; }
    p { margin: 0 0 8px; }
    h3 { margin: 14px 0 4px; font-size: font-size("xs"); text-transform: uppercase; letter-spacing: 0.06em; color: color("text-dim"); }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0; }
    dt { font-weight: font-weight("semibold"); color: color("text-main"); }
    dd { margin: 0; }
    ul { margin: 0; padding-left: 18px; }
    li { margin-bottom: 4px; }
    a { color: color("link-color"); }
  `
})
export class MethodComponent {
  readonly i18n = inject(I18nService);
  private readonly store = inject(BalticDataService);
  readonly sea = inject(SeaLayersService);
  readonly sources = SOURCES;

  readonly check = computed(() => {
    const d = this.store.data();
    if (!d) return '';
    const t = this.i18n.t();
    const fmt = (v: number) => this.i18n.tonnes(v);
    return t.methodCheck(fmt(d.total.load.n), fmt(d.total.load.p), fmt(HELCOM_REFERENCE.n), fmt(HELCOM_REFERENCE.p));
  });
}
