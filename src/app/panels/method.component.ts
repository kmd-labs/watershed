import { Component, inject } from '@angular/core';
import { I18nService } from '../core/i18n/i18n.service';

/** Bibliographic citations — proper titles, intentionally not translated. */
const SOURCES = [
  {
    label: "Lehner, B., Grill, G. (2013). Global river hydrography and network routing: baseline data and new approaches to study the world's large river systems. Hydrological Processes 27(15). HydroRIVERS v1.0 & HydroBASINS v1c, WWF / HydroSHEDS.",
    url: 'https://www.hydrosheds.org/products/hydrorivers'
  },
  {
    label: 'Döll, P., Kaspar, F., Lehner, B. (2003). A global hydrological model for deriving water availability indicators: model tuning and validation (WaterGAP). Journal of Hydrology 270.',
    url: 'https://doi.org/10.1016/S0022-1694(02)00283-4'
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
    <h3>{{ t.methodDataTitle }}</h3>
    <p>{{ t.methodData }}</p>
    <h3>{{ t.methodLakesTitle }}</h3>
    <p>{{ t.methodLakes }}</p>
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
  readonly sources = SOURCES;
}
