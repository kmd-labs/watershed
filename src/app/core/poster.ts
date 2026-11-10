export interface PosterLegendItem {
  label: string;
  color: string;
  kind: 'fill' | 'line';
}

export interface PosterOptions {
  width: number;
  height: number;
  dark: boolean;
  background: string;
  ink: string;
  dim: string;
  font: string;
  title: string;
  subtitle: string;
  legend: PosterLegendItem[];
  stats: string;
  credits: string;
  /** Accent colour (heading rule). */
  accent: string;
  /** "The Baltic in numbers": set in the empty south-east corner of the map. */
  facts?: PosterFacts;
}

export interface PosterFacts {
  heading: string;
  items: { value: string; caption: string }[];
  note: string;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Lays the rendered map out as a poster: map on top, then a footer with the KMD logotype, title,
 * view, legend, headline numbers and data credits. Sizes are relative to the poster width.
 */
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

/**
 * "The Baltic in numbers" in the south-east corner of the map, outside the basin (Belarus and
 * Russia beyond the divide): accent heading with a hairline, then each figure as a large light
 * numeral over a small letter-spaced caption, separated by hairlines.
 */
function drawFacts(x: CanvasRenderingContext2D, f: PosterFacts, o: PosterOptions, mapH: number, u: number) {
  const left = o.width * 0.655;
  const maxW = o.width - left - 150 * u;
  let size = 92 * u;
  const capSize = 27 * u;
  const capLead = 38 * u;
  const block = () => {
    x.font = `400 ${capSize}px ${o.font}`;
    const caps = f.items.map(it => wrap(x, it.caption.toUpperCase(), maxW).length);
    return 70 * u + caps.reduce((h, n) => h + size * 1.02 + 14 * u + n * capLead + 40 * u, 0) + 50 * u;
  };
  // Fit the block between ~70% of the map height and its bottom edge.
  const top = mapH * 0.7, room = mapH - top - 40 * u;
  while (block() > room && size > 60 * u) size -= 4 * u;
  let y = top;

  // Heading: short accent rule + letter-spaced caps.
  x.fillStyle = o.accent;
  x.fillRect(left, y - 10 * u, 64 * u, 3 * u);
  x.font = `600 ${capSize}px ${o.font}`;
  x.letterSpacing = `${capSize * 0.22}px`;
  x.fillText(f.heading.toUpperCase(), left + 88 * u, y);
  y += 70 * u;

  f.items.forEach((it, i) => {
    if (i > 0) {
      x.fillStyle = o.ink;
      x.globalAlpha = 0.14;
      x.fillRect(left, y - 26 * u, maxW, Math.max(1, 1.5 * u));
      x.globalAlpha = 1;
    }
    y += size * 0.86;
    x.letterSpacing = `${-size * 0.02}px`;
    x.fillStyle = o.ink;
    x.font = `300 ${size}px ${o.font}`;
    x.fillText(it.value, left, y);
    y += 14 * u + capLead * 0.7;
    x.letterSpacing = `${capSize * 0.12}px`;
    x.fillStyle = o.dim;
    x.font = `400 ${capSize}px ${o.font}`;
    for (const line of wrap(x, it.caption.toUpperCase(), maxW)) {
      x.fillText(line, left, y);
      y += capLead;
    }
    y += 40 * u;
  });

  x.letterSpacing = '0px';
  x.globalAlpha = 0.75;
  x.fillStyle = o.dim;
  x.font = `400 ${21 * u}px ${o.font}`;
  for (const line of wrap(x, f.note, maxW)) {
    x.fillText(line, left, y);
    y += 30 * u;
  }
  x.globalAlpha = 1;
}

export async function composePoster(map: HTMLCanvasElement, o: PosterOptions): Promise<Blob> {
  await document.fonts?.ready;
  // Weights not used on the page are fetched only when asked for.
  await Promise.all(['300', '400', '600'].map(w => document.fonts?.load(`${w} 64px ${o.font}`).catch(() => undefined)));
  const W = o.width, H = o.height;
  const u = W / 3000; // layout unit: 1 px at 3000 px width
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d')!;
  x.fillStyle = o.background;
  x.fillRect(0, 0, W, H);
  const mapH = Math.round((map.height * W) / map.width);
  x.drawImage(map, 0, 0, W, mapH);
  x.textBaseline = 'alphabetic';
  if (o.facts) drawFacts(x, o.facts, o, mapH, W / 3000);

  const left = 160 * u;
  let y = mapH + 90 * u;
  const logo = await loadImage(`assets/design-system/logo/${o.dark ? 'kmd-white-orange' : 'kmd-black-orange'}.svg`);
  if (logo) {
    const lh = 64 * u;
    const lw = logo.naturalWidth && logo.naturalHeight ? (lh * logo.naturalWidth) / logo.naturalHeight : lh * 2.5;
    x.drawImage(logo, left, y, lw, lh);
  }
  y += 64 * u + 110 * u;

  x.textBaseline = 'alphabetic';
  x.fillStyle = o.ink;
  x.font = `700 ${120 * u}px ${o.font}`;
  x.fillText(o.title, left, y);
  y += 80 * u;
  x.fillStyle = o.dim;
  x.font = `500 ${52 * u}px ${o.font}`;
  x.fillText(o.subtitle, left, y);
  y += 90 * u;

  // Legend, wrapped to the poster width.
  x.font = `500 ${44 * u}px ${o.font}`;
  let lx = left;
  const maxX = W - left;
  for (const it of o.legend) {
    const sw = 56 * u, gap = 18 * u, after = 56 * u;
    const w = sw + gap + x.measureText(it.label).width + after;
    if (lx + w > maxX && lx > left) { lx = left; y += 70 * u; }
    x.fillStyle = it.color;
    if (it.kind === 'line') x.fillRect(lx, y - 20 * u, sw, 8 * u);
    else x.fillRect(lx, y - 34 * u, sw, 36 * u);
    x.fillStyle = o.ink;
    x.fillText(it.label, lx + sw + gap, y);
    lx += w;
  }
  y += 100 * u;

  x.fillStyle = o.ink;
  x.font = `600 ${46 * u}px ${o.font}`;
  x.fillText(o.stats, left, y);

  x.fillStyle = o.dim;
  x.font = `400 ${34 * u}px ${o.font}`;
  x.fillText(o.credits, left, H - 90 * u);

  return new Promise((resolve, reject) => cv.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'));
}
