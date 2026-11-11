/**
 * Print poster after the grammar of classic city-map prints: a crisp map rectangle on plain paper
 * with generous margins, then a centred title in light spaced capitals, a hairline rule broken by
 * one small word, an italic line, and — quietly — a row of figures with their sources.
 * Laid out in A2 millimetres (420 × 594); A3 and A4 are the same sheet at a lower grid dpi.
 */

export const A2_MM = { w: 420, h: 594 };

/** Map rectangle on the sheet (mm). */
export const A2_MAP = { x: 30, y: 30, w: 360, h: 420 };

export interface PosterLayout {
  /** Pixels per inch of the A2 grid (an A3 at 300 dpi is the A2 grid at 212 dpi). */
  dpi: number;
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

export function a2Pixels(dpi: number) {
  const px = (mm: number) => Math.round((mm * dpi) / 25.4);
  return { px, width: px(A2_MM.w), height: px(A2_MM.h), map: { x: px(A2_MAP.x), y: px(A2_MAP.y), w: px(A2_MAP.w), h: px(A2_MAP.h) } };
}

/** Draws the poster around `map` (sized `a2Pixels(o.dpi).map`). */
export async function drawPoster(map: HTMLCanvasElement, o: PosterLayout): Promise<HTMLCanvasElement> {
  await document.fonts?.ready;
  // Weights not used on the page are fetched only when asked for.
  await Promise.all(['300', 'italic 300', '400', '500'].map(w => document.fonts?.load(`${w} 64px ${o.font}`).catch(() => undefined)));
  const { px, width: W, height: H, map: M } = a2Pixels(o.dpi);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d')!;
  x.fillStyle = o.paper;
  x.fillRect(0, 0, W, H);
  x.drawImage(map, M.x, M.y, M.w, M.h);
  x.textBaseline = 'alphabetic';
  const cx = W / 2;

  // Title: light, widely spaced capitals, fitted to the map width.
  let titleSize = px(25);
  const titleText = o.title.toUpperCase();
  x.font = `300 ${titleSize}px ${o.font}`;
  while (spacedWidth(x, titleText, titleSize * 0.32) > px(300) && titleSize > px(12)) {
    titleSize *= 0.96;
    x.font = `300 ${titleSize}px ${o.font}`;
  }
  // Without the figures row the title block sits lower, centred in the space under the map.
  const lift = o.facts.length ? 0 : 24;
  const titleY = px(A2_MAP.y + A2_MAP.h + 38 + lift);
  x.fillStyle = o.ink;
  centred(x, titleText, cx, titleY, titleSize * 0.32);
  const titleW = spacedWidth(x, titleText, titleSize * 0.32);

  // Hairline rule broken by one small spaced word (the city-poster "COUNTRY" line).
  const ruleY = titleY + px(13);
  const wordSize = px(3.6);
  x.font = `500 ${wordSize}px ${o.font}`;
  const word = o.ruleWord.toUpperCase();
  const wordW = spacedWidth(x, word, wordSize * 0.4);
  const half = Math.max(titleW / 2, wordW / 2 + px(30));
  const gap = wordW / 2 + px(6);
  x.fillStyle = o.ink;
  x.fillRect(cx - half, ruleY - wordSize * 0.36, half - gap, Math.max(1, px(0.3)));
  x.fillRect(cx + gap, ruleY - wordSize * 0.36, half - gap, Math.max(1, px(0.3)));
  centred(x, word, cx, ruleY, wordSize * 0.4);

  // The optional italic line (shrunk to the map width if it is long).
  x.fillStyle = o.inkSoft;
  if (o.line) {
    const y = ruleY + px(10);
    let ls = px(3.4);
    x.font = `italic 300 ${ls}px ${o.font}`;
    while (spacedWidth(x, o.line, ls * 0.04) > px(A2_MAP.w) && ls > px(2)) {
      ls *= 0.95;
      x.font = `italic 300 ${ls}px ${o.font}`;
    }
    centred(x, o.line, cx, y, ls * 0.04);
  }

  // Figures: one quiet row, hairline separators, light numerals over spaced captions.
  // A figure with a source gets a small hanging reference number (the numeral stays centred).
  const rowTop = px(534);
  const n = o.facts.length;
  const notes: string[] = [];
  const colW = px(A2_MAP.w) / Math.max(1, n);
  if (n) {
    x.fillStyle = o.ink;
    x.globalAlpha = 0.18;
    for (let i = 1; i < n; i++) x.fillRect(M.x + colW * i, rowTop, Math.max(1, px(0.2)), px(26));
    x.fillRect(M.x, rowTop - px(8), M.w, Math.max(1, px(0.2)));
    x.globalAlpha = 1;
  }
  o.facts.forEach((f, i) => {
    const fx = M.x + colW * (i + 0.5);
    x.fillStyle = o.ink;
    // Longer figures ("over 8,000 years") step down until they fit their column.
    let valueSize = px(8.5);
    x.font = `300 ${valueSize}px ${o.font}`;
    while (spacedWidth(x, f.value, -valueSize * 0.01) > colW - px(9) && valueSize > px(4.5)) {
      valueSize *= 0.95;
      x.font = `300 ${valueSize}px ${o.font}`;
    }
    centred(x, f.value, fx, rowTop + px(8), -valueSize * 0.01);
    if (f.note) {
      const known = notes.indexOf(f.note);
      const num = known >= 0 ? known + 1 : notes.push(f.note);
      const vw = spacedWidth(x, f.value, -valueSize * 0.01);
      x.fillStyle = o.accent;
      x.font = `500 ${px(2.6)}px ${o.font}`;
      x.textAlign = 'left';
      x.fillText(String(num), fx + vw / 2 + px(0.9), rowTop + px(8) - valueSize * 0.52);
    }
    x.fillStyle = o.inkSoft;
    const cap = px(2.25);
    x.font = `400 ${cap}px ${o.font}`;
    x.letterSpacing = `${cap * 0.14}px`;
    const lines = wrap(x, f.caption.toUpperCase(), colW - px(12)).slice(0, 3);
    x.letterSpacing = '0px';
    lines.forEach((ln, k) => centred(x, ln, fx, rowTop + px(14.5) + k * px(3.6), cap * 0.14));
  });

  // Foot: the numbered sources in two balanced columns under a short book-style rule, then the
  // data credits on the bottom margin line, logotype right.
  const footY = px(A2_MM.h - 14);
  const noteSize = px(1.95), noteLead = px(2.75), indent = px(3);
  const colGap = px(10), notesW = M.w - px(26);
  const noteColW = (notesW - colGap) / 2;
  x.font = `400 ${noteSize}px ${o.font}`;
  const wrapped = notes.map(nt => wrap(x, nt, noteColW - indent));
  const total = wrapped.reduce((s, l) => s + l.length, 0);
  let split = 0;
  for (let acc = 0; split < wrapped.length && acc + wrapped[split].length <= Math.ceil(total / 2); split++) acc += wrapped[split].length;
  split = wrapped.length > 1 ? Math.max(1, Math.min(split, wrapped.length - 1)) : wrapped.length;
  const columns = [wrapped.slice(0, split), wrapped.slice(split)];
  const rows = Math.max(1, ...columns.map(c => c.reduce((s, l) => s + l.length, 0)));
  const notesTop = footY - px(5.5) - (rows - 1) * noteLead;
  if (notes.length) {
    x.fillStyle = o.ink;
    x.globalAlpha = 0.25;
    x.fillRect(M.x, notesTop - px(4.2), px(16), Math.max(1, px(0.2)));
  }
  x.textAlign = 'left';
  columns.forEach((col, c) => {
    let ly = notesTop;
    const lx = M.x + c * (noteColW + colGap);
    col.forEach((lines, k) => {
      const num = (c === 0 ? 0 : split) + k + 1;
      x.globalAlpha = 1;
      x.fillStyle = o.accent;
      x.font = `500 ${noteSize}px ${o.font}`;
      x.fillText(String(num), lx, ly);
      x.fillStyle = o.inkSoft;
      x.globalAlpha = 0.9;
      x.font = `400 ${noteSize}px ${o.font}`;
      lines.forEach(ln => { x.fillText(ln, lx + indent, ly); ly += noteLead; });
    });
  });
  x.globalAlpha = 0.85;
  x.fillStyle = o.inkSoft;
  x.font = `400 ${px(2.1)}px ${o.font}`;
  x.fillText(wrap(x, o.credits, px(300))[0] ?? '', M.x, footY);
  x.globalAlpha = 1;
  const logo = await loadImage(o.logo);
  if (logo) {
    const lh = px(5.2);
    const lw = logo.naturalWidth && logo.naturalHeight ? (lh * logo.naturalWidth) / logo.naturalHeight : lh * 2.5;
    x.drawImage(logo, M.x + M.w - lw, footY - lh * 0.82, lw, lh);
  }

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
