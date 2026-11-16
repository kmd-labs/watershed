/**
 * Print poster after the grammar of classic city-map prints: a crisp map rectangle on plain paper
 * with generous margins, then a centred title in light spaced capitals, a hairline rule broken by
 * one small word, an italic line, and — quietly — a row of figures with their sources.
 * Laid out in A2 millimetres (420 × 594 upright, 594 × 420 lying); A3 and A4 are the same sheet
 * at a lower grid dpi. Lying, the map takes the left and the title block a column on the right.
 */
import { PosterOrientation } from '../poster/poster-options';

export const A2_MM = { w: 420, h: 594 };

/** Map rectangle on the upright sheet (mm). */
export const A2_MAP = { x: 30, y: 30, w: 360, h: 420 };

/** The A2 sheet and its map rectangle (mm) for an orientation. */
export function a2Sheet(orientation: PosterOrientation) {
  return orientation === 'landscape'
    ? { w: A2_MM.h, h: A2_MM.w, map: { x: 30, y: 30, w: 384, h: 360 } }
    : { w: A2_MM.w, h: A2_MM.h, map: A2_MAP };
}

export interface PosterLayout {
  /** Pixels per inch of the A2 grid (an A3 at 300 dpi is the A2 grid at 212 dpi). */
  dpi: number;
  orientation: PosterOrientation;
  paper: string;
  ink: string;
  inkSoft: string;
  accent: string;
  font: string;
  /** Logotype matching the paper (black or white wordmark with the orange dot). */
  logo: string;
  title: string;
  /** The small word set into the rule under the title. */
  ruleWord: string;
  /** One quiet italic line under the title (optional). */
  line?: string;
  /**
   * Figures; each `note` becomes a numbered source under the row, marked on its figure (the same
   * source keeps one number). No figures: no row, and the title block moves down.
   */
  facts: { value: string; caption: string; note?: string }[];
  credits: string;
}

const images = new Map<string, Promise<HTMLImageElement | null>>();

function loadImage(src: string): Promise<HTMLImageElement | null> {
  let p = images.get(src);
  if (!p) {
    p = fetchImage(src);
    images.set(src, p);
  }
  return p;
}

function fetchImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Greedy word wrap to a pixel width. */
function wrap(x: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && x.measureText(next).width > maxW) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Visible text width with `spacing` between letters (measured without the context's own
 * letter-spacing, which some engines include in measureText and others ignore). */
function spacedWidth(x: CanvasRenderingContext2D, text: string, spacing: number): number {
  const prev = x.letterSpacing;
  x.letterSpacing = '0px';
  const w = x.measureText(text).width;
  x.letterSpacing = prev;
  return w + spacing * Math.max(0, [...text].length - 1);
}

/** Draws text centred on `cx`, compensating the trailing letter-spacing. */
function centred(x: CanvasRenderingContext2D, text: string, cx: number, y: number, spacing: number) {
  x.letterSpacing = `${spacing}px`;
  const w = spacedWidth(x, text, spacing);
  x.textAlign = 'left';
  x.fillText(text, cx - w / 2, y);
  x.letterSpacing = '0px';
}

export function a2Pixels(dpi: number, orientation: PosterOrientation = 'portrait') {
  const px = (mm: number) => Math.round((mm * dpi) / 25.4);
  const s = a2Sheet(orientation);
  return { px, width: px(s.w), height: px(s.h), map: { x: px(s.map.x), y: px(s.map.y), w: px(s.map.w), h: px(s.map.h) } };
}

type Px = (mm: number) => number;

/**
 * Title, the rule broken by one small word, and the italic line, centred on `cx`.
 * `lineWrap`: the line wraps to `lineMaxW` (lying sheet) instead of shrinking to one line.
 * Returns the baseline of the last thing drawn.
 */
function titleBlock(x: CanvasRenderingContext2D, o: PosterLayout, cx: number, titleY: number, maxW: number, lineMaxW: number, lineWrap: boolean, px: Px): number {
  // Title: light, widely spaced capitals, fitted to `maxW`. In the narrow column of a lying
  // sheet a long title ("MORZE ŚRÓDZIEMNE") breaks into two balanced lines rather than shrink.
  const titleText = o.title.toUpperCase();
  let titleSize = px(25);
  const widest = (lines: string[]) => Math.max(...lines.map(l => spacedWidth(x, l, titleSize * 0.32)));
  x.font = `300 ${titleSize}px ${o.font}`;
  let lines = [titleText];
  const words = titleText.split(' ');
  if (lineWrap && words.length > 1) {
    x.font = `300 ${px(16)}px ${o.font}`;
    const one = spacedWidth(x, titleText, px(16) * 0.32);
    if (one > maxW) {
      let best = lines, bestW = Infinity;
      for (let k = 1; k < words.length; k++) {
        const cand = [words.slice(0, k).join(' '), words.slice(k).join(' ')];
        const w = Math.max(...cand.map(l => spacedWidth(x, l, px(16) * 0.32)));
        if (w < bestW) { best = cand; bestW = w; }
      }
      lines = best;
    }
    x.font = `300 ${titleSize}px ${o.font}`;
  }
  while (widest(lines) > maxW && titleSize > px(10)) {
    titleSize *= 0.96;
    x.font = `300 ${titleSize}px ${o.font}`;
  }
  const lead = titleSize * 1.18;
  x.fillStyle = o.ink;
  lines.forEach((ln, k) => centred(x, ln, cx, titleY + k * lead, titleSize * 0.32));
  const titleW = widest(lines);
  titleY += (lines.length - 1) * lead;

  // Hairline rule broken by one small spaced word (the city-poster "COUNTRY" line).
  const ruleY = titleY + px(13);
  const wordSize = px(3.6);
  x.font = `500 ${wordSize}px ${o.font}`;
  const word = o.ruleWord.toUpperCase();
  const wordW = spacedWidth(x, word, wordSize * 0.4);
  const half = Math.min(maxW / 2, Math.max(titleW / 2, wordW / 2 + px(30)));
  const gap = wordW / 2 + px(6);
  x.fillStyle = o.ink;
  if (half > gap) {
    x.fillRect(cx - half, ruleY - wordSize * 0.36, half - gap, Math.max(1, px(0.3)));
    x.fillRect(cx + gap, ruleY - wordSize * 0.36, half - gap, Math.max(1, px(0.3)));
  }
  centred(x, word, cx, ruleY, wordSize * 0.4);
  let bottom = ruleY;

  // The optional italic line: shrunk to one line, or wrapped.
  x.fillStyle = o.inkSoft;
  if (o.line) {
    let ls = px(3.4);
    x.font = `italic 300 ${ls}px ${o.font}`;
    if (lineWrap) {
      wrap(x, o.line, lineMaxW).forEach((ln, k) => {
        bottom = ruleY + px(10) + k * px(5);
        centred(x, ln, cx, bottom, ls * 0.04);
      });
    } else {
      while (spacedWidth(x, o.line, ls * 0.04) > lineMaxW && ls > px(2)) {
        ls *= 0.95;
        x.font = `italic 300 ${ls}px ${o.font}`;
      }
      bottom = ruleY + px(10);
      centred(x, o.line, cx, bottom, ls * 0.04);
    }
  }
  return bottom;
}

/**
 * One figure centred on `fx`, value baseline at `y`: a light numeral (stepped down to fit
 * `maxW`), its hanging source number, and a spaced caption under it (at most three lines of
 * `capW`). Sources are numbered in order; the same source keeps one number.
 */
function figure(x: CanvasRenderingContext2D, o: PosterLayout, f: PosterLayout['facts'][number], fx: number, y: number, maxW: number, capW: number, notes: string[], px: Px) {
  x.fillStyle = o.ink;
  let valueSize = px(8.5);
  x.font = `300 ${valueSize}px ${o.font}`;
  while (spacedWidth(x, f.value, -valueSize * 0.01) > maxW && valueSize > px(4.5)) {
    valueSize *= 0.95;
    x.font = `300 ${valueSize}px ${o.font}`;
  }
  centred(x, f.value, fx, y, -valueSize * 0.01);
  if (f.note) {
    const known = notes.indexOf(f.note);
    const num = known >= 0 ? known + 1 : notes.push(f.note);
    const vw = spacedWidth(x, f.value, -valueSize * 0.01);
    x.fillStyle = o.accent;
    x.font = `500 ${px(2.6)}px ${o.font}`;
    x.textAlign = 'left';
    x.fillText(String(num), fx + vw / 2 + px(0.9), y - valueSize * 0.52);
  }
  x.fillStyle = o.inkSoft;
  const cap = px(2.25);
  x.font = `400 ${cap}px ${o.font}`;
  x.letterSpacing = `${cap * 0.14}px`;
  const lines = wrap(x, f.caption.toUpperCase(), capW).slice(0, 3);
  x.letterSpacing = '0px';
  lines.forEach((ln, k) => centred(x, ln, fx, y + px(6.5) + k * px(3.6), cap * 0.14));
}

/**
 * The numbered sources under a short book-style rule, in `cols` balanced columns of `colW`
 * from `left`, the last line on `bottom`.
 */
function sources(x: CanvasRenderingContext2D, o: PosterLayout, notes: string[], left: number, bottom: number, colW: number, cols: 1 | 2, px: Px) {
  const noteSize = px(1.95), noteLead = px(2.75), indent = px(3), colGap = px(10);
  x.font = `400 ${noteSize}px ${o.font}`;
  const wrapped = notes.map(nt => wrap(x, nt, colW - indent));
  const total = wrapped.reduce((s, l) => s + l.length, 0);
  let split = wrapped.length;
  if (cols === 2) {
    split = 0;
    for (let acc = 0; split < wrapped.length && acc + wrapped[split].length <= Math.ceil(total / 2); split++) acc += wrapped[split].length;
    split = wrapped.length > 1 ? Math.max(1, Math.min(split, wrapped.length - 1)) : wrapped.length;
  }
  const columns = cols === 2 ? [wrapped.slice(0, split), wrapped.slice(split)] : [wrapped];
  const rows = Math.max(1, ...columns.map(c => c.reduce((s, l) => s + l.length, 0)));
  const notesTop = bottom - (rows - 1) * noteLead;
  if (notes.length) {
    x.fillStyle = o.ink;
    x.globalAlpha = 0.25;
    x.fillRect(left, notesTop - px(4.2), px(16), Math.max(1, px(0.2)));
  }
  x.textAlign = 'left';
  columns.forEach((col, c) => {
    let ly = notesTop;
    const lx = left + c * (colW + colGap);
    col.forEach((lines, k) => {
      const num = (c === 0 ? 0 : split) + k + 1;
      x.globalAlpha = 1;
      x.fillStyle = o.accent;
      x.font = `500 ${noteSize}px ${o.font}`;
      x.fillText(String(num), lx, ly);
      x.fillStyle = o.inkSoft;
      x.globalAlpha = 0.9;
      x.font = `400 ${noteSize}px ${o.font}`;
      lines.forEach(ln => {
        x.fillText(ln, lx + indent, ly);
        ly += noteLead;
      });
    });
  });
  x.globalAlpha = 1;
}

/** The data credits on the bottom margin line from `left`, the logotype ending at `logoRight`. */
async function foot(x: CanvasRenderingContext2D, o: PosterLayout, left: number, footY: number, creditsW: number, logoRight: number, px: Px) {
  x.globalAlpha = 0.85;
  x.fillStyle = o.inkSoft;
  x.textAlign = 'left';
  x.font = `400 ${px(2.1)}px ${o.font}`;
  x.fillText(wrap(x, o.credits, creditsW)[0] ?? '', left, footY);
  x.globalAlpha = 1;
  const logo = await loadImage(o.logo);
  if (logo) {
    const lh = px(5.2);
    const lw = logo.naturalWidth && logo.naturalHeight ? (lh * logo.naturalWidth) / logo.naturalHeight : lh * 2.5;
    x.drawImage(logo, logoRight - lw, footY - lh * 0.82, lw, lh);
  }
}

/** Draws the poster around `map` (sized `a2Pixels(o.dpi, o.orientation).map`). */
export async function drawPoster(map: HTMLCanvasElement, o: PosterLayout): Promise<HTMLCanvasElement> {
  await document.fonts?.ready;
  // Weights not used on the page are fetched only when asked for.
  await Promise.all(['300', 'italic 300', '400', '500'].map(w => document.fonts?.load(`${w} 64px ${o.font}`).catch(() => undefined)));
  const { px, width: W, height: H, map: M } = a2Pixels(o.dpi, o.orientation);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d')!;
  x.fillStyle = o.paper;
  x.fillRect(0, 0, W, H);
  x.drawImage(map, M.x, M.y, M.w, M.h);
  x.textBaseline = 'alphabetic';
  const notes: string[] = [];
  const n = o.facts.length;
  const footY = H - px(14);

  if (o.orientation === 'landscape') {
    // A column right of the map: the title block level with the map's top, the figures one
    // under another with short hairlines between them, the sources at the column's foot; the
    // credits under the map.
    const colX = M.x + M.w + px(30), colW = W - px(30) - colX, cx = colX + colW / 2;
    const top = titleBlock(x, o, cx, M.y + px(19), colW, colW, true, px);
    const step = px(34);
    const factsTop = Math.max(top + px(30), M.y + px(82));
    o.facts.forEach((f, i) => {
      const fy = factsTop + i * step;
      if (i) {
        x.fillStyle = o.ink;
        x.globalAlpha = 0.18;
        x.fillRect(cx - px(10), fy - px(11), px(20), Math.max(1, px(0.2)));
        x.globalAlpha = 1;
      }
      figure(x, o, f, cx, fy, colW - px(6), colW - px(10), notes, px);
    });
    sources(x, o, notes, colX, footY - px(12), colW, 1, px);
    await foot(x, o, M.x, footY, M.w, colX + colW, px);
    return cv;
  }

  // Upright: the title block under the map (lower without figures), one row of figures, the
  // sources in two balanced columns, then the foot line.
  const cx = W / 2;
  const lift = n ? 0 : 24;
  titleBlock(x, o, cx, px(A2_MAP.y + A2_MAP.h + 38 + lift), px(300), px(A2_MAP.w), false, px);
  const rowTop = px(534);
  const colW = px(A2_MAP.w) / Math.max(1, n);
  if (n) {
    x.fillStyle = o.ink;
    x.globalAlpha = 0.18;
    for (let i = 1; i < n; i++) x.fillRect(M.x + colW * i, rowTop, Math.max(1, px(0.2)), px(26));
    x.fillRect(M.x, rowTop - px(8), M.w, Math.max(1, px(0.2)));
    x.globalAlpha = 1;
  }
  o.facts.forEach((f, i) => figure(x, o, f, M.x + colW * (i + 0.5), rowTop + px(8), colW - px(9), colW - px(12), notes, px));
  sources(x, o, notes, M.x, footY - px(5.5), (M.w - px(26) - px(10)) / 2, 2, px);
  await foot(x, o, M.x, footY, px(300), M.x + M.w, px);
  return cv;
}

/** The poster as a PNG tagged with its print resolution. */
export async function posterPng(cv: HTMLCanvasElement, dpi: number): Promise<Blob> {
  const blob = await new Promise<Blob>((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'));
  return withDpi(blob, dpi);
}

// ─── PNG resolution tag ─────────────────────────────────────────────────────

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Inserts a pHYs chunk so print software reads the PNG at its true size (e.g. A2 at 300 dpi)
 * instead of the 72/96 dpi default.
 */
async function withDpi(blob: Blob, dpi: number): Promise<Blob> {
  const src = new Uint8Array(await blob.arrayBuffer());
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  dv.setUint32(8, ppm);
  dv.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  const ihdrEnd = 8 + 8 + 13 + 4; // signature + IHDR (length, type, 13 data bytes, crc)
  return new Blob([src.subarray(0, ihdrEnd), chunk, src.subarray(ihdrEnd)], { type: 'image/png' });
}
