import { Component, computed, inject, input, output } from '@angular/core';
import { LucideAngularModule, X } from 'lucide-angular';
import { BadgeComponent, ButtonComponent, ThemeService } from '@kmd/design-system';
import { I18nService } from '../core/i18n/i18n.service';
import { BalticData, Basin } from '../core/data/baltic.model';
import { MEASURED_YEAR, Nutrient, RAMP_TOKENS, specClass } from '../core/data/nutrients';

/** Floating card with nutrient loads and hydrology of the selected catchment. */
@Component({
  selector: 'app-basin-detail',
  standalone: true,
  imports: [LucideAngularModule, ButtonComponent, BadgeComponent],
  templateUrl: './basin-detail.component.html',
  styleUrl: './basin-detail.component.scss'
})
export class BasinDetailComponent {
  readonly i18n = inject(I18nService);
  private readonly theme = inject(ThemeService);

  readonly data = input.required<BalticData>();
  readonly basin = input.required<Basin>();
  readonly nutrient = input<Nutrient>('n');
  readonly close = output<void>();

  readonly closeIcon = X;
  readonly nutrients: Nutrient[] = ['n', 'p'];

  readonly title = computed(() => {
    const b = this.basin();
    const t = this.i18n.t();
    if (b.kind === 'coast') return t.coastName;
    return b.name ? this.i18n.river(b.name) : `${t.unnamed} · ${b.place ?? ''}`;
  });

  readonly kind = computed(() => {
    const b = this.basin();
    const t = this.i18n.t();
    const sub = t.subNames[b.sub];
    if (b.kind === 'coast') return sub;
    return `${b.name ? t.basinKind : t.smallBasinKind} · ${t.drainsTo}: ${sub}`;
  });

  readonly badge = computed(() => {
    const b = this.basin();
    const t = this.i18n.t();
    if (b.source === 'measured') return { text: t.detailMeasured(MEASURED_YEAR), color: this.theme.getTokenColor('primary-600', '#2563eb') };
    if (b.source === 'estimated') return { text: t.detailEstimated, color: this.theme.getTokenColor('neutral-500', '#64748b') };
    return null;
  });

  /** Rank among all rivers by the active nutrient load. */
  readonly rank = computed(() => {
    const b = this.basin();
    const nut = this.nutrient();
    const rivers = this.data().basins.filter(x => x.source !== 'none');
    const r = rivers.filter(x => x.load[nut] > b.load[nut]).length + 1;
    return this.i18n.t().rank(this.i18n.num(r), this.i18n.num(rivers.length));
  });

  readonly share = computed(() => {
    const b = this.basin();
    const nut = this.nutrient();
    const pct = (b.load[nut] / this.data().total.load[nut]) * 100;
    return pct < 0.1 ? '< ' + this.i18n.num(0.1, 1) + '%' : this.i18n.num(pct, 1) + '%';
  });

  readonly countries = computed(() => this.basin().ctry.map(([c, pct]) => ({ name: this.i18n.country(c), pct })));

  swatch(n: Nutrient) {
    const b = this.basin();
    return `var(--color-${RAMP_TOKENS[n][specClass(n, b.spec[n])]})`;
  }

  conc(n: Nutrient) {
    const v = this.basin().conc[n];
    return this.i18n.num(v, n === 'n' ? 2 : 3);
  }

  spec(n: Nutrient) {
    const v = this.basin().spec[n];
    return this.i18n.num(v, n === 'p' && v < 100 ? 1 : 0);
  }
}
