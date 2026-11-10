import { Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import {
  LucideAngularModule,
  Globe,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Droplet,
  Droplets,
  ImageDown,
  Layers,
  Mountain,
  Palette,
  Waves,
  Wind,
  Map as MapIcon,
  Type,
  X
} from 'lucide-angular';
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
  ThemeService,
  TooltipComponent,
  TooltipService
} from '@kmd/design-system';
import { I18nService } from './core/i18n/i18n.service';
import { Lang } from './core/i18n/i18n.types';
import { BalticDataService } from './core/data/baltic-data.service';
import { Basin, RaindropPath } from './core/data/baltic.model';
import { MapView, MosaicGround, mosaicToken, subToken } from './core/data/views';
import { composePoster, PosterLegendItem } from './core/poster';
import { GlobeComponent, GlobeHover, GlobePick } from './globe/globe.component';
import { BasinListComponent } from './panels/basin-list.component';
import { BasinDetailComponent } from './panels/basin-detail.component';
import { CountryListComponent } from './panels/country-list.component';
import { MethodComponent } from './panels/method.component';

/** The splash stays up at least this long (it doubles as the brand moment). */
const MIN_SPLASH_MS = 5000;
/** Typical river flow speed used for the raindrop's travel-time estimate. */
const FLOW_M_PER_S = 1;

interface LegendItem {
  label: string;
  note: string;
  color: string;
  kind: 'fill' | 'line';
}

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
  private readonly theme = inject(ThemeService);

  private readonly globe = viewChild(GlobeComponent);

  readonly globeIcon = Globe;
  readonly bookOpenIcon = BookOpen;
  readonly chevronDownIcon = ChevronDown;
  readonly chevronUpIcon = ChevronUp;
  readonly riversIcon = Waves;
  readonly bordersIcon = MapIcon;
  readonly labelsIcon = Type;
  readonly posterIcon = ImageDown;
  readonly dropIcon = Droplet;
  readonly closeIcon = X;

  readonly view = signal<MapView>('catchments');
  readonly ground = signal<MosaicGround>('light');
  readonly selected = signal<number>(-1);
  readonly panelOpen = signal<boolean>(!this.bp.mobile());
  readonly showRivers = signal(true);
  readonly showBorders = signal(false);
  readonly showLabels = signal(true);
  readonly showFlow = signal(false);
  readonly showRelief = signal(true);
  readonly listTab = signal<'rivers' | 'countries'>('rivers');
  readonly drop = signal<RaindropPath | null>(null);
  /** Why the last click produced no raindrop path (outside the basin, river-less strip). */
  readonly dropNote = signal<'outside' | 'coast' | null>(null);
  readonly posterBusy = signal(false);
  readonly globeProgress = signal(0);

  /** While any popup is open the brand pill shows the KMD call to action and the other pills step back. */
  readonly isPopupOpen = computed(() => this.popup.config() !== null);

  private readonly t0 = performance.now();
  private splashDone = false;

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
    // Splash: half data (download + decode), half map setup; held for at least MIN_SPLASH_MS.
    effect(() => {
      const t = this.i18n.t();
      if (this.store.error()) { this.splash.setError(t.loadError); return; }
      const data = this.store.progress(), map = this.globeProgress();
      this.splash.setProgress((data * 0.45 + map * 0.55) * 100, data < 1 ? t.loading : t.splashBuilding);
      if (!this.splashDone && this.splash.revealed() && map >= 1) {
        this.splashDone = true;
        performance.mark('watershed:map');
        setTimeout(() => { this.splash.finish(); performance.mark('watershed:splash'); }, Math.max(0, MIN_SPLASH_MS - (performance.now() - this.t0)));
      }
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
      { value: 'mosaic', label: t.viewMosaic, icon: Palette },
      { value: 'raindrop', label: t.viewRaindrop, icon: Droplet }
    ];
  });

  readonly currentViewIcon = computed(() => this.viewOptions().find(o => o.value === this.view())?.icon ?? Droplets);

  setView(v: MapView) {
    this.view.set(v);
    this.drop.set(null);
    this.dropNote.set(null);
    if (v === 'raindrop') this.selected.set(-1);
  }

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

  /** Legend for the active view: map symbols, one swatch per sea, or the largest basins' colours. */
  readonly legend = computed<{ title: string; items: LegendItem[] }>(() => {
    const t = this.i18n.t();
    const d = this.store.data();
    const view = this.view();
    if (view === 'mosaic') {
      const top = d ? d.basins.filter(b => b.river && b.name).sort((a, b) => b.area - a.area).slice(0, 6) : [];
      return {
        title: t.legendMosaicTitle,
        items: top.map(b => ({
          label: this.i18n.river(b.name!).replace(/ \(.+\)$/, ''),
          note: '',
          color: `var(--color-${mosaicToken(b.mosaic, this.ground())})`,
          kind: 'line' as const
        }))
      };
    }
    if (view === 'seas') {
      return {
        title: t.legendSeasTitle,
        items: t.subNames.map((name, i) => ({
          label: name,
          note: d ? this.i18n.area(d.subs[i].parea) : '',
          color: `var(--color-${subToken(i)})`,
          kind: 'fill' as const
        }))
      };
    }
    const items: LegendItem[] = [
      { label: t.legendCatchment, note: '', color: 'var(--color-globe-catchment)', kind: 'fill' },
      { label: t.legendCoast, note: '', color: 'var(--color-globe-coast)', kind: 'fill' },
      { label: t.legendLake, note: '', color: 'var(--color-globe-lake)', kind: 'fill' },
      { label: t.legendRiver, note: '', color: 'var(--color-globe-river)', kind: 'line' },
      { label: t.legendOutline, note: '', color: 'var(--color-globe-outline)', kind: 'line' }
    ];
    if (view === 'raindrop') items.unshift({ label: t.legendDrop, note: '', color: 'var(--color-globe-drop)', kind: 'line' });
    return { title: '', items };
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
      { label: t.layerFlow, icon: Wind, on: this.showFlow },
      { label: t.layerRelief, icon: Mountain, on: this.showRelief },
      { label: t.layerBorders, icon: this.bordersIcon, on: this.showBorders },
      { label: t.layerLabels, icon: this.labelsIcon, on: this.showLabels }
    ];
  });

  /** Readout for the raindrop card. */
  readonly dropInfo = computed(() => {
    const p = this.drop();
    const d = this.store.data();
    if (!p || !d) return null;
    const t = this.i18n.t();
    const b = d.basins[p.basin];
    const river = b.name ? this.i18n.river(b.name) : t.unnamed;
    const days = ((p.totalKm - p.lakeKm) * 1000) / FLOW_M_PER_S / 86400;
    return {
      km: `${this.i18n.num(p.totalKm, p.totalKm < 10 ? 1 : 0)} ${t.km}`,
      reaches: `${river} → ${t.subNames[b.sub]}`,
      overland: `${this.i18n.num(p.overlandKm, 1)} ${t.km}`,
      lakes: p.lakes ? t.dropLakesValue(this.i18n.num(p.lakes), `${this.i18n.num(p.lakeKm)} ${t.km}`) : t.dropNoLakes,
      time: t.dropTimeValue(this.i18n.num(days, days < 10 ? 1 : 0))
    };
  });

  select(id: number, fly = false) {
    this.selected.set(id);
    if (fly && id >= 0) this.globe()?.flyToBasin(id);
  }

  onPick(p: GlobePick) {
    if (this.view() !== 'raindrop') {
      this.select(p.id === this.selected() ? -1 : p.id);
      return;
    }
    if (p.id < 0) { this.dropNote.set('outside'); return; }
    const path = this.store.trace(p.lon, p.lat, p.id);
    this.dropNote.set(path ? null : 'coast');
    this.drop.set(path);
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

  /** Renders the current view as a 3000 × 4000 px poster and downloads it as PNG. */
  async downloadPoster() {
    const globe = this.globe();
    const d = this.store.data();
    if (!globe || !d || this.posterBusy()) return;
    this.posterBusy.set(true);
    try {
      await new Promise(r => setTimeout(r, 30)); // let the busy state paint
      const t = this.i18n.t();
      const dark = this.view() === 'mosaic' && this.ground() === 'dark';
      const map = globe.renderMapImage(3000, 3300, 2.4);
      const lg = this.legend();
      const view = this.viewOptions().find(o => o.value === this.view())?.label ?? '';
      const color = (css: string) => this.theme.getTokenColor(css.replace(/^var\(--color-|\)$/g, ''), '#888');
      const items: PosterLegendItem[] = lg.items.map(i => ({ label: i.label, color: color(i.color), kind: i.kind }));
      const blob = await composePoster(map, {
        width: 3000,
        height: 4000,
        dark,
        background: this.theme.getTokenColor(dark ? 'globe-dark-bg' : 'globe-bg', dark ? '#040812' : '#f5f7fb'),
        ink: this.theme.getTokenColor(dark ? 'neutral-100' : 'text-bright', dark ? '#eef2f7' : '#0f172a'),
        dim: this.theme.getTokenColor(dark ? 'neutral-400' : 'text-dim', '#64748b'),
        font: this.theme.getFontFamily(),
        title: t.appName,
        subtitle: [view, lg.title].filter(Boolean).join(' · '),
        legend: items,
        stats: t.posterStats(this.i18n.area(d.total.parea), this.i18n.num(d.total.nout), `${this.i18n.num(d.total.rkm / 1000)} ${t.thousandKm}`),
        credits: t.posterCredits
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `watershed-${this.view()}${dark ? '-black' : ''}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } finally {
      this.posterBusy.set(false);
    }
  }
}
