import { Component, computed, effect, ElementRef, inject, input, output, signal } from '@angular/core';
import { I18nService } from '../core/i18n/i18n.service';
import { BalticData, Basin } from '../core/data/baltic.model';
import { Nutrient, RAMP_TOKENS, specClass } from '../core/data/nutrients';

export type ListSort = 'load' | 'spec' | 'flow' | 'name';

interface Row {
  b: Basin;
  name: string;
  sub: string;
  swatch: string;
  value: string;
  bar: number;
  estimated: boolean;
}

/** Searchable, filterable ranking of rivers by nutrient load. */
@Component({
  selector: 'app-basin-list',
  standalone: true,
  templateUrl: './basin-list.component.html',
  styleUrl: './basin-list.component.scss'
})
export class BasinListComponent {
  readonly i18n = inject(I18nService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly data = input.required<BalticData>();
  readonly nutrient = input<Nutrient>('n');
  readonly selected = input<number>(-1);
  readonly select = output<number>();

  readonly query = signal('');
  readonly subFilter = signal(-1);
  readonly sort = signal<ListSort>('load');

  private readonly rivers = computed(() => this.data().basins.filter(b => b.source !== 'none'));

  /** Search key per basin (both languages, place name and sub-basin). */
  private readonly keys = computed(() => {
    const t = this.i18n.t();
    const out = new Map<number, string>();
    for (const b of this.rivers()) {
      out.set(b.id, [b.name ?? '', b.name ? this.i18n.river(b.name) : '', b.place ?? '', t.subNames[b.sub]].join(' ').toLocaleLowerCase());
    }
    return out;
  });

  readonly rows = computed<Row[]>(() => {
    const t = this.i18n.t();
    const nut = this.nutrient();
    const q = this.query().trim().toLocaleLowerCase();
    const fs = this.subFilter();
    const so = this.sort();
    const keys = this.keys();
    let list = this.rivers().filter(b => (fs < 0 || b.sub === fs) && (!q || keys.get(b.id)!.includes(q)));
    const name = (b: Basin) => (b.name ? this.i18n.river(b.name) : `${t.unnamed} · ${b.place ?? ''}`);
    if (so === 'name') list = [...list].sort((a, b) => (a.name ? 0 : 1) - (b.name ? 0 : 1) || name(a).localeCompare(name(b), t.numberLocale));
    else if (so === 'flow') list = [...list].sort((a, b) => b.dis - a.dis);
    else if (so === 'spec') list = [...list].sort((a, b) => b.spec[nut] - a.spec[nut]);
    else list = [...list].sort((a, b) => b.load[nut] - a.load[nut]);

    const metric = (b: Basin) => (so === 'spec' ? b.spec[nut] : so === 'flow' ? b.dis : b.load[nut]);
    const max = Math.max(1e-9, ...list.map(metric));
    return list.map(b => ({
      b,
      name: name(b),
      sub: t.subNames[b.sub],
      swatch: `var(--color-${RAMP_TOKENS[nut][specClass(nut, b.spec[nut])]})`,
      value:
        so === 'spec'
          ? `${this.i18n.num(b.spec[nut], nut === 'p' ? 1 : 0)}`
          : so === 'flow'
            ? `${this.i18n.num(b.dis, b.dis < 10 ? 1 : 0)} ${t.flowUnit}`
            : this.i18n.tonnes(b.load[nut]),
      bar: (metric(b) / max) * 100,
      estimated: b.source === 'estimated'
    }));
  });

  readonly title = computed(() => {
    const t = this.i18n.t();
    const total = this.rivers().length;
    const shown = this.rows().length;
    return shown === total ? t.listAll(this.i18n.num(total)) : t.listFound(this.i18n.num(shown), this.i18n.num(total));
  });

  constructor() {
    // Keep the selected row in view when selection comes from the globe.
    effect(() => {
      const sel = this.selected();
      if (sel < 0) return;
      queueMicrotask(() => {
        const el = this.host.nativeElement.querySelector<HTMLElement>(`[data-id="${sel}"]`);
        el?.scrollIntoView({ block: 'nearest' });
      });
    });
  }

  onSubFilter(e: Event) {
    this.subFilter.set(+(e.target as HTMLSelectElement).value);
  }

  onSort(e: Event) {
    this.sort.set((e.target as HTMLSelectElement).value as ListSort);
  }

  onQuery(e: Event) {
    this.query.set((e.target as HTMLInputElement).value);
  }
}
