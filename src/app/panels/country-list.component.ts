import { Component, computed, inject, input } from '@angular/core';
import { I18nService } from '../core/i18n/i18n.service';
import { BalticData } from '../core/data/baltic.model';
import { Nutrient } from '../core/data/nutrients';

/** Riverine N / P loads aggregated per country (area-share apportionment). */
@Component({
  selector: 'app-country-list',
  standalone: true,
  template: `
    @let t = i18n.t();
    <div class="list-title">
      <span>{{ t.countriesTitle(t.nutrientGenitive[nutrient()]) }}</span>
      <span class="list-title__unit">{{ t.perYear }}</span>
    </div>
    <div class="list" role="table" [attr.aria-label]="t.countriesTitle(t.nutrientGenitive[nutrient()])">
      @for (r of rows(); track r.name) {
        <div class="row" role="row">
          <span class="row__name" role="cell">
            {{ r.label }}
            <em class="row__sub">· {{ r.other }}</em>
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
  readonly nutrient = input<Nutrient>('n');

  readonly rows = computed(() => {
    const nut = this.nutrient();
    const other: Nutrient = nut === 'n' ? 'p' : 'n';
    const d = this.data();
    const total = d.total.load[nut];
    const list = [...d.countries].sort((a, b) => b.load[nut] - a.load[nut]);
    const max = list[0]?.load[nut] ?? 1;
    return list.map(c => ({
      name: c.name,
      label: this.i18n.country(c.name),
      other: `${other.toUpperCase()} ${this.i18n.tonnes(c.load[other])}`,
      value: this.i18n.tonnes(c.load[nut]),
      bar: (c.load[nut] / max) * 100,
      share: `${this.i18n.num((c.load[nut] / total) * 100, 1)}%`
    }));
  });
}
