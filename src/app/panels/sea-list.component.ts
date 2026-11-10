import { Component, computed, inject, input, output } from '@angular/core';
import { I18nService } from '../core/i18n/i18n.service';
import { BalticData } from '../core/data/baltic.model';
import { subToken } from '../core/data/views';

/** The six seas of the Baltic and the land draining into each (the "Sea sub-basins" key). */
@Component({
  selector: 'app-sea-list',
  standalone: true,
  template: `
    @let t = i18n.t();
    <div class="list-title">
      <span>{{ t.seasTitle }}</span>
    </div>
    <div class="list" role="list" [attr.aria-label]="t.seasTitle">
      @for (r of rows(); track r.id) {
        <button type="button" class="row" role="listitem" [attr.title]="t.seasFly" (click)="fly.emit(r.id)">
          <i class="row__swatch" [style.background]="r.swatch"></i>
          <span class="row__name" [attr.title]="r.mouths">{{ r.name }}</span>
          <span class="row__bar" aria-hidden="true"><span [style.width.%]="r.bar"></span></span>
          <b class="row__value">{{ r.area }}</b>
          <span class="row__share">{{ r.share }}</span>
        </button>
      }
    </div>
    <p class="note">{{ t.seasNote }}</p>
  `,
  styleUrls: ['./basin-list.component.scss', './country-list.component.scss'],
  styles: `
    .row {
      grid-template-columns: 11px minmax(0, 1fr) 40px auto 40px;
      cursor: pointer;
    }
  `
})
export class SeaListComponent {
  readonly i18n = inject(I18nService);

  readonly data = input.required<BalticData>();
  /** Asks the map to frame a sea's drainage area. */
  readonly fly = output<number>();

  readonly rows = computed(() => {
    const t = this.i18n.t();
    const d = this.data();
    const max = Math.max(...d.subs.map(s => s.parea));
    return d.subs.map(s => ({
      id: s.id,
      name: t.subNames[s.id],
      mouths: t.seasMouths(this.i18n.num(s.nout)),
      swatch: `var(--color-${subToken(s.id)})`,
      area: this.i18n.area(Math.round(s.parea / 100) * 100),
      bar: (s.parea / max) * 100,
      share: `${this.i18n.num((s.parea / d.total.parea) * 100)}%`
    }));
  });
}
