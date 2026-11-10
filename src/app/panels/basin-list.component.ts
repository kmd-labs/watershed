import { Component, computed, effect, ElementRef, inject, input, output, signal } from '@angular/core';
import { I18nService } from '../core/i18n/i18n.service';
import { BalticData, Basin } from '../core/data/baltic.model';
import { MapView, mosaicToken, subToken } from '../core/data/views';

export type ListSort = 'area' | 'flow' | 'name';

interface Row {
  b: Basin;
  name: string;
  sub: string;
  swatch: string;
  value: string;
  bar: number;
}

/** Searchable, filterable list of the rivers draining to the Baltic. */
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
  readonly selected = input<number>(-1);
  /** Row swatches follow the map: sea sub-basin colour, mosaic colour, or the plain catchment tone. */
  readonly view = input<MapView>('catchments');
  readonly select = output<number>();

  readonly query = signal('');
  readonly subFilter = signal(-1);
  readonly sort = signal<ListSort>('area');

  private readonly rivers = computed(() => this.data().basins.filter(b => b.river));

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
    const q = this.query().trim().toLocaleLowerCase();
    const fs = this.subFilter();
    const so = this.sort();
    const view = this.view();
    const keys = this.keys();
    let list = this.rivers().filter(b => (fs < 0 || b.sub === fs) && (!q || keys.get(b.id)!.includes(q)));
    const name = (b: Basin) => (b.name ? this.i18n.river(b.name) : `${t.unnamed} · ${b.place ?? ''}`);
    if (so === 'name') list = [...list].sort((a, b) => (a.name ? 0 : 1) - (b.name ? 0 : 1) || name(a).localeCompare(name(b), t.numberLocale));
    else if (so === 'flow') list = [...list].sort((a, b) => b.dis - a.dis);
    else list = [...list].sort((a, b) => b.area - a.area);

    const metric = (b: Basin) => (so === 'flow' ? b.dis : b.area);
    const max = Math.max(1e-9, ...list.map(metric));
    return list.map(b => ({
      b,
      name: name(b),
      sub: t.subNames[b.sub],
      swatch: `var(--color-${view === 'seas' ? subToken(b.sub) : view === 'mosaic' ? mosaicToken(b.mosaic) : 'globe-catchment'})`,
      value: so === 'flow' ? this.i18n.flow(b.dis) : this.i18n.area(b.area),
      bar: (metric(b) / max) * 100
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
