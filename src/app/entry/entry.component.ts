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
  viewChild
} from '@angular/core';
import { LucideAngularModule, Palette, X } from 'lucide-angular';
import { ThemeService } from '@kmd/design-system';
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
/** The shared move between the split map and the full map (ms; matches the SCSS). */
const MOVE_MS = 800;
/** After a sea is clicked on the split map, its half fills the screen (zooming into the sea)
 * before the sea opens. */
const OPEN_MS = 650;
const OPEN_ZOOM = 1.6;
/** The full map is the split map brought a little closer (on phones, whose split map is a
 * cropped close-up, the whole basins a little closer than fitting). */
const SEA_ZOOM = 1.15;

/**
 * The entry, at the start of every visit: one map of Europe with the five seas' drainage basins,
 * split in two — light mode on paper (left), dark mode in neon at night (right). A click on a sea
 * opens it in the mode of its half; a click elsewhere in a half (or its button) moves on to the
 * full map in that mode — the divider sweeps aside while the map glides to its new place — where
 * the sea is chosen with names, numbers and buttons. "Change sea…" opens the full map directly.
 * Nothing of the seas' own data is downloaded before the choice (BalticDataService.load); the
 * map itself is one file, fetched when the entry opens.
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
  private readonly destroyRef = inject(DestroyRef);

  readonly closeIcon = X;
  readonly modeIcon = Palette;
  readonly looks = LOOKS;
  /** 'look': the split map; 'sea': the full map in the chosen mode. */
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

  readonly geo = signal<SeasMap | null>(null);
  /** The maps are drawn (they fade in). */
  readonly ready = signal(false);
  /** Split map: the half the pointer (or focus) is in; the divider leans its way. */
  readonly lean = signal<Look | null>(null);
  /** A sea was clicked on the split map: its half fills the screen, then the sea opens. */
  readonly opening = signal<Look | null>(null);
  /** The map is gliding between the split and the full map. */
  readonly moving = signal(false);
  /** The sea under the pointer or keyboard focus. */
  readonly hot = signal<SeaId | null>(null);
  /** Hover note next to the mouse pointer (with the mode a click opens, on the split map). */
  readonly tip = signal<{ x: number; y: number; id: SeaId; look: Look | null } | null>(null);
  private map?: EntryMap;
  private size = { w: 0, h: 0 };

  /** Where the divider stands: leaning on the split map, aside on the full map. */
  readonly split = computed(() => {
    const opening = this.opening();
    const side = opening ?? (this.step() === 'sea' ? this.look.look() : null);
    if (side) return side === 'classic' ? 100 : 0;
    const lean = this.lean();
    return lean === 'classic' ? 60 : lean === 'midnight' ? 40 : 50;
  });

  readonly cards = computed(() => {
    const t = this.i18n.t();
    const open = this.seas.sea(), last = this.seas.last();
    return SEA_IDS.map(id => ({
      id,
      name: t.seaNames[id],
      mark: open === id ? t.pickerCurrent : !open && last === id ? t.pickerLast : ''
    }));
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
        // Without the map the modes' buttons and the sea buttons still work.
      });

    afterNextRender(() => this.dialog().nativeElement.focus());

    // Fit the maps once the data is in, and again whenever the stage resizes.
    let obs: ResizeObserver | null = null;
    effect(() => {
      const geo = this.geo();
      if (!geo) return;
      untracked(() => {
        this.map ??= new EntryMap(geo);
        obs = new ResizeObserver(() => !this.moving() && this.layout());
        obs.observe(this.stageRef().nativeElement);
        this.layout();
      });
    });
    this.destroyRef.onDestroy(() => obs?.disconnect());

    // Redraw on pointing, language (names) or another mode (the page around the full map).
    effect(() => {
      this.hot();
      this.i18n.t();
      this.look.look();
      untracked(() => !this.moving() && this.draw());
    });
  }

  // ─── choices ────────────────────────────────────────────────────────────

  /** On to the full map of seas in a mode (the shared move). */
  toMap(l: Look) {
    if (this.moving() || this.opening()) return;
    this.look.set(l);
    this.lean.set(null);
    this.glide('sea');
  }

  /** Back to the split map. */
  toModes() {
    if (this.moving()) return;
    this.glide('look');
  }

  chooseSea(id: SeaId) {
    if (this.seas.sea() === id) this.seas.pickerOpen.set(false);
    else this.seas.choose(id);
  }

  /** A sea clicked on the split map: that half's mode, that sea — the map zooms in on it. */
  private openFromSplit(l: Look, id: SeaId, x: number, y: number) {
    this.look.set(l);
    this.opening.set(l);
    this.tip.set(null);
    if (this.reduced()) {
      this.chooseSea(id);
      return;
    }
    for (const c of this.canvases()) {
      c.style.transformOrigin = `${x}px ${y}px`;
      c.style.transition = `transform ${OPEN_MS}ms cubic-bezier(0.5, 0, 0.75, 0)`;
      c.style.transform = `scale(${OPEN_ZOOM})`;
    }
    setTimeout(() => this.chooseSea(id), OPEN_MS);
  }

  private canvases() {
    return [this.paperRef(), this.nightRef(), this.glowRef()].map(c => c.nativeElement);
  }

  close() {
    if (this.closable() && !this.opening()) this.seas.pickerOpen.set(false);
  }

  setLang(l: Lang) {
    this.i18n.setLang(l);
  }

  // ─── pointer ────────────────────────────────────────────────────────────

  private at(e: PointerEvent | MouseEvent) {
    const r = this.stageRef().nativeElement.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const i = this.map?.pick(x, y) ?? -1;
    // The half under the pointer: by where the divider stands now (it leans away from the pointer).
    const half: Look = x < (r.width * this.split()) / 100 ? 'classic' : 'midnight';
    return { x, y, id: i >= 0 ? SEA_IDS[i] : null, half };
  }

  onMove(e: PointerEvent) {
    if (this.moving() || this.opening()) return;
    const p = this.at(e);
    const onSplit = this.step() === 'look';
    if (onSplit) this.lean.set(p.half);
    (e.currentTarget as HTMLElement).style.cursor = p.id || onSplit ? 'pointer' : 'default';
    if (p.id !== this.hot()) this.hot.set(p.id);
    this.tip.set(p.id && e.pointerType === 'mouse' ? { x: p.x, y: p.y, id: p.id, look: onSplit ? p.half : null } : null);
  }

  onLeave() {
    this.hot.set(null);
    this.tip.set(null);
    if (this.step() === 'look') this.lean.set(null);
  }

  onClick(e: MouseEvent) {
    if (this.moving() || this.opening()) return;
    const p = this.at(e);
    if (this.step() === 'sea') {
      if (p.id) this.chooseSea(p.id);
    } else if (p.id) {
      this.openFromSplit(p.half, p.id, p.x, p.y);
    } else {
      this.toMap(p.half);
    }
  }

  // ─── drawing ────────────────────────────────────────────────────────────

  private reduced() {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Where the basins go: between the halves' words (split) or the heading and the dock (full). */
  private target(step: EntryStep): { inset: Insets; zoom: number } {
    const phone = isAtMost('mobile');
    // On a tall phone the split map is drawn larger, cropped at the sides.
    const split = phone
      ? { inset: { top: 70, right: 0, bottom: 230, left: 0 }, zoom: 2.1 }
      : { inset: { top: 64, right: 24, bottom: 150, left: 24 }, zoom: 1.04 };
    if (step === 'look') return split;
    const stage = this.stageRef().nativeElement.getBoundingClientRect();
    const head = this.headRef().nativeElement.getBoundingClientRect();
    const dock = this.dockRef().nativeElement.getBoundingClientRect();
    const pad = phone ? 8 : 32;
    const inset = { top: head.bottom - stage.top + pad, bottom: Math.max(0, stage.bottom - dock.top) + pad, left: pad, right: pad };
    if (phone || !this.map) return { inset, zoom: SEA_ZOOM };
    // Centred between the heading and the buttons, at the split map's scale × SEA_ZOOM.
    const kSplit = this.map.fit(stage.width, stage.height, split.inset, split.zoom).k;
    const kFit = this.map.fit(stage.width, stage.height, inset, 1).k;
    return { inset, zoom: (kSplit * SEA_ZOOM) / kFit };
  }

  private layout() {
    const stage = this.stageRef().nativeElement;
    if (!this.map) return;
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, devicePixelRatio || 1, Math.sqrt(MAX_PIXELS / Math.max(1, w * h)));
    for (const c of [this.paperRef(), this.nightRef(), this.glowRef()]) {
      c.nativeElement.width = Math.round(w * dpr);
      c.nativeElement.height = Math.round(h * dpr);
    }
    const { inset, zoom } = this.target(this.step());
    this.map.layout(w, h, dpr, inset, zoom);
    this.size = { w, h };
    this.draw();
    this.ready.set(true);
  }

  /**
   * The shared move: the divider sweeps (CSS, on `split`) while the drawn maps glide and scale
   * to where the other step puts them (a CSS transform from the current fit to the target fit);
   * then they are drawn sharp in place.
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
        c.style.transition = `transform ${MOVE_MS}ms cubic-bezier(0.22, 0.8, 0.24, 1)`;
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

  /** Both halves on the split map (or `both`); on the full map only the chosen mode is seen. */
  private draw(both = false) {
    const map = this.map;
    if (!map || !this.size.w) return;
    const hot = this.hot();
    const t = this.i18n.t();
    const o = { hot: hot ? SEA_IDS.indexOf(hot) : -1, names: SEA_IDS.map(id => t.seaNames[id]) };
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
