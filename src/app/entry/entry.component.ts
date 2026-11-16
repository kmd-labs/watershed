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
import { EntryMap, EntryPalette, Rgb, SeasMap, parseRgb } from './entry-map';

/** The entry map file, fetched once per visit (the entry opens again on "Change sea…"). */
let seasMap: Promise<SeasMap> | null = null;
const loadSeasMap = () =>
  (seasMap ??= fetch('assets/data/seas-map.json').then(r => (r.ok ? r.json() : Promise.reject(r.status))).catch(e => {
    seasMap = null;
    throw e;
  }));

/**
 * The entry, at the start of every visit: first a look (White & Classy or Midnight City Neons,
 * each with an example), then a sea on a map of Europe with the five seas' drainage basins.
 * Nothing of the seas' own data is downloaded before the choice (BalticDataService.load); the
 * map itself is one small file, fetched when the entry opens. "Change sea…" opens it at the map.
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
  readonly looks = LOOKS;
  readonly step = this.seas.entryStep;

  /** Closing is possible once a sea is on screen; at the start of a visit a choice is needed. */
  readonly closable = computed(() => this.seas.sea() !== null);

  private readonly dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');
  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('map');
  private readonly headRef = viewChild<ElementRef<HTMLElement>>('head');
  private readonly dockRef = viewChild<ElementRef<HTMLElement>>('dock');

  readonly geo = signal<SeasMap | null>(null);
  /** The sea under the pointer or keyboard focus. */
  readonly hot = signal<SeaId | null>(null);
  /** Hover note next to the mouse pointer. */
  readonly tip = signal<{ x: number; y: number; id: SeaId } | null>(null);
  private map?: EntryMap;
  private size = { w: 0, h: 0 };

  /** The sea marked on the map: the open one, else the last visit's. */
  readonly marked = computed(() => this.seas.sea() ?? this.seas.last());

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
    // The map file loads while the look is being chosen, so the second step opens at once.
    loadSeasMap()
      .then(g => this.geo.set(g))
      .catch(() => {
        // Without the map the sea buttons below it still work.
      });

    afterNextRender(() => this.dialog().nativeElement.focus());

    // (Re)fit the map when it appears or its frame resizes.
    let obs: ResizeObserver | null = null;
    effect(() => {
      const canvas = this.canvasRef()?.nativeElement;
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

    // Redraw on pointing, another look (colours) or language (names).
    effect(() => {
      this.hot();
      this.marked();
      this.i18n.t();
      this.theme.mode();
      untracked(() => this.draw());
    });
  }

  chooseLook(l: Look) {
    this.look.set(l);
    this.step.set('sea');
    // The map step's heading takes the focus, for keyboard and screen-reader users.
    setTimeout(() => this.dialog().nativeElement.focus());
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

  // ─── map ────────────────────────────────────────────────────────────────

  private layout() {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas || !this.map) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    // Leave the heading above and the sea buttons below free (they float over the map).
    const head = this.headRef()?.nativeElement.getBoundingClientRect();
    const dock = this.dockRef()?.nativeElement.getBoundingClientRect();
    const phone = isAtMost('mobile');
    const pad = phone ? 8 : 32;
    this.map.layout(w, h, dpr, {
      top: (head ? head.bottom : 0) + pad,
      bottom: (dock ? h - dock.top : 0) + pad,
      left: pad,
      right: pad
    });
    this.size = { w, h };
    this.draw();
  }

  private palette(): EntryPalette {
    const tok = (k: string, fb: Rgb) => parseRgb(this.theme.getTokenColor(k), fb);
    const seas = {} as Record<SeaId, Rgb>;
    for (const id of SEA_IDS) seas[id] = tok(`entry-${id}`, [59, 130, 246]);
    return {
      sea: tok('entry-sea', [245, 247, 251]),
      land: tok('entry-land', [226, 232, 240]),
      ink: tok('text-main', [30, 41, 59]),
      seas,
      night: this.theme.isDark(),
      font: this.theme.getFontFamily()
    };
  }

  private draw() {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas || !this.map || !this.size.w) return;
    const hot = this.hot(), marked = this.marked();
    const t = this.i18n.t();
    this.map.draw(
      canvas.getContext('2d')!,
      this.palette(),
      hot ? SEA_IDS.indexOf(hot) : -1,
      marked ? SEA_IDS.indexOf(marked) : -1,
      SEA_IDS.map(id => t.seaNames[id])
    );
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
