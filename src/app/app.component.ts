import { Component, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import {
  LucideAngularModule,
  Globe,
  BookOpen,
  House,
  Minus,
  Plus,
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
  Share2,
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
import { GlobeComponent, GlobeHover, GlobePick } from './globe/globe.component';
import { PosterStudioComponent } from './poster/poster-studio.component';
import { DEFAULT_POSTER, PosterOptions } from './poster/poster-options';
import { BasinListComponent } from './panels/basin-list.component';
import { BasinDetailComponent } from './panels/basin-detail.component';
import { CountryListComponent } from './panels/country-list.component';
import { SeaListComponent } from './panels/sea-list.component';
import { MethodComponent } from './panels/method.component';
import { SharePopupComponent } from './panels/share-popup.component';
import { APP_CANONICAL_URL, LinkState, START_VIEW, readLink, shareUrl, writeLink } from './core/deep-link';

/** The splash stays up at least this long from the start of page load (it doubles as the brand moment). */
const MIN_SPLASH_MS = 5000;
/** "Where the rivers end": time per step while playing (reveal ≈ 4.5 s + reading). */
const STORY_STEP_MS = 8000;
/** A playing tour leaves its intro card after this long (the start view begins 3 s after the map shows). */
const INTRO_MS = 3000;
/** Top-rivers countdown: how many rivers, and time per step while playing (reveal ≈ 3.2 s). */
const TOP_N = 20;
const TOP_STEP_MS = 6000;
/** Typical river flow speed used for the raindrop's travel-time estimate. */
const FLOW_M_PER_S = 1;

interface LegendItem {
  label: string;
  note: string;
  color: string;
  kind: 'fill' | 'line';
  /** Not revealed yet by the running tour. */
  dim?: boolean;
  /** The tour's current step. */
  current?: boolean;
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
    SeaListComponent,
    PosterStudioComponent
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

  protected readonly globe = viewChild(GlobeComponent);

  readonly globeIcon = Globe;
  readonly shareIcon = Share2;
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
  readonly storyIcon = Route;
  readonly zoomInIcon = Plus;
  readonly zoomOutIcon = Minus;
  readonly homeIcon = House;

  readonly view = signal<MapView>(START_VIEW);
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
  readonly dropNote = signal<'outside' | 'coast' | 'tiny' | null>(null);
  /** Poster maker choices (the view's state, also carried by its links). */
  readonly posterOpts = signal<PosterOptions>(DEFAULT_POSTER);
  readonly globeProgress = signal(0);
  /** The 3D map could not be created (see GlobeComponent.failed). */
  readonly mapFailed = signal(false);
  /** The legend & layers panel can fold down to a single pill. */
  readonly legendOpen = signal<boolean>(!this.bp.mobile() && !this.bp.mobileLandscape());
  /** "Where the rivers end" presentation. */
  readonly storyStep = signal(0);
  readonly storyPlaying = signal(false);
  private storyTimer: ReturnType<typeof setTimeout> | null = null;
  /** The top-20 tour: a view of its own, drawn on the catchments map. */
  readonly topActive = computed(() => this.view() === 'top');
  /** Which tour is running, if any (both share the step & play state and the same card). */
  readonly presKind = computed<'seas' | 'top' | null>(() =>
    this.view() === 'story' ? 'seas' : this.view() === 'top' ? 'top' : null
  );
  /** The last map view, kept under the poster maker (which hides the map and prints its own). */
  private readonly lastMap = signal<MapView>(START_VIEW);
  /** What the map and the lists draw: the top-20 tour uses the catchments styling. */
  readonly mapView = computed<MapView>(() => {
    const v = this.view() === 'poster' ? this.lastMap() : this.view();
    return v === 'top' ? 'catchments' : v;
  });
  readonly presSteps = computed(() => (this.presKind() === 'top' ? TOP_N + 2 : STORY_STEPS));
  readonly presDots = computed(() => Array.from({ length: this.presSteps() }, (_, i) => i));

  /** The TOP_N largest river basins, largest first (step 1 = #1). */
  readonly topOrder = computed(() => {
    const d = this.store.data();
    if (!d) return [];
    return d.basins.filter(b => b.river).sort((a, b) => b.area - a.area).slice(0, TOP_N).map(b => b.id);
  });

  /** While any popup is open the brand pill shows the KMD call to action and the other pills step back. */
  readonly isPopupOpen = computed(() => this.popup.config() !== null);

  private splashDone = false;

  // ─── deep links ─────────────────────────────────────────────────────────

  /** What the URL asked for at start-up; river, step and raindrop wait for the map. */
  private readonly link = readLink(typeof location !== 'undefined' ? location.search : '');
  private linkApplied = false;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  /** The map state a link carries (see core/deep-link.ts). */
  readonly linkState = computed<LinkState>(() => {
    const view = this.view();
    return {
      view,
      ground: this.ground(),
      basin: view === 'poster' ? this.posterOpts().focus : this.selected(),
      step: this.storyStep(),
      drop: this.drop()?.start ?? null,
      palette: this.posterOpts().palette,
      by: this.posterOpts().by
    };
  });

  /** Applies the start-up link: view, ground and language now, the rest once the map is ready. */
  private applyLinkNow() {
    const L = this.link;
    if (L.lang && (this.i18n.langs as string[]).includes(L.lang)) this.i18n.setLang(L.lang as Lang);
    if (L.view) {
      this.view.set(L.view);
      if (L.view !== 'poster') this.lastMap.set(L.view);
      if (L.view === 'seas') this.listTab.set('seas');
      if (L.view === 'poster') {
        this.posterOpts.update(o => ({ ...o, palette: L.palette ?? o.palette, by: L.by ?? o.by, focus: L.basin ?? -1 }));
      }
    }
    if (L.ground) this.ground.set(L.ground);
    if (this.presKind()) this.storyStep.set(Math.min(L.step ?? 0, this.presSteps() - 1));
  }

  private applyLinkWhenReady() {
    const L = this.link;
    const d = this.store.data();
    if (L.basin !== undefined && d && L.basin < d.basins.length && this.view() !== 'poster') this.select(L.basin, true);
    if (L.drop && this.view() === 'raindrop') {
      const id = this.globe()?.basinAtPoint(L.drop[0], L.drop[1]) ?? -1;
      this.onPick({ id, lon: L.drop[0], lat: L.drop[1] });
    }
  }

  /** Address bar follows the map (debounced; defaults left out; other parameters kept). */
  private syncUrl(s: LinkState) {
    if (typeof location === 'undefined') return;
    const url = writeLink(new URL(location.href), s);
    if (url.href === location.href) return;
    try {
      history.replaceState(history.state, '', url);
    } catch {
      // Browsers may throttle history updates; the share dialog still builds the link.
    }
  }

  openShare() {
    const t = this.i18n.t();
    const lang = this.i18n.lang();
    const view = this.viewOptions().find(o => o.value === this.view())?.label ?? '';
    const b = this.selectedBasin();
    const detail =
      this.presKind() ? this.storyCard()?.title ?? ''
      : this.view() === 'raindrop' && this.drop() ? this.dropInfo()?.reaches ?? ''
      : b ? (b.name ? this.i18n.river(b.name) : t.unnamed) : '';
    const app = new URL(APP_CANONICAL_URL);
    app.searchParams.set('lang', lang);
    this.popup.open({
      id: 'share',
      title: computed(() => this.i18n.t().shareTitle),
      subtitle: computed(() => this.i18n.t().shareSubtitle),
      component: SharePopupComponent,
      componentInputs: {
        viewUrl: shareUrl(this.linkState(), lang),
        appUrl: app.toString(),
        viewLabel: detail ? `${view} · ${detail}` : view
      },
      size: 'sm',
      actions: [{ label: computed(() => this.i18n.t().close), variant: 'default' }]
    });
  }

  constructor() {
    this.applyLinkNow();
    effect(() => {
      // Without the map the tours have nothing to show: land on their maps' lists instead.
      if (!this.mapFailed()) return;
      untracked(() => (this.presKind() ? this.closePresentation() : this.playStory(false)));
    });
    effect(() => {
      if (this.linkApplied || this.globeProgress() < 1) return;
      this.linkApplied = true;
      queueMicrotask(() => this.applyLinkWhenReady());
    });
    effect(() => {
      const s = this.linkState();
      if (!this.linkApplied) return;
      if (this.syncTimer) clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(() => this.syncUrl(s), 400);
    });
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
      const data = this.store.progress(), map = this.mapFailed() ? 1 : this.globeProgress();
      this.splash.setProgress((data * 0.45 + map * 0.55) * 100, data < 1 ? t.loading : t.splashBuilding);
      if (!this.splashDone && this.splash.revealed() && map >= 1) {
        this.splashDone = true;
        performance.mark('watershed:map');
        setTimeout(() => {
          this.splash.finish();
          performance.mark('watershed:splash');
          this.autoplay();
        }, Math.max(0, MIN_SPLASH_MS - performance.now()));
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
    // The start view first; each tour right before the map it closes onto (the sea-by-sea story →
    // sea sub-basins, top 20 → catchments); then the art view; the hands-on raindrop last.
    const all: DropdownOption<MapView>[] = [
      { value: 'story', label: t.viewStory, icon: Route },
      { value: 'seas', label: t.viewSeas, icon: Layers },
      { value: 'top', label: t.viewTop(TOP_N), icon: Trophy },
      { value: 'catchments', label: t.viewCatchments, icon: Droplets },
      { value: 'mosaic', label: t.viewMosaic, icon: Palette },
      { value: 'raindrop', label: t.viewRaindrop, icon: Droplet },
      // On phones the header pill shows the short name (the long one would push it off screen).
      { value: 'poster', label: t.viewPoster, shortLabel: this.bp.mobile() ? t.viewPosterShort : undefined, icon: ImageDown }
    ];
    // Without the map the tours and the poster maker have nothing to show.
    return this.mapFailed() ? all.filter(o => o.value !== 'top' && o.value !== 'story' && o.value !== 'poster') : all;
  });

  readonly currentViewIcon = computed(() => this.viewOptions().find(o => o.value === this.view())?.icon ?? Droplets);

  setView(v: MapView) {
    this.view.set(v);
    if (v !== 'poster') this.lastMap.set(v);
    this.drop.set(null);
    this.dropNote.set(null);
    if (v === 'raindrop' || v === 'story' || v === 'top') this.selected.set(-1);
    // The sea colour key lives in the panel's Seas tab.
    if (v === 'seas') {
      this.listTab.set('seas');
      if (!this.bp.mobile()) this.panelOpen.set(true);
    }
    // Both tours start from their intro and play.
    if (this.presKind()) {
      this.goToStep(0);
      this.playStory(true);
    } else {
      this.playStory(false);
    }
  }

  /**
   * The start view's tour plays on its own once the map is on screen: the intro card for INTRO_MS,
   * then the first sea. A link to a later step, or a user who already took over, is left alone.
   */
  private autoplay() {
    if (this.presKind() && this.storyStep() === 0 && !this.storyPlaying() && !this.mapFailed()) this.playStory(true);
  }

  /** Closes the running tour onto its map: top 20 → catchments, the story → sea sub-basins. */
  closePresentation() {
    this.setView(this.presKind() === 'top' ? 'catchments' : 'seas');
  }

  // ─── map buttons ─────────────────────────────────────────────────────────

  zoomIn() {
    this.globe()?.zoomBy(0.6);
  }

  zoomOut() {
    this.globe()?.zoomBy(1 / 0.6);
  }

  resetView() {
    this.globe()?.resetView();
  }

  // ─── "Where the rivers end" ─────────────────────────────────────────────

  goToStep(step: number) {
    this.storyStep.set(Math.max(0, Math.min(this.presSteps() - 1, step)));
    if (this.storyPlaying()) this.scheduleStory();
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
    }, this.storyStep() === 0 ? INTRO_MS : kind === 'top' ? TOP_STEP_MS : STORY_STEP_MS);
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
        return { title: t.topIntroTitle(TOP_N), color: '', text: t.topIntroText(TOP_N, this.i18n.area(area), pct(area, total.parea), this.i18n.num(total.nout)), facts: [] as { k: string; v: string }[] };
      }
      if (step > order.length) {
        const flow = top.reduce((a, b) => a + b.dis, 0);
        const rest = total.nout - TOP_N;
        return {
          title: t.topFinaleTitle(TOP_N),
          color: '',
          text: t.topFinaleText(TOP_N, pct(area, total.parea), pct(flow, total.dis), this.i18n.num(rest)),
          facts: [] as { k: string; v: string }[]
        };
      }
      const b = d.basins[order[step - 1]];
      const rank = step;
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

  /** A card is open in the right column (catchment, raindrop or presentation). */
  readonly hasCard = computed(() => !!this.presKind() || this.view() === 'raindrop' || !!this.selectedBasin());

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
          dim: step < STORY_STEPS - 1 && i + 1 > step,
          current: step === i + 1
        }))
      };
    }
    if (view === 'top' && d) {
      // All twenty from the intro on, so every colour on the map has a name; while the tour runs,
      // the rivers still to come are dimmed, as they are on the map.
      const step = this.storyStep();
      const order = this.topOrder();
      const running = step >= 1 && step <= order.length;
      return {
        title: t.topLegend(TOP_N),
        items: order.map((id, i) => {
          const b = d.basins[id];
          return {
            label: `${i + 1}. ${b.name ? this.i18n.river(b.name).replace(/ \(.+\)$/, '') : t.unnamed}`,
            note: '',
            color: `var(--color-${mosaicToken(b.mosaic, 'light')})`,
            kind: 'line' as const,
            dim: running && i + 1 > step,
            current: step === i + 1
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
    // A click during the top-20 tour leaves it for the catchments map and opens that river.
    if (this.view() === 'top') this.setView('catchments');
    if (this.view() !== 'raindrop') {
      this.select(p.id === this.selected() ? -1 : p.id);
      return;
    }
    if (p.id < 0) { this.dropNote.set('outside'); return; }
    const path = this.store.trace(p.lon, p.lat, p.id);
    // No path: a river-less coastal strip, or a catchment whose streams are too small to show.
    this.dropNote.set(path ? null : this.store.data()?.basins[p.id]?.river ? 'tiny' : 'coast');
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

  /**
   * Opens the poster maker set up for what is on screen: colours from the current view (mosaic and
   * story keep their colouring and ground, seas colour by sea) and the selected river, if any.
   */
  openPosterMaker() {
    const v = this.view();
    const dark = this.ground() === 'dark';
    const coloured = v === 'mosaic' || v === 'story' || v === 'seas';
    const b = this.selectedBasin();
    this.posterOpts.update(o => ({
      ...o,
      palette: coloured ? (dark && v !== 'seas' ? 'black-vivid' : 'white-pastel') : 'white-ink',
      by: v === 'story' || v === 'seas' ? 'sea' : 'basin',
      focus: b && b.river && b.name ? b.id : -1,
      title: null,
      subtitle: null,
      line: null
    }));
    this.setView('poster');
  }
}
