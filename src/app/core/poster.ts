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
export async function composePoster(map: HTMLCanvasElement, o: PosterOptions): Promise<Blob> {
  await document.fonts?.ready;
  const W = o.width, H = o.height;
  const u = W / 3000; // layout unit: 1 px at 3000 px width
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d')!;
  x.fillStyle = o.background;
  x.fillRect(0, 0, W, H);
  const mapH = Math.round((map.height * W) / map.width);
  x.drawImage(map, 0, 0, W, mapH);

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
