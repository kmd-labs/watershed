let ctx: CanvasRenderingContext2D | null = null;

/**
 * Normalises any CSS colour (`rgb(222.5 …)`, `color-mix(…)`, named, hex) to `#rrggbb` using the
 * browser's own parser. Sass `color.mix()` can emit fractional channels, which THREE.Color does
 * not parse (it silently falls back to white).
 */
export function cssToHex(css: string, fallback = '#000000'): string {
  if (typeof document === 'undefined') return fallback;
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return fallback;
  ctx.fillStyle = fallback;
  ctx.fillStyle = css;
  const v = String(ctx.fillStyle);
  if (v.startsWith('#')) return v;
  const m = v.match(/[\d.]+/g);
  if (!m || m.length < 3) return fallback;
  return '#' + m.slice(0, 3).map(c => Math.round(+c).toString(16).padStart(2, '0')).join('');
}

/** `#rrggbb` → [r, g, b] in 0–255. */
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
