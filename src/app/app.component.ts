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
  Trophy,
  Pause,
  Play,
  Route,
  ChevronLeft,
  ChevronRight,
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
import { MapView, MosaicGround, STORY_STEPS, mosaicToken, seaToken } from './core/data/views';
import { composePoster, PosterLegendItem } from './core/poster';
import { GlobeComponent, GlobeHover, GlobePick } from './globe/globe.component';
import { BasinListComponent } from './panels/basin-list.component';
import { BasinDetailComponent } from './panels/basin-detail.component';
import { CountryListComponent } from './panels/country-list.component';
import { SeaListComponent } from './panels/sea-list.component';
import { MethodComponent } from './panels/method.component';

/** The splash stays up at least this long (it doubles as the brand moment). */
const MIN_SPLASH_MS = 5000;
/** "Where the rivers end": time per step while playing (reveal ≈ 4.5 s + reading). */
const STORY_STEP_MS = 8000;
/** Top-rivers countdown: how many rivers, and time per step while playing (reveal ≈ 3.2 s). */
const TOP_N = 20;
const TOP_STEP_MS = 6000;
/** Baltic Sea area incl. the Kattegat (km², HELCOM), for the basin-to-sea ratio. */
const BALTIC_SEA_KM2 = 415_000;
/** Typical river flow speed used for the raindrop's travel-time estimate. */
const FLOW_M_PER_S = 1;

interface LegendItem {
  label: string;
  note: string;
  color: string;
  kind: 'fill' | 'line';
  /** Not revealed yet (story). */
  dim?: boolean;
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
    CountryListComponent,
    SeaListComponent
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
  readonly seasIcon = Layers;
  readonly labelsIcon = Type;
  readonly posterIcon = ImageDown;
  readonly dropIcon = Droplet;
  readonly closeIcon = X;
  readonly prevIcon = ChevronLeft;
  readonly nextIcon = ChevronRight;
  readonly playIcon = Play;
  readonly pauseIcon = Pause;
  readonly topIcon = Trophy;

  readonly view = signal<MapView>('catchments');
  readonly ground = signal<MosaicGround>('light');
  readonly selected = signal<number>(-1);
  /** The rivers / countries / seas panel starts folded; the map comes first. */
  readonly panelOpen = signal<boolean>(false);
  readonly showRivers = signal(true);
  readonly showBorders = signal(false);
  readonly showLabels = signal(true);
  readonly showFlow = signal(false);
  readonly showRelief = signal(true);
  readonly listTab = signal<'rivers' | 'countries' | 'seas'>('rivers');
  readonly drop = signal<RaindropPath | null>(null);
  /** Why the last click produced no raindrop path (outside the basin, river-less strip). */
  readonly dropNote = signal<'outside' | 'coast' | null>(null);
  readonly posterBusy = signal(false);
  readonly globeProgress = signal(0);
  /** The legend & layers panel can fold down to a single pill. */
  readonly legendOpen = signal<boolean>(!this.bp.mobile());
  /** "Where the rivers end" presentation. */
  readonly storyStep = signal(0);
  readonly storyPlaying = signal(false);
  private storyTimer: ReturnType<typeof setTimeout> | null = null;
  /** Top-rivers countdown running in the catchments view (shares the step & play state). */
  readonly topActive = signal(false);
  /** Which presentation is running, if any. */
  readonly presKind = computed<'seas' | 'top' | null>(() =>
    this.view() === 'story' ? 'seas' : this.view() === 'catchments' && this.topActive() ? 'top' : null
  );
  readonly presSteps = computed(() => (this.presKind() === 'top' ? TOP_N + 2 : STORY_STEPS));
  readonly presDots = computed(() => Array.from({ length: this.presSteps() }, (_, i) => i));

  /** The TOP_N largest river basins, in countdown order (#TOP_N first, #1 last). */
  readonly topOrder = computed(() => {
    const d = this.store.data();
    if (!d) return [];
    return d.basins.filter(b => b.river).sort((a, b) => b.area - a.area).slice(0, TOP_N).map(b => b.id).reverse();
  });

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
      { value: 'raindrop', label: t.viewRaindrop, icon: Droplet },
      { value: 'story', label: t.viewStory, icon: Route }
    ];
  });

  readonly currentViewIcon = computed(() => this.viewOptions().find(o => o.value === this.view())?.icon ?? Droplets);

  setView(v: MapView) {
    this.view.set(v);
    this.drop.set(null);
    this.dropNote.set(null);
    this.topActive.set(false);
    if (v === 'raindrop' || v === 'story') this.selected.set(-1);
    // The sea colour key lives in the panel's Seas tab.
    if (v === 'seas') {
      this.listTab.set('seas');
      if (!this.bp.mobile()) this.panelOpen.set(true);
    }
    if (v === 'story') {
      this.goToStep(0);
      this.playStory(true);
    } else {
      this.playStory(false);
    }
  }

  // ─── "Where the rivers end" ─────────────────────────────────────────────

  goToStep(step: number) {
    this.storyStep.set(Math.max(0, Math.min(this.presSteps() - 1, step)));
    if (this.storyPlaying()) this.scheduleStory();
  }

  /** Starts the top-rivers countdown in the catchments view. */
  startTop() {
    this.selected.set(-1);
    this.topActive.set(true);
    this.goToStep(0);
    this.playStory(true);
  }

  stopTop() {
    this.playStory(false);
    this.topActive.set(false);
  }

  playStory(on: boolean) {
    if (this.storyTimer) clearTimeout(this.storyTimer);
    this.storyTimer = null;
    // Playing from the finale starts over.
    if (on && this.storyStep() >= this.presSteps() - 1) this.storyStep.set(0);
    this.storyPlaying.set(on);
    if (on) this.scheduleStory();
  }

  private scheduleStory() {
    if (this.storyTimer) clearTimeout(this.storyTimer);
    const kind = this.presKind();
    this.storyTimer = setTimeout(() => {
      if (!this.storyPlaying() || !this.presKind()) return;
      const next = this.storyStep() + 1;
      this.storyStep.set(next);
      if (next >= this.presSteps() - 1) this.storyPlaying.set(false);
      else this.scheduleStory();
    }, kind === 'top' ? TOP_STEP_MS : STORY_STEP_MS);
  }

  /** Text and numbers for the current presentation step. */
  readonly storyCard = computed(() => {
    const d = this.store.data();
    const t = this.i18n.t();
    const step = this.storyStep();
    if (!d) return null;
    const total = d.total;
    const pct = (v: number, of: number) => `${this.i18n.num((v / of) * 100, v / of < 0.1 ? 1 : 0)}%`;
    if (this.presKind() === 'top') {
      const order = this.topOrder();
      const top = order.map(id => d.basins[id]);
      const area = top.reduce((a, b) => a + b.area, 0);
      if (step === 0) {
        return { title: t.topIntroTitle(TOP_N), color: '', text: t.topIntroText(TOP_N, this.i18n.area(area), pct(area, total.parea)), facts: [] as { k: string; v: string }[] };
      }
      if (step > order.length) {
        const flow = top.reduce((a, b) => a + b.dis, 0);
        const rest = d.basins.filter(b => b.river).length - TOP_N;
        return {
          title: t.topFinaleTitle(TOP_N),
          color: '',
          text: t.topFinaleText(TOP_N, pct(area, total.parea), pct(flow, total.dis), this.i18n.num(rest)),
          facts: [] as { k: string; v: string }[]
        };
      }
      const b = d.basins[order[step - 1]];
      const rank = TOP_N - step + 1;
      return {
        title: `${rank}. ${b.name ? this.i18n.river(b.name) : t.unnamed}`,
        color: `var(--color-${mosaicToken(b.mosaic, 'light')})`,
        text: t.topRiverText(this.i18n.area(b.area), pct(b.area, total.parea), t.subNames[b.sub]),
        facts: [
          { k: t.meanFlow, v: `${this.i18n.flow(b.dis)} (${pct(b.dis, total.dis)})` },
          ...(b.len ? [{ k: t.mainRiver, v: `${this.i18n.num(b.len)} ${t.km}` }] : []),
          { k: t.riverNetwork, v: `${this.i18n.num(b.rkm)} ${t.km}` },
          { k: t.storyCountries, v: b.ctry.slice(0, 3).map(([c, p]) => `${this.i18n.country(c)} ${this.i18n.num(p)}%`).join(', ') }
        ]
      };
    }
    if (step === 0) {
      return {
        title: t.storyIntroTitle,
        color: '',
        text: t.storyIntroText(this.i18n.area(total.parea), this.i18n.num(total.nout), `${this.i18n.num(total.rkm / 1000)} ${t.thousandKm}`),
        facts: [] as { k: string; v: string }[]
      };
    }
    if (step >= STORY_STEPS - 1) {
      const byArea = [...d.subs].sort((a, b) => b.parea - a.parea)[0];
      const byFlow = [...d.subs].sort((a, b) => b.dis - a.dis)[0];
      const neva = d.basins.find(b => b.name === 'Newa');
      return {
        title: t.storyFinaleTitle,
        color: '',
        text:
          byArea.id === byFlow.id
            ? t.storyFinaleTextSame(t.subNames[byArea.id], pct(byArea.parea, total.parea), pct(byFlow.dis, total.dis), neva ? pct(neva.dis, total.dis) : '–')
            : t.storyFinaleText(
                t.subNames[byArea.id], pct(byArea.parea, total.parea),
                t.subNames[byFlow.id], pct(byFlow.dis, total.dis),
                neva ? pct(neva.dis, total.dis) : '–'
              ),
        facts: d.subs.map(s => ({ k: t.subNames[s.id], v: `${pct(s.parea, total.parea)} · ${this.i18n.flow(s.dis)}` }))
      };
    }
    const s = d.subs[step - 1];
    const rivers = s.top.slice(0, 4).map(([n]) => this.i18n.river(n).replace(/ \(.+\)$/, '')).join(', ');
    const countries = s.ctry.slice(0, 3).map(([c, p]) => `${this.i18n.country(c)} ${this.i18n.num(p)}%`).join(', ');
    return {
      title: t.subNames[s.id],
      color: `var(--color-${seaToken(s.id, this.ground())})`,
      text: t.storySeaText(this.i18n.area(s.parea), pct(s.parea, total.parea)),
      facts: [
        { k: t.storyMouths, v: this.i18n.num(s.nout) },
        { k: t.storyOutflow, v: `${this.i18n.flow(s.dis)} (${pct(s.dis, total.dis)})` },
        { k: t.storyTopRivers, v: rivers },
        { k: t.storyCountries, v: countries }
      ]
    };
  });

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
    if (view === 'story') {
      const step = this.storyStep();
      return {
        title: t.legendStoryTitle,
        items: t.subNames.map((name, i) => ({
          label: name,
          note: '',
          color: `var(--color-${seaToken(i, this.ground())})`,
          kind: 'line' as const,
          dim: step < STORY_STEPS - 1 && i + 1 > step
        }))
      };
    }
    if (this.presKind() === 'top' && d) {
      const step = this.storyStep();
      const shown = this.topOrder().slice(0, Math.max(0, step));
      return {
        title: t.topLegend(TOP_N),
        items: shown.reverse().map(id => {
          const b = d.basins[id];
          return {
            label: b.name ? this.i18n.river(b.name).replace(/ \(.+\)$/, '') : t.unnamed,
            note: '',
            color: `var(--color-${mosaicToken(b.mosaic, 'light')})`,
            kind: 'line' as const
          };
        })
      };
    }
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
    if (view === 'seas') return { title: '', items: [] };
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

  /** Frames the land draining into one sea. */
  flyToSea(sub: number) {
    const d = this.store.data();
    if (!d) return;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const b of d.basins) {
      if (b.sub !== sub) continue;
      x0 = Math.min(x0, b.bb[0]); x1 = Math.max(x1, b.bb[1]); y0 = Math.min(y0, b.bb[2]); y1 = Math.max(y1, b.bb[3]);
    }
    this.globe()?.flyToBox(x0, x1, y0, y1);
  }

  select(id: number, fly = false) {
    this.selected.set(id);
    if (fly && id >= 0) this.globe()?.flyToBasin(id);
  }

  onPick(p: GlobePick) {
    if (this.view() === 'story') return;
    if (this.topActive()) this.stopTop();
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
      const dark = (this.view() === 'mosaic' || this.view() === 'story') && this.ground() === 'dark';
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
        credits: t.posterCredits,
        accent: this.theme.getTokenColor('accent', '#d37400'),
        facts: {
          heading: t.factsHeading,
          items: [
            { value: this.i18n.num(d.total.nout), caption: t.factRivers },
            { value: t.factPeopleValue, caption: t.factPeople },
            { value: t.factRenewalValue, caption: t.factRenewal },
            { value: t.factBrackishValue, caption: t.factBrackish },
            { value: `${this.i18n.num(d.total.parea / BALTIC_SEA_KM2, 1)} ×`, caption: t.factRatio }
          ],
          note: t.factsNote
        }
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
