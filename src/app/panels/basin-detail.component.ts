import { Component, computed, inject, input, output } from '@angular/core';
import { LucideAngularModule, X } from 'lucide-angular';
import { ButtonComponent } from '@kmd/design-system';
import { I18nService } from '../core/i18n/i18n.service';
import { BalticData, Basin } from '../core/data/baltic.model';

/** Floating card with the hydrology and countries of the selected catchment. */
@Component({
  selector: 'app-basin-detail',
  standalone: true,
  imports: [LucideAngularModule, ButtonComponent],
  templateUrl: './basin-detail.component.html',
  styleUrl: './basin-detail.component.scss'
})
export class BasinDetailComponent {
  readonly i18n = inject(I18nService);

  readonly data = input.required<BalticData>();
  readonly basin = input.required<Basin>();
  readonly close = output<void>();

  readonly closeIcon = X;

  readonly title = computed(() => {
    const b = this.basin();
    const t = this.i18n.t();
    if (!b.river) return t.coastName;
    return b.name ? this.i18n.river(b.name) : `${t.unnamed} · ${b.place ?? ''}`;
  });

  readonly kind = computed(() => {
    const b = this.basin();
    const t = this.i18n.t();
    const sub = t.subNames[b.sub];
    if (!b.river) return sub;
    return `${b.name ? t.basinKind : t.smallBasinKind} · ${t.drainsTo}: ${sub}`;
  });

  /** Rank among all river basins by catchment area. */
  readonly rank = computed(() => {
    const b = this.basin();
    const rivers = this.data().basins.filter(x => x.river);
    const r = rivers.filter(x => x.area > b.area).length + 1;
    return this.i18n.t().rank(this.i18n.num(r), this.i18n.num(rivers.length));
  });

  readonly countries = computed(() => this.basin().ctry.map(([c, pct]) => ({ name: this.i18n.country(c), pct })));
}
