import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { LucideAngularModule, Globe, BookOpen, ChevronDown, ChevronUp, Leaf, Sprout, Waves, CircleDot, Map as MapIcon, Type, Wind, Microscope } from 'lucide-angular';
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
import {
  CYANO_BREAKS,
  CYANO_TOKENS,
  OXYGEN_THRESHOLDS,
  OXYGEN_TOKENS,
  SeaGrid,
  SeaLayer,
  SeaLayersService,
  UMOL_PER_ML,
  gridArea,
  gridValueAt,
  oxygenClass
} from './core/data/sea-layers';
import { GlobeComponent, GlobeHover } from './globe/globe.component';
import { BasinListComponent } from './panels/basin-list.component';
import { BasinDetailComponent } from './panels/basin-detail.component';
import { CountryListComponent } from './panels/country-list.component';
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
    BasinDetailComponent,
    CountryListComponent
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
  readonly sea = inject(SeaLayersService);

  private readonly globe = viewChild(GlobeComponent);

  readonly globeIcon = Globe;
  readonly bookOpenIcon = BookOpen;
  readonly chevronDownIcon = ChevronDown;
  readonly chevronUpIcon = ChevronUp;
  readonly riversIcon = Waves;
  readonly phosphorusIcon = CircleDot;
  readonly bordersIcon = MapIcon;
  readonly labelsIcon = Type;

  readonly nutrient = signal<Nutrient>('n');
  readonly selected = signal<number>(-1);
  readonly panelOpen = signal<boolean>(!this.bp.mobile());
  readonly showRivers = signal(true);
  readonly showPhosphorus = signal(true);
  readonly listTab = signal<'rivers' | 'countries'>('rivers');

  /** Reference circles for the phosphorus legend (area ∝ load, largest = biggest river). */
  readonly discLegend = computed(() => {
    const d = this.store.data();
    if (!d) return [];
    const max = Math.max(...d.basins.map(b => b.load.p));
    const D = 34;
    return [100, 1000, max].map(v => ({ size: Math.max(4, D * Math.sqrt(v / max)), label: this.i18n.tonnes(v) }));
  });
  readonly showBorders = signal(false);
  readonly showLabels = signal(true);
  readonly seaLayer = signal<SeaLayer>('none');

  readonly seaGrid = computed<SeaGrid | null>(() => {
    const l = this.seaLayer();
    return l === 'oxygen' ? this.sea.oxygen() : l === 'cyano' ? this.sea.cyano() : null;
  });

  readonly seaToggles = computed(() => {
    const t = this.i18n.t();
    const toggles = [{ layer: 'oxygen' as SeaLayer, label: t.layerOxygen, icon: Wind }];
    if (this.sea.cyanoAvailable()) toggles.push({ layer: 'cyano' as SeaLayer, label: t.layerCyano, icon: Microscope });
    return toggles;
  });

  /** Legend + headline numbers for the active sea overlay. */
  readonly seaLegend = computed(() => {
    const layer = this.seaLayer();
    const g = this.seaGrid();
    const t = this.i18n.t();
    if (layer === 'none') return null;
    if (layer === 'cyano' && this.sea.cyanoMissing()) return { kind: 'missing' as const, note: t.cyanoUnavailable };
    if (!g) return { kind: 'loading' as const, note: t.layerLoading };
    if (layer === 'oxygen') {
      const hyp = gridArea(g, v => v < OXYGEN_THRESHOLDS.hypoxic);
      const anox = gridArea(g, v => v < OXYGEN_THRESHOLDS.anoxic);
      const round = (v: number) => this.i18n.num(Math.round(v / 1000) * 1000);
      return {
        kind: 'oxygen' as const,
        title: t.oxygenLegendTitle,
        period: t.oxygenPeriod,
        items: [
          { color: `var(--color-${OXYGEN_TOKENS.anoxic})`, label: t.oxygenAnoxic },
          { color: `var(--color-${OXYGEN_TOKENS.hypoxic})`, label: t.oxygenHypoxic }
        ],
        note: t.oxygenStats(round(hyp), round(anox))
      };
    }
    return {
      kind: 'cyano' as const,
      title: t.cyanoLegendTitle,
      period: t.cyanoPeriod(g.meta['yearFrom'] ?? 0, g.meta['yearTo'] ?? 0),
      swatches: CYANO_TOKENS.map(k => `var(--color-${k})`),
      ticks: CYANO_BREAKS.map(b => `${Math.round(b * 100)}%`)
    };
  });

  toggleSea(layer: SeaLayer) {
    const next = this.seaLayer() === layer ? 'none' : layer;
    this.sea.ensure(next);
    this.seaLayer.set(next);
  }

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
      { label: t.layerPhosphorus, icon: this.phosphorusIcon, on: this.showPhosphorus },
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
    const t = this.i18n.t();
    if (h.id < 0) {
      const text = this.seaTooltip(h.lon, h.lat);
      if (text) this.tooltip.show(text, h.x, h.y - 14, 'top');
      else this.tooltip.hide();
      return;
    }
    const b = d.basins[h.id];
    const nut = this.nutrient();
    const name = b.kind === 'coast' ? t.coastName : b.name ? this.i18n.river(b.name) : `${t.unnamed} · ${b.place ?? ''}`;
    const value = b.source === 'none' ? '' : ` · ${nut.toUpperCase()} ${b.source === 'estimated' ? '≈ ' : ''}${this.i18n.tonnes(b.load[nut])}${t.perYear}`;
    this.tooltip.show(name + value, h.x, h.y - 14, 'top');
  }

  private seaTooltip(lon: number, lat: number): string {
    const g = this.seaGrid();
    const t = this.i18n.t();
    if (!g) return '';
    const v = gridValueAt(g, lon, lat);
    if (Number.isNaN(v)) return '';
    if (this.seaLayer() === 'oxygen') {
      const c = oxygenClass(v);
      const suffix = c === 'anoxic' ? ` · ${t.oxygenTooltipAnoxic}` : c === 'hypoxic' ? ` · ${t.oxygenTooltipHypoxic}` : '';
      return t.oxygenTooltip(this.i18n.num(v / UMOL_PER_ML, 1)) + suffix;
    }
    return t.cyanoTooltip(`${Math.round(v * 100)}%`);
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
