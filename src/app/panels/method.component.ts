import { Component, computed, inject } from '@angular/core';
import { I18nService } from '../core/i18n/i18n.service';
import { BalticDataService } from '../core/data/baltic-data.service';
import { HELCOM_REFERENCE } from '../core/data/nutrients';

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
  readonly sources = SOURCES;

  readonly check = computed(() => {
    const d = this.store.data();
    if (!d) return '';
    const t = this.i18n.t();
    const fmt = (v: number) => this.i18n.tonnes(v);
    return t.methodCheck(fmt(d.total.load.n), fmt(d.total.load.p), fmt(HELCOM_REFERENCE.n), fmt(HELCOM_REFERENCE.p));
  });
}
