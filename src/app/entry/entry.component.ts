import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
  viewChildren
} from '@angular/core';
import { ArrowRight, Check, LucideAngularModule, Palette, X } from 'lucide-angular';
import { BreakpointService, ThemeService } from '@kmd/design-system';
import { isAtMost } from '@kmd/design-system/utils/breakpoints';
import { I18nService } from '../core/i18n/i18n.service';
import { Lang } from '../core/i18n/i18n.types';
import { LOOKS, Look, LookService } from '../core/look';
import { EntryStep, SEA_IDS, SeaId, SeaService } from '../core/sea';
import { EntryMap, EntryStyle, Fit, Insets, Rgb, SeasMap, parseRgb } from './entry-map';

/** The entry map file, fetched once per visit (the entry opens again on "Change sea…"). */
let seasMap: Promise<SeasMap> | null = null;
const loadSeasMap = () =>
  (seasMap ??= fetch('assets/data/seas-map.json').then(r => (r.ok ? r.json() : Promise.reject(r.status))).catch(e => {
    seasMap = null;
    throw e;
  }));

/** At most this many device pixels per map canvas (keeps big, dense screens light). */
const MAX_PIXELS = 4.5e6;
/** The move from the modes to the map of seas, and back (ms; the SCSS times its panels to it). */
const MOVE_MS = 1000;
/** The map of seas is the modes' map brought this much closer (phones: less, to keep all five). */
const SEA_ZOOM = 1.4;
const SEA_ZOOM_PHONE = 1.3;
/** The map of seas, a little larger than fitting between the heading and the dock (wide screens). */
const SEA_FIT = 1.1;
/** A chosen sea: the map zooms in on it while its data starts to load, then the entry fades. */
const OPEN_MS = 700;
const OPEN_ZOOM = 1.35;
const FADE_MS = 280;

/**
 * The entry, at the start of every visit. First the mode: one map of Europe with the five seas'
 * drainage basins, split in two — Atlas (light, on paper) and Midnight (dark, in neon); each half
 * is one button. Then, after a zoom into the map in the chosen mode, the sea: five labelled,
 * clickable seas (the names, or the basins themselves). The chosen sea starts loading at once
 * while the map zooms in on it; nothing of the seas' own data is downloaded before that
 * (BalticDataService.load). "Change sea…" opens the map of seas directly.
 */
@Component({
  selector: 'app-entry',
  standalone: true,
  imports: [LucideAngularModule],
  templateUrl: './entry.component.html',
  styleUrl: './entry.component.scss',
  host: { '(document:keydown.escape)': 'close()' }
})
export class EntryComponent {
  readonly i18n = inject(I18nService);
  readonly seas = inject(SeaService);
  readonly look = inject(LookService);
  readonly theme = inject(ThemeService);
  readonly bp = inject(BreakpointService);
  private readonly destroyRef = inject(DestroyRef);

  readonly closeIcon = X;
  readonly modeIcon = Palette;
  readonly arrowIcon = ArrowRight;
  readonly checkIcon = Check;
  readonly looks = LOOKS;
  readonly seaIds = SEA_IDS;
  /** 'look': the modes; 'sea': the map of seas in the chosen mode. */
  readonly step = this.seas.entryStep;

  /** Closing is possible once a sea is on screen; at the start of a visit a choice is needed. */
  readonly closable = computed(() => this.seas.sea() !== null);

  private readonly dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');
  private readonly stageRef = viewChild.required<ElementRef<HTMLElement>>('stage');
  private readonly paperRef = viewChild.required<ElementRef<HTMLCanvasElement>>('paper');
  private readonly nightRef = viewChild.required<ElementRef<HTMLCanvasElement>>('night');
  private readonly glowRef = viewChild.required<ElementRef<HTMLCanvasElement>>('glow');
  private readonly headRef = viewChild.required<ElementRef<HTMLElement>>('head');
  private readonly dockRef = viewChild.required<ElementRef<HTMLElement>>('dock');
  private readonly pillRefs = viewChildren<ElementRef<HTMLButtonElement>>('pill');

  readonly geo = signal<SeasMap | null>(null);
  /** The maps are drawn (they fade in). */
  readonly ready = signal(false);
  /** Modes: the half pointed at (or focused); the divider leans its way. */
  readonly lean = signal<Look | null>(null);
  /** The map is moving between the modes and the map of seas. */
  readonly moving = signal(false);
  /** Seas: the sea pointed at (map, label or keyboard). */
  readonly hot = signal<SeaId | null>(null);
  /** Seas: the chosen sea, while the map zooms in on it. */
  readonly chosen = signal<SeaId | null>(null);
  /** The entry fades out. */
  readonly leaving = signal(false);
  /** Hover note next to the mouse pointer. */
  readonly tip = signal<{ x: number; y: number; id: SeaId } | null>(null);
  /** Where the sea labels sit (CSS px), once the map of seas is laid out. */
  readonly pills = signal<{ id: SeaId; x: number; y: number }[]>([]);
  private map?: EntryMap;
  private size = { w: 0, h: 0 };

  /** Where the divider stands: leaning on the modes, aside on the map of seas. */
  readonly split = computed(() => {
    if (this.step() === 'sea') return this.look.look() === 'classic' ? 100 : 0;
    const lean = this.lean();
    return lean === 'classic' ? 58 : lean === 'midnight' ? 42 : 50;
  });

  /** Sea label texts: full names, short ones on phones. */
  readonly seaLabel = computed(() => (this.bp.mobile() ? this.i18n.t().seaShort : this.i18n.t().seaNames));

  /** The sea marked as open now, or chosen last time. */
  readonly marked = computed(() => {
    const t = this.i18n.t();
    const open = this.seas.sea(), last = this.seas.last();
    return (id: SeaId) => (open === id ? t.pickerCurrent : !open && last === id ? t.pickerLast : '');
  });

  /** "1.73 million km² · 1,573 river mouths · 82 million people" for a sea. */
  stats(id: SeaId): string {
    const b = this.geo()?.basins[id];
    if (!b) return '';
    const t = this.i18n.t();
    const parts = t.pickerStats(this.i18n.area(b.area), this.i18n.num(b.mouths));
    return b.pop ? `${parts} · ${t.pickerPeople(t.millionPeople(this.i18n.num(Math.round(b.pop / 1e6))))}` : parts;
  }

  readonly langs = computed(() => this.i18n.langs.map(l => ({ l, label: l.toUpperCase(), name: this.i18n.dicts[l].langName })));

  constructor() {
    loadSeasMap()
      .then(g => this.geo.set(g))
      .catch(() => {
        // Without the map the modes still work; the seas then sit in a row (see placePills).
      });

    afterNextRender(() => this.dialog().nativeElement.focus());

    // Fit the maps once the data is in, and again whenever the stage resizes.
    let obs: ResizeObserver | null = null;
    effect(() => {
      const geo = this.geo();
      if (!geo) return;
      untracked(() => {
        this.map ??= new EntryMap(geo);
        obs = new ResizeObserver(() => !this.moving() && !this.chosen() && this.layout());
        obs.observe(this.stageRef().nativeElement);
        this.layout();
      });
    });
    this.destroyRef.onDestroy(() => obs?.disconnect());

    // Redraw on pointing or another mode.
    effect(() => {
      this.hot();
      this.look.look();
      untracked(() => !this.moving() && this.draw());
    });
    // The labels change width with the language and the breakpoint: place them again.
    effect(() => {
      this.seaLabel();
      untracked(() => requestAnimationFrame(() => this.placePills()));
    });
  }

  // ─── choices ────────────────────────────────────────────────────────────

  /** A mode: on to the map of seas in it (the zoom). */
  toMap(l: Look) {
    if (this.moving()) return;
    this.look.set(l);
    this.lean.set(null);
    this.glide('sea');
  }

  /** Back to the modes. */
  toModes() {
    if (this.moving() || this.chosen()) return;
    this.glide('look');
  }

  /** A sea: it starts loading at once; the map zooms in on it, then the entry fades away. */
  chooseSea(id: SeaId) {
    if (this.moving() || this.chosen()) return;
    this.chosen.set(id);
    this.hot.set(id);
    this.tip.set(null);
    const same = this.seas.sea() === id;
    if (!same) this.seas.begin(id);
    const pill = this.pills().find(p => p.id === id);
    if (!this.reduced() && pill) {
      for (const c of this.canvases()) {
        c.style.transformOrigin = `${pill.x}px ${pill.y}px`;
        c.style.transition = `transform ${OPEN_MS}ms cubic-bezier(0.65, 0, 0.35, 1)`;
        c.style.transform = `scale(${OPEN_ZOOM})`;
      }
    }
    const wait = this.reduced() ? 0 : OPEN_MS - FADE_MS / 2;
    setTimeout(() => {
      this.leaving.set(true);
      setTimeout(() => this.seas.pickerOpen.set(false), this.reduced() ? 0 : FADE_MS);
    }, wait);
  }

  close() {
    if (!this.closable() || this.chosen() || this.leaving()) return;
    this.leaving.set(true);
    setTimeout(() => this.seas.pickerOpen.set(false), this.reduced() ? 0 : FADE_MS);
  }

  setLang(l: Lang) {
    this.i18n.setLang(l);
  }

  // ─── pointer (map of seas) ──────────────────────────────────────────────

  private seaAt(e: PointerEvent | MouseEvent) {
    const r = this.stageRef().nativeElement.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const i = this.map?.pick(x, y) ?? -1;
    return { x, y, id: i >= 0 ? SEA_IDS[i] : null };
  }

  onMove(e: PointerEvent) {
    if (this.step() !== 'sea' || this.moving() || this.chosen()) return;
    const p = this.seaAt(e);
    (e.currentTarget as HTMLElement).style.cursor = p.id ? 'pointer' : 'default';
    if (p.id !== this.hot()) this.hot.set(p.id);
    this.tip.set(p.id && e.pointerType === 'mouse' ? { x: p.x, y: p.y, id: p.id } : null);
  }

  onLeave() {
    if (this.chosen()) return;
    this.hot.set(null);
    this.tip.set(null);
  }

  onClick(e: MouseEvent) {
    if (this.step() !== 'sea') return;
    const p = this.seaAt(e);
    if (p.id) this.chooseSea(p.id);
  }

  // ─── layout & drawing ───────────────────────────────────────────────────

  private reduced() {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private canvases() {
    return [this.paperRef(), this.nightRef(), this.glowRef()].map(c => c.nativeElement);
  }

  /**
   * Where the basins go. Seas: fitted between the heading and the dock. Modes: the same map
   * SEA_ZOOM times smaller, centred between the bar and the halves' words, so choosing a mode
   * zooms into the map of seas.
   */
  private target(step: EntryStep): { inset: Insets; zoom: number } {
    const phone = isAtMost('mobile');
    const stage = this.stageRef().nativeElement.getBoundingClientRect();
    const head = this.headRef().nativeElement.getBoundingClientRect();
    const dock = this.dockRef().nativeElement.getBoundingClientRect();
    const pad = phone ? 8 : 32;
    const seaInset = { top: head.bottom - stage.top + pad, bottom: Math.max(0, stage.bottom - dock.top) + pad, left: pad, right: pad };
    const seaZoom = phone ? 1 : SEA_FIT;
    if (step === 'sea' || !this.map) return { inset: seaInset, zoom: seaZoom };
    const modesInset = phone ? { top: 72, right: 0, bottom: 250, left: 0 } : { top: 72, right: 24, bottom: 190, left: 24 };
    const kSea = this.map.fit(stage.width, stage.height, seaInset, seaZoom).k;
    const kModes = this.map.fit(stage.width, stage.height, modesInset, 1).k;
    return { inset: modesInset, zoom: kSea / (phone ? SEA_ZOOM_PHONE : SEA_ZOOM) / kModes };
  }

  private layout() {
    const stage = this.stageRef().nativeElement;
    if (!this.map) return;
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, devicePixelRatio || 1, Math.sqrt(MAX_PIXELS / Math.max(1, w * h)));
    for (const c of this.canvases()) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const { inset, zoom } = this.target(this.step());
    this.map.layout(w, h, dpr, inset, zoom);
    this.size = { w, h };
    this.draw();
    this.placePills();
    this.ready.set(true);
  }

  /**
   * The sea labels on the water, at the map's label points; labels that would overlap (small
   * screens) are moved apart vertically, and all stay between the heading and the dock.
   */
  private placePills() {
    const map = this.map;
    if (!map || !this.size.w) return;
    const els = this.pillRefs().map(r => r.nativeElement);
    const anchors = map.anchors();
    const boxes = SEA_IDS.map((id, i) => {
      const el = els[i];
      return { id, x: anchors[i][0], y: anchors[i][1], w: el?.offsetWidth || 140, h: el?.offsetHeight || 32 };
    });
    for (let pass = 0; pass < 6; pass++) {
      for (const p of boxes) for (const q of boxes) {
        if (p === q || SEA_IDS.indexOf(p.id) > SEA_IDS.indexOf(q.id)) continue;
        const ox = (p.w + q.w) / 2 + 6 - Math.abs(p.x - q.x), oy = (p.h + q.h) / 2 + 6 - Math.abs(p.y - q.y);
        if (ox <= 0 || oy <= 0) continue;
        const up = p.y <= q.y ? p : q, down = up === p ? q : p;
        up.y -= oy / 2;
        down.y += oy / 2;
      }
    }
    const stage = this.stageRef().nativeElement.getBoundingClientRect();
    const head = this.headRef().nativeElement.getBoundingClientRect();
    const dock = this.dockRef().nativeElement.getBoundingClientRect();
    const top = head.bottom - stage.top + 8, bottom = dock.top - stage.top - 8;
    for (const b of boxes) {
      b.x = Math.min(this.size.w - b.w / 2 - 8, Math.max(b.w / 2 + 8, b.x));
      b.y = Math.min(bottom - b.h / 2, Math.max(top + b.h / 2, b.y));
    }
    this.pills.set(boxes.map(b => ({ id: b.id, x: b.x, y: b.y })));
  }

  /**
   * The move between the modes and the map of seas: the divider sweeps (CSS, on `split`) while
   * the drawn maps zoom and glide to where the other step puts them (a CSS transform from the
   * current fit to the target fit); then they are drawn sharp in place.
   */
  private glide(step: EntryStep) {
    const map = this.map;
    const canvases = this.canvases();
    if (!map || !this.size.w || this.reduced()) {
      this.step.set(step);
      queueMicrotask(() => this.layout());
      return;
    }
    this.moving.set(true);
    this.hot.set(null);
    this.tip.set(null);
    // Both modes drawn where the map is now: on the way back the other half opens onto it.
    this.draw(true);
    this.step.set(step);
    // The other step's panels are laid out (invisible) at once, so the target can be measured.
    requestAnimationFrame(() => {
      const from: Fit = map.current;
      const { inset, zoom } = this.target(step);
      const to = map.fit(this.size.w, this.size.h, inset, zoom);
      const s = to.k / from.k, tx = to.ox - s * from.ox, ty = to.oy - s * from.oy;
      for (const c of canvases) {
        c.style.transformOrigin = '0 0';
        c.style.transition = `transform ${MOVE_MS}ms cubic-bezier(0.65, 0, 0.25, 1)`;
        c.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
      }
      setTimeout(() => {
        for (const c of canvases) {
          c.style.transition = 'none';
          c.style.transform = 'none';
        }
        this.moving.set(false);
        this.layout();
        if (step === 'sea') this.dialog().nativeElement.focus();
      }, MOVE_MS + 20);
    });
  }

  /** The map's colours (design tokens) for either mode, whatever the page's theme. */
  private style(night: boolean): EntryStyle {
    const tok = (k: string, fb: Rgb) => parseRgb(this.theme.getTokenColor(k), fb);
    const seas = {} as Record<SeaId, Rgb>;
    for (const id of SEA_IDS) seas[id] = tok(`entry-${id}`, [59, 130, 246]);
    const set = night ? 'night' : 'paper';
    return {
      night,
      sea: tok(`entry-${set}-sea`, night ? [5, 11, 21] : [245, 247, 251]),
      land: tok(`entry-${set}-land`, night ? [11, 21, 38] : [229, 234, 241]),
      ink: tok(`entry-${set}-ink`, night ? [219, 228, 243] : [30, 41, 59]),
      seas,
      font: this.theme.getFontFamily()
    };
  }

  /** Both modes on the split map (or `both`); on the map of seas only the chosen one is seen. */
  private draw(both = false) {
    const map = this.map;
    if (!map || !this.size.w) return;
    const hot = this.step() === 'sea' ? this.hot() : null;
    const o = { hot: hot ? SEA_IDS.indexOf(hot) : -1 };
    const split = both || this.step() === 'look';
    const night = this.look.midnight();
    if (split || !night) map.render(this.paperRef().nativeElement.getContext('2d')!, this.style(false), o);
    if (split || night) {
      const st = this.style(true);
      map.render(this.nightRef().nativeElement.getContext('2d')!, st, { ...o, layer: 'base' });
      map.render(this.glowRef().nativeElement.getContext('2d')!, st, { ...o, layer: 'glow' });
    }
  }
}
