import { Component, ElementRef, OnDestroy, afterNextRender, computed, effect, inject, input, model, signal, untracked, viewChild } from '@angular/core';
import { LucideAngularModule, Download } from 'lucide-angular';
import { BreakpointService, ButtonComponent, DropdownComponent, DropdownOption, ThemeService } from '@kmd/design-system';
import { I18nService } from '../core/i18n/i18n.service';
import { BalticDataService } from '../core/data/baltic-data.service';
import { MOSAIC_COUNT, SUB_COUNT } from '../core/data/views';
import { cssToHex } from '../core/color';
import { A2_MM, PosterLayout, a2Pixels, drawPoster, posterPng } from '../core/poster';
import { GlobeComponent, PrintStyle } from '../globe/globe.component';
import {
  BALTIC_SEA_KM2,
  POSTER_FORMATS,
  POSTER_PALETTES,
  PosterFormat,
  PosterOptions,
  PosterPalette,
  colourFamily,
  isDarkPalette
} from './poster-options';

/**
 * Poster maker: a live preview of the print poster and every choice that shapes it — colours,
 * rivers by basin or by sea, the whole drainage basin or one river's basin, the texts, what is
 * printed, the sheet size — and the full-resolution download.
 *
 * The map is the globe's own renderer in print mode (GlobeComponent.printBegin … printEnd) for as
 * long as this view is open; renders run one at a time through `queue`.
 */
@Component({
  selector: 'app-poster-studio',
  standalone: true,
  imports: [LucideAngularModule, ButtonComponent, DropdownComponent],
  templateUrl: './poster-studio.component.html',
  styleUrl: './poster-studio.component.scss'
})
export class PosterStudioComponent implements OnDestroy {
  readonly i18n = inject(I18nService);
  readonly bp = inject(BreakpointService);
  private readonly store = inject(BalticDataService);
  private readonly theme = inject(ThemeService);

  readonly globe = input<GlobeComponent | undefined>();
  readonly options = model.required<PosterOptions>();

  readonly palettes = POSTER_PALETTES;
  readonly formats: PosterFormat[] = ['A4', 'A3', 'A2'];
  readonly downloadIcon = Download;

  private readonly frame = viewChild.required<ElementRef<HTMLElement>>('frame');
  private readonly preview = viewChild.required<ElementRef<HTMLCanvasElement>>('preview');
  private readonly frameSize = signal({ w: 0, h: 0 });

  /** The preview is being (re)drawn. */
  readonly preparing = signal(true);
  /** Download progress 0…1, or null when idle. */
  readonly progress = signal<number | null>(null);

  private queue: Promise<unknown> = Promise.resolve();
  private seq = 0;
  private mapCanvas: HTMLCanvasElement | null = null;
  private mapKey = '';
  private resizeObs?: ResizeObserver;
  private destroyed = false;

  readonly coloured = computed(() => colourFamily(this.options().palette) !== null);
  /** Print resolution: 300 dpi; phones and tablets stop at 150 (canvas size limits). */
  readonly printDpi = computed(() => (this.bp.tablet() ? 150 : 300));
  readonly sizeText = computed(() => {
    const f = POSTER_FORMATS[this.options().format];
    const dpi = this.printDpi();
    const px = (mm: number) => Math.round((mm * dpi) / 25.4);
    return this.i18n.t().posterSize(f.w, f.h, this.i18n.num(px(f.w)), this.i18n.num(px(f.h)), dpi);
  });
  readonly progressText = computed(() => {
    const p = this.progress();
    return p === null ? '' : this.i18n.t().posterRendering(Math.round(p * 100));
  });

  /** Whole drainage basin, then every named river basin, largest first. */
  readonly areaOptions = computed<DropdownOption<number>[]>(() => {
    const d = this.store.data();
    const t = this.i18n.t();
    if (!d) return [];
    const named = d.basins.filter(b => b.river && b.name).sort((a, b) => b.area - a.area);
    return [{ value: -1, label: t.posterWhole }, ...named.map(b => ({ value: b.id, label: this.i18n.river(b.name!) }))];
  });

  /** What the poster says where a text field is left empty. */
  readonly auto = computed(() => {
    const t = this.i18n.t();
    const d = this.store.data();
    const o = this.options();
    if (!d) return { title: '', subtitle: '', line: '' };
    const b = o.focus >= 0 ? d.basins[o.focus] : null;
    if (b) {
      return {
        title: b.name ? this.i18n.river(b.name).replace(/ \(.+\)$/, '') : t.unnamed,
        subtitle: t.posterRuleWordBasin,
        line: t.posterLineBasin(t.subNames[b.sub])
      };
    }
    return {
      title: t.posterTitle,
      subtitle: t.posterRuleWord,
      line: t.posterLine
    };
  });

  constructor() {
    afterNextRender(() => {
      const el = this.frame().nativeElement;
      const measure = () => this.frameSize.set({ w: el.clientWidth, h: el.clientHeight });
      this.resizeObs = new ResizeObserver(measure);
      this.resizeObs.observe(el);
      measure();
    });
    effect(() => {
      this.options();
      this.i18n.t();
      const size = this.frameSize();
      if (!this.globe() || !this.store.data() || !size.w || !size.h) return;
      untracked(() => this.refresh());
    });
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.resizeObs?.disconnect();
    const globe = this.globe();
    this.queue = this.queue.then(() => globe?.printEnd());
  }

  set(patch: Partial<PosterOptions>) {
    this.options.update(o => ({ ...o, ...patch }));
  }

  /** A new area brings its own texts back. */
  setFocus(focus: number) {
    this.set({ focus, title: null, subtitle: null, line: null });
  }

  setText(key: 'title' | 'subtitle' | 'line', e: Event) {
    const v = (e.target as HTMLInputElement).value;
    this.set({ [key]: v.trim() ? v : null });
  }

  paletteName(p: PosterPalette) {
    return this.i18n.t().posterPalettes[p];
  }

  // ─── rendering ────────────────────────────────────────────────────────────

  /** Redraws the preview shortly after the last change (map only when its look changed). */
  private refresh() {
    const my = ++this.seq;
    this.queue = this.queue
      .then(() => new Promise(r => setTimeout(r, 60)))
      .then(() => (my === this.seq && !this.destroyed ? this.renderPreview(my) : undefined))
      .catch(err => console.error('Poster preview failed:', err));
  }

  private async renderPreview(my: number) {
    const globe = this.globe();
    if (!globe) return;
    const o = this.options();
    const { w, h } = this.frameSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = Math.min(w, (h * A2_MM.w) / A2_MM.h);
    const pxW = Math.max(240, Math.round(cssW * dpr));
    const dpi = pxW / (A2_MM.w / 25.4);
    const key = JSON.stringify([o.palette, o.by, o.focus, o.seaNames, this.i18n.lang(), pxW]);
    if (key !== this.mapKey || !this.mapCanvas) {
      this.preparing.set(true);
      globe.printBegin(this.printStyle(o));
      const { map } = a2Pixels(dpi);
      this.mapCanvas = await globe.printRender(map.w, map.h, dpi, { glow: o.palette === 'black-neon' });
      this.mapKey = key;
    }
    const poster = await drawPoster(this.mapCanvas, this.layout(o, dpi));
    if (my !== this.seq || this.destroyed) return;
    const cv = this.preview().nativeElement;
    cv.width = poster.width;
    cv.height = poster.height;
    cv.getContext('2d')!.drawImage(poster, 0, 0);
    this.preparing.set(false);
  }

  download() {
    if (this.progress() !== null) return;
    this.progress.set(0);
    this.queue = this.queue
      .then(() => this.renderDownload())
      .catch(err => console.error('Poster export failed:', err))
      .finally(() => this.progress.set(null));
  }

  private async renderDownload() {
    const globe = this.globe();
    if (!globe) return;
    const o = this.options();
    const sheet = POSTER_FORMATS[o.format];
    const printDpi = this.printDpi();
    const dpi = (printDpi * sheet.w) / A2_MM.w;
    globe.printBegin(this.printStyle(o));
    const { map } = a2Pixels(dpi);
    const mapCanvas = await globe.printRender(map.w, map.h, dpi, {
      glow: o.palette === 'black-neon',
      onProgress: p => this.progress.set(p * 0.85)
    });
    this.progress.set(0.9);
    const poster = await drawPoster(mapCanvas, this.layout(o, dpi));
    const blob = await posterPng(poster, printDpi);
    this.progress.set(1);
    const d = this.store.data();
    const name = o.focus >= 0 && d ? d.basins[o.focus].name ?? 'basin' : 'baltic';
    const slug = name.replace(/ł/g, 'l').replace(/Ł/g, 'L').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `watershed-${slug}-${o.palette}-${o.format}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  }

  private tok(k: string, fb: string) {
    return cssToHex(this.theme.getTokenColor(k, fb), fb);
  }

  private printStyle(o: PosterOptions): PrintStyle {
    const d = this.store.data()!;
    const dark = isDarkPalette(o.palette);
    const p = dark ? 'print-black-' : 'print-';
    const family = colourFamily(o.palette);
    let riverColors: string[];
    if (!family) {
      const ink = this.tok(`${p}ink`, dark ? '#f5f7fb' : '#0f172a');
      riverColors = d.basins.map(() => ink);
    } else if (o.by === 'sea') {
      const pal = Array.from({ length: SUB_COUNT }, (_, i) => this.tok(`${family}-sea-${i}`, '#888888'));
      riverColors = d.basins.map(b => pal[b.sub] ?? pal[0]);
    } else {
      const pal = Array.from({ length: MOSAIC_COUNT }, (_, i) => this.tok(`${family}-${i}`, '#888888'));
      riverColors = d.basins.map(b => pal[b.mosaic] ?? pal[0]);
    }
    return {
      paper: this.tok(`${p}paper`, dark ? '#040812' : '#ffffff'),
      sea: this.tok(`${p}sea`, dark ? '#0b1530' : '#f0f3f7'),
      divide: this.tok(`${p}divide`, '#94a3b8'),
      blend: dark ? 'screen' : 'multiply',
      riverColors,
      focus: o.focus,
      ink: !family,
      seaLabel: dark ? this.tok('print-black-sea-label', '#b4c0d0') : this.tok('print-ink-soft', '#64748b'),
      seaNames: o.seaNames
    };
  }

  private layout(o: PosterOptions, dpi: number): PosterLayout {
    const t = this.i18n.t();
    const dark = isDarkPalette(o.palette);
    const p = dark ? 'print-black-' : 'print-';
    const a = this.auto();
    return {
      dpi,
      paper: this.tok(`${p}paper`, dark ? '#040812' : '#ffffff'),
      ink: this.tok(`${p}ink`, dark ? '#f5f7fb' : '#0f172a'),
      inkSoft: this.tok(`${p}ink-soft`, '#64748b'),
      // Source numbers: the KMD orange on white, a quieter amber on black.
      accent: dark ? this.tok('print-black-accent', '#9c7a52') : this.tok('accent', '#d37400'),
      font: this.theme.getFontFamily(),
      logo: `assets/design-system/logo/${dark ? 'kmd-white-orange' : 'kmd-black-orange'}.svg`,
      title: o.title ?? a.title,
      ruleWord: o.subtitle ?? a.subtitle,
      line: o.line ?? a.line,
      facts: o.facts ? this.facts(o) : [],
      credits: t.posterCredits
    };
  }

  /** The figures row: the Baltic in numbers, or the chosen river basin's own. Each with its source. */
  private facts(o: PosterOptions): PosterLayout['facts'] {
    const t = this.i18n.t();
    const d = this.store.data()!;
    const total = d.total;
    const pct = (v: number) => `${this.i18n.num(v * 100, v < 0.1 ? 1 : 0)}%`;
    const b = o.focus >= 0 ? d.basins[o.focus] : null;
    if (!b) {
      return [
        { value: this.i18n.num(total.nout), caption: t.factRivers, note: t.factRiversNote },
        { value: t.factPeopleValue, caption: t.factPeople, note: t.factPeopleNote },
        { value: t.factRenewalValue, caption: t.factRenewal, note: t.factRenewalNote },
        { value: t.factBrackishValue, caption: t.factBrackish, note: t.factBrackishNote },
        { value: `${this.i18n.num(total.parea / BALTIC_SEA_KM2, 1)} ×`, caption: t.factRatio, note: t.factRatioNote(this.i18n.area(total.parea)) }
      ];
    }
    return [
      { value: this.i18n.area(b.area), caption: t.factBasinArea, note: t.noteHydro },
      { value: pct(b.area / total.parea), caption: t.factBasinShare, note: t.noteHydro },
      { value: this.i18n.flow(b.dis), caption: t.factBasinFlow, note: t.noteFlow },
      ...(b.len ? [{ value: `${this.i18n.num(b.len)} ${t.km}`, caption: t.factBasinLength, note: t.noteHydro }] : []),
      { value: `${this.i18n.num(b.rkm)} ${t.km}`, caption: t.factBasinNetwork, note: t.noteHydro }
    ];
  }
}
