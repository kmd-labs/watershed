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
import { SEA_IDS, SeaId, SeaService } from '../core/sea';
import { EntryMap, EntryStyle, Rgb, SeasMap, parseRgb } from './entry-map';

/** The entry map file, fetched once per visit (the entry opens again on "Change sea…"). */
let seasMap: Promise<SeasMap> | null = null;
const loadSeasMap = () =>
  (seasMap ??= fetch('assets/data/seas-map.json').then(r => (r.ok ? r.json() : Promise.reject(r.status))).catch(e => {
    seasMap = null;
    throw e;
  }));

/** At most this many device pixels per map canvas (keeps big, dense screens light). */
const MAX_PIXELS = 4.5e6;

/**
 * The entry, at the start of every visit: first a look — one map of Europe, half on paper
 * (White & Classy), half in neon at night (Midnight City Neons) — then a sea on that map in the
 * chosen look. Nothing of the seas' own data is downloaded before the choice
 * (BalticDataService.load); the map itself is one file, fetched when the entry opens.
 * "Change sea…" opens it at the map.
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
  readonly lookIcon = Palette;
  readonly step = this.seas.entryStep;
  readonly looks = LOOKS;

  /** Closing is possible once a sea is on screen; at the start of a visit a choice is needed. */
  readonly closable = computed(() => this.seas.sea() !== null);

  private readonly dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');
  // Step 1: the same map on paper and at night (its glow on a layer of its own, so it can hum).
  private readonly paperRef = viewChild<ElementRef<HTMLCanvasElement>>('paper');
  private readonly nightRef = viewChild<ElementRef<HTMLCanvasElement>>('night');
  private readonly glowRef = viewChild<ElementRef<HTMLCanvasElement>>('glow');
  // Step 2: the map to choose on, and the panels it leaves room for.
  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('map');
  private readonly headRef = viewChild<ElementRef<HTMLElement>>('head');
  private readonly dockRef = viewChild<ElementRef<HTMLElement>>('dock');

  readonly geo = signal<SeasMap | null>(null);
  /** Step 1: the look the pointer (or focus) leans to; the divider moves its way. */
  readonly lean = signal<Look | null>(null);
  /** Step 1 is drawn (the maps fade in). */
  readonly looksReady = signal(false);
  /** Step 2: the sea under the pointer or keyboard focus. */
  readonly hot = signal<SeaId | null>(null);
  /** Hover note next to the mouse pointer. */
  readonly tip = signal<{ x: number; y: number; id: SeaId } | null>(null);
  private map?: EntryMap;
  private size = { w: 0, h: 0 };

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
    // The map file loads at once (both steps draw it).
    loadSeasMap()
      .then(g => this.geo.set(g))
      .catch(() => {
        // Without the map the looks' names and the sea buttons still work.
      });

    afterNextRender(() => this.dialog().nativeElement.focus());

    // (Re)fit the maps when they appear, when their frame resizes, or at the other step.
    let obs: ResizeObserver | null = null;
    effect(() => {
      const step = this.step();
      const canvas = (step === 'look' ? this.paperRef() : this.canvasRef())?.nativeElement;
      const geo = this.geo();
      obs?.disconnect();
      obs = null;
      if (!canvas || !geo) return;
      this.map ??= new EntryMap(geo);
      obs = new ResizeObserver(() => this.layout());
      obs.observe(canvas);
      untracked(() => this.layout());
    });
    this.destroyRef.onDestroy(() => obs?.disconnect());

    // Step 2 redraws on pointing, another look (colours) or language (names).
    effect(() => {
      this.hot();
      this.i18n.t();
      this.theme.mode();
      untracked(() => this.step() === 'sea' && this.drawSea());
    });
  }

  chooseLook(l: Look) {
    this.look.set(l);
    this.lean.set(null);
    this.step.set('sea');
    // The map step's heading takes the focus, for keyboard and screen-reader users.
    setTimeout(() => this.dialog().nativeElement.focus());
  }

  backToLooks() {
    this.looksReady.set(false);
    this.step.set('look');
  }

  chooseSea(id: SeaId) {
    if (this.seas.sea() === id) this.seas.pickerOpen.set(false);
    else this.seas.choose(id);
  }

  close() {
    if (this.closable()) this.seas.pickerOpen.set(false);
  }

  setLang(l: Lang) {
    this.i18n.setLang(l);
  }

  // ─── drawing ────────────────────────────────────────────────────────────

  private dprFor(w: number, h: number) {
    return Math.min(2, devicePixelRatio || 1, Math.sqrt(MAX_PIXELS / Math.max(1, w * h)));
  }

  private fit(canvas: HTMLCanvasElement, w: number, h: number, dpr: number) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }

  private layout() {
    if (!this.map) return;
    if (this.step() === 'look') this.layoutLooks();
    else this.layoutSea();
  }

  /** Step 1: one map across the screen, under both halves. */
  private layoutLooks() {
    const paper = this.paperRef()?.nativeElement, night = this.nightRef()?.nativeElement, glow = this.glowRef()?.nativeElement;
    if (!paper || !night || !glow || !this.map) return;
    const w = paper.clientWidth, h = paper.clientHeight;
    if (!w || !h) return;
    const dpr = this.dprFor(w, h);
    for (const c of [paper, night, glow]) this.fit(c, w, h, dpr);
    const phone = isAtMost('mobile');
    // On a tall phone the map is drawn larger, cropped at the sides, between the heading and the names.
    this.map.layout(w, h, dpr, phone ? { top: 130, right: 0, bottom: 230, left: 0 } : { top: 80, right: 24, bottom: 120, left: 24 }, phone ? 2.1 : 1.04, false);
    this.map.render(paper.getContext('2d')!, this.style(false));
    const st = this.style(true);
    this.map.render(night.getContext('2d')!, st, { layer: 'base' });
    this.map.render(glow.getContext('2d')!, st, { layer: 'glow' });
    this.looksReady.set(true);
  }

  /** Step 2: the map between the heading and the sea buttons, in the chosen look. */
  private layoutSea() {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas || !this.map) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = this.dprFor(w, h);
    this.fit(canvas, w, h, dpr);
    const head = this.headRef()?.nativeElement.getBoundingClientRect();
    const dock = this.dockRef()?.nativeElement.getBoundingClientRect();
    const pad = isAtMost('mobile') ? 8 : 32;
    this.map.layout(w, h, dpr, {
      top: (head ? head.bottom : 0) + pad,
      bottom: (dock ? h - dock.top : 0) + pad,
      left: pad,
      right: pad
    });
    this.size = { w, h };
    this.drawSea();
  }

  /** The map's colours (design tokens), for either look. */
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

  private drawSea() {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas || !this.map || !this.size.w) return;
    const hot = this.hot();
    const t = this.i18n.t();
    this.map.render(canvas.getContext('2d')!, this.style(this.theme.isDark()), {
      hot: hot ? SEA_IDS.indexOf(hot) : -1,
      names: SEA_IDS.map(id => t.seaNames[id])
    });
  }

  private seaAt(e: PointerEvent | MouseEvent): SeaId | null {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const i = this.map?.pick(e.clientX - r.left, e.clientY - r.top) ?? -1;
    return i >= 0 ? SEA_IDS[i] : null;
  }

  onMove(e: PointerEvent) {
    const id = this.seaAt(e);
    (e.currentTarget as HTMLElement).style.cursor = id ? 'pointer' : 'default';
    if (id !== this.hot()) this.hot.set(id);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.tip.set(id && e.pointerType === 'mouse' ? { x: e.clientX - r.left, y: e.clientY - r.top, id } : null);
  }

  onLeave() {
    this.hot.set(null);
    this.tip.set(null);
  }

  onClick(e: MouseEvent) {
    const id = this.seaAt(e);
    if (id) this.chooseSea(id);
  }
}
