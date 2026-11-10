import { Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { LucideAngularModule, Globe, BookOpen, ChevronDown, ChevronUp, Droplets, Layers, Palette, Waves, Map as MapIcon, Type } from 'lucide-angular';
import {
  AboutService,
  BrandComponent,
  BreakpointService,
  ButtonComponent,
  DropdownComponent,
  DropdownOption,
  PopupComponent,
  PopupService,
  SeoService,
  SplashComponent,
  SplashService,
  TooltipComponent,
  TooltipService
} from '@kmd/design-system';
import { I18nService } from './core/i18n/i18n.service';
import { Lang } from './core/i18n/i18n.types';
import { BalticDataService } from './core/data/baltic-data.service';
import { Basin } from './core/data/baltic.model';
import { MapView, mosaicToken, subToken } from './core/data/views';
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
    BrandComponent,
    ButtonComponent,
    DropdownComponent,
    PopupComponent,
    SplashComponent,
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
  readonly about = inject(AboutService);
  readonly splash = inject(SplashService);
  private readonly seo = inject(SeoService);

  private readonly globe = viewChild(GlobeComponent);

  readonly globeIcon = Globe;
  readonly bookOpenIcon = BookOpen;
  readonly chevronDownIcon = ChevronDown;
  readonly chevronUpIcon = ChevronUp;
  readonly riversIcon = Waves;
  readonly bordersIcon = MapIcon;
  readonly labelsIcon = Type;

  readonly view = signal<MapView>('catchments');
  readonly selected = signal<number>(-1);
  readonly panelOpen = signal<boolean>(!this.bp.mobile());
  readonly showRivers = signal(true);
  readonly showBorders = signal(false);
  readonly showLabels = signal(true);
  readonly listTab = signal<'rivers' | 'countries'>('rivers');

  /** While any popup is open the brand pill shows the KMD call to action and the other pills step back. */
  readonly isPopupOpen = computed(() => this.popup.config() !== null);

  constructor() {
    effect(() => {
      const t = this.i18n.t();
      this.about.setLang(this.i18n.lang());
      this.seo.update({
        title: t.docTitle,
        description: t.metaDescription,
        image: 'assets/design-system/og-image.png',
        currentLang: this.i18n.lang(),
        supportedLangs: this.i18n.langs
      });
    });
    // The splash stays up until its logo reveal has played and the dataset is decoded.
    effect(() => {
      const t = this.i18n.t();
      if (this.store.error()) this.splash.setError(t.loadError);
      else this.splash.setStatus(t.loading);
      if (this.splash.revealed() && this.store.data()) this.splash.finish();
    });
  }

  readonly langOptions = computed<DropdownOption<Lang>[]>(() =>
    this.i18n.langs.map(l => ({
      value: l,
      label: this.i18n.dicts[l].langName,
      shortLabel: l.toUpperCase(),
      badge: l.toUpperCase()
    }))
  );

  readonly viewOptions = computed<DropdownOption<MapView>[]>(() => {
    const t = this.i18n.t();
    return [
      { value: 'catchments', label: t.viewCatchments, icon: Droplets },
      { value: 'seas', label: t.viewSeas, icon: Layers },
      { value: 'mosaic', label: t.viewMosaic, icon: Palette }
    ];
  });

  readonly currentViewIcon = computed(() => this.viewOptions().find(o => o.value === this.view())?.icon ?? Droplets);

  /** Headline numbers for the whole drainage basin. */
  readonly stats = computed(() => {
    const d = this.store.data();
    const t = this.i18n.t();
    if (!d) return [];
    return [
      { k: t.statArea, v: this.i18n.area(d.total.parea) },
      { k: t.statOutflow, v: this.i18n.flow(d.total.dis) },
      { k: t.statRivers, v: this.i18n.num(d.total.nout) },
      { k: t.statRiverKm, v: `${this.i18n.num(d.total.rkm / 1000)} ${t.thousandKm}` }
    ];
  });

  /** Legend for the active view: map symbols, or one swatch per sea sub-basin. */
  readonly legend = computed(() => {
    const t = this.i18n.t();
    const d = this.store.data();
    if (this.view() === 'mosaic') {
      const top = d ? d.basins.filter(b => b.river && b.name).sort((a, b) => b.area - a.area).slice(0, 6) : [];
      return {
        title: t.legendMosaicTitle,
        items: top.map(b => ({
          label: this.i18n.river(b.name!).replace(/ \(.+\)$/, ''),
          note: '',
          color: `var(--color-${mosaicToken(b.mosaic)})`,
          kind: 'line'
        }))
      };
    }
    if (this.view() === 'seas') {
      return {
        title: t.legendSeasTitle,
        items: t.subNames.map((name, i) => ({
          label: name,
          note: d ? this.i18n.area(d.subs[i].parea) : '',
          color: `var(--color-${subToken(i)})`,
          kind: 'fill'
        }))
      };
    }
    return {
      title: '',
      items: [
        { label: t.legendCatchment, note: '', color: 'var(--color-globe-catchment)', kind: 'fill' },
        { label: t.legendCoast, note: '', color: 'var(--color-globe-coast)', kind: 'fill' },
        { label: t.legendLake, note: '', color: 'var(--color-globe-lake)', kind: 'fill' },
        { label: t.legendRiver, note: '', color: 'var(--color-globe-river)', kind: 'line' },
        { label: t.legendOutline, note: '', color: 'var(--color-globe-outline)', kind: 'line' }
      ]
    };
  });

  readonly selectedBasin = computed<Basin | null>(() => {
    const d = this.store.data();
    const id = this.selected();
    return d && id >= 0 ? d.basins[id] : null;
  });

  readonly basinLabel = computed(() => {
    this.i18n.lang();
    return (b: Basin) => (b.name ? this.i18n.river(b.name) : '');
  });

  readonly layers = computed(() => {
    const t = this.i18n.t();
    return [
      { label: t.layerRivers, icon: this.riversIcon, on: this.showRivers },
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
    const b = d.basins[h.id];
    const name = !b.river ? t.coastName : b.name ? this.i18n.river(b.name) : `${t.unnamed} · ${b.place ?? ''}`;
    this.tooltip.show(`${name} · ${this.i18n.area(b.river ? b.area : b.parea)}`, h.x, h.y - 14, 'top');
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
