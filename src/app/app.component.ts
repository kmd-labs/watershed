import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { LucideAngularModule, Globe, BookOpen, ChevronDown, ChevronUp, Leaf, Sprout, Waves, Columns3, Map as MapIcon, Type } from 'lucide-angular';
import {
  ButtonComponent,
  DropdownComponent,
  DropdownOption,
  PopupComponent,
  PopupService,
  TooltipComponent,
  TooltipService,
  BreakpointService
} from '@kmd/design-system';
import { I18nService } from './core/i18n/i18n.service';
import { Lang } from './core/i18n/i18n.types';
import { BalticDataService } from './core/data/baltic-data.service';
import { Basin } from './core/data/baltic.model';
import { Nutrient, RAMP_TOKENS, SPEC_BREAKS } from './core/data/nutrients';
import { GlobeComponent, GlobeHover } from './globe/globe.component';
import { BasinListComponent } from './panels/basin-list.component';
import { BasinDetailComponent } from './panels/basin-detail.component';
import { MethodComponent } from './panels/method.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    LucideAngularModule,
    ButtonComponent,
    DropdownComponent,
    PopupComponent,
    TooltipComponent,
    GlobeComponent,
    BasinListComponent,
    BasinDetailComponent
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  readonly i18n = inject(I18nService);
  readonly bp = inject(BreakpointService);
  readonly popup = inject(PopupService);
  readonly tooltip = inject(TooltipService);
  readonly store = inject(BalticDataService);

  private readonly globe = viewChild(GlobeComponent);

  readonly globeIcon = Globe;
  readonly bookOpenIcon = BookOpen;
  readonly chevronDownIcon = ChevronDown;
  readonly chevronUpIcon = ChevronUp;
  readonly riversIcon = Waves;
  readonly columnsIcon = Columns3;
  readonly bordersIcon = MapIcon;
  readonly labelsIcon = Type;

  readonly nutrient = signal<Nutrient>('n');
  readonly selected = signal<number>(-1);
  readonly panelOpen = signal<boolean>(!this.bp.mobile());
  readonly showRivers = signal(true);
  readonly showColumns = signal(true);
  readonly showBorders = signal(false);
  readonly showLabels = signal(true);

  readonly langOptions = computed<DropdownOption<Lang>[]>(() =>
    this.i18n.langs.map(l => ({
      value: l,
      label: this.i18n.dicts[l].langName,
      shortLabel: l.toUpperCase(),
      badge: l.toUpperCase()
    }))
  );

  readonly viewOptions = computed<DropdownOption<Nutrient>[]>(() => {
    const t = this.i18n.t();
    const compact = this.bp.mobile();
    return [
      { value: 'n', label: t.viewNitrogen, shortLabel: compact ? 'N' : undefined, icon: Sprout },
      { value: 'p', label: t.viewPhosphorus, shortLabel: compact ? 'P' : undefined, icon: Leaf }
    ];
  });

  readonly currentViewIcon = computed(() => this.viewOptions().find(o => o.value === this.nutrient())?.icon ?? Sprout);

  readonly selectedBasin = computed<Basin | null>(() => {
    const d = this.store.data();
    const id = this.selected();
    return d && id >= 0 ? d.basins[id] : null;
  });

  readonly basinLabel = computed(() => {
    this.i18n.lang();
    return (b: Basin) => (b.name ? this.i18n.river(b.name) : '');
  });

  readonly legend = computed(() => {
    const nut = this.nutrient();
    const br = SPEC_BREAKS[nut];
    return {
      swatches: RAMP_TOKENS[nut].map(k => `var(--color-${k})`),
      ticks: br.map(v => this.i18n.num(v))
    };
  });

  readonly layers = computed(() => {
    const t = this.i18n.t();
    return [
      { label: t.layerRivers, icon: this.riversIcon, on: this.showRivers },
      { label: t.layerColumns, icon: this.columnsIcon, on: this.showColumns },
      { label: t.layerBorders, icon: this.bordersIcon, on: this.showBorders },
      { label: t.layerLabels, icon: this.labelsIcon, on: this.showLabels }
    ];
  });

  select(id: number, fly = false) {
    this.selected.set(id);
    if (fly && id >= 0) this.globe()?.flyToBasin(id);
  }

  onHover(h: GlobeHover | null) {
    const d = this.store.data();
    if (!h || !d) {
      this.tooltip.hide();
      return;
    }
    const b = d.basins[h.id];
    const t = this.i18n.t();
    const nut = this.nutrient();
    const name = b.kind === 'coast' ? t.coastName : b.name ? this.i18n.river(b.name) : `${t.unnamed} · ${b.place ?? ''}`;
    const value = b.source === 'none' ? '' : ` · ${nut.toUpperCase()} ${b.source === 'estimated' ? '≈ ' : ''}${this.i18n.tonnes(b.load[nut])}${t.perYear}`;
    this.tooltip.show(name + value, h.x, h.y - 14, 'top');
  }

  openGlossary() {
    this.popup.open({
      id: 'glossary',
      title: computed(() => this.i18n.t().glossary),
      subtitle: computed(() => this.i18n.t().glossaryDesc),
      component: MethodComponent,
      size: 'lg',
      actions: [{ label: computed(() => this.i18n.t().close), variant: 'default' }]
    });
  }
}
