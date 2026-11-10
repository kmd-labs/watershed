import { Component, computed, inject, input } from '@angular/core';
import { I18nService } from '../core/i18n/i18n.service';
import { BalticData } from '../core/data/baltic.model';

/** Each country's share of the Baltic Sea drainage basin. */
@Component({
  selector: 'app-country-list',
  standalone: true,
  template: `
    @let t = i18n.t();
    <div class="list-title">
      <span>{{ t.countriesTitle }}</span>
    </div>
    <div class="list" role="table" [attr.aria-label]="t.countriesTitle">
      @for (r of rows(); track r.name) {
        <div class="row" role="row">
          <span class="row__name" role="cell">
            {{ r.label }}
            <em class="row__sub">· {{ r.rivers }}</em>
          </span>
          <span class="row__bar" aria-hidden="true"><span [style.width.%]="r.bar"></span></span>
          <b class="row__value" role="cell">{{ r.value }}</b>
          <span class="row__share" role="cell">{{ r.share }}</span>
        </div>
      }
    </div>
    <p class="note">{{ t.countriesNote }}</p>
  `,
  styleUrls: ['./basin-list.component.scss', './country-list.component.scss']
})
export class CountryListComponent {
  readonly i18n = inject(I18nService);

  readonly data = input.required<BalticData>();

  readonly rows = computed(() => {
    const t = this.i18n.t();
    const list = [...this.data().countries].sort((a, b) => b.area - a.area);
    const max = list[0]?.area ?? 1;
    return list.map(c => ({
      name: c.name,
      label: this.i18n.country(c.name),
      rivers: t.countryRivers(this.i18n.num(c.rivers)),
      value: this.i18n.area(Math.round(c.area / 100) * 100),
      bar: (c.area / max) * 100,
      share: `${this.i18n.num(c.pct, 1)}%`
    }));
  });
}
