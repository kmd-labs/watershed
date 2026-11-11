import { MapView, MosaicGround } from './data/views';

export const APP_CANONICAL_URL = 'https://kmd-labs.github.io/watershed/';

const VIEWS: MapView[] = ['catchments', 'seas', 'mosaic', 'raindrop', 'story'];

/**
 * Everything a link can carry: `?view=mosaic&ground=dark`, `?basin=412`, `?view=story&step=3`,
 * `?top=5` (top-20 step), `?top=off` (catchments without the top-20 card),
 * `?view=raindrop&drop=22.6,50.2`. Defaults are left out so the plain URL stays clean.
 */
export interface LinkState {
  view: MapView;
  ground: MosaicGround;
  /** Selected river basin id, or −1. */
  basin: number;
  /** "Where the rivers end" step. */
  step: number;
  /** Top-20 step in the catchments view, or null when the card is closed. */
  top: number | null;
  drop: [number, number] | null;
}

const int = (v: string | null, min: number, max: number) => {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/** Reads whatever a URL's query says about the map; absent or invalid parts are left out. */
export function readLink(search: string): Partial<LinkState> & { lang?: string } {
  const p = new URLSearchParams(search);
  const out: Partial<LinkState> & { lang?: string } = {};
  const view = p.get('view')?.toLowerCase() as MapView | undefined;
  if (view && VIEWS.includes(view)) out.view = view;
  if (p.get('ground') === 'dark') out.ground = 'dark';
  const basin = int(p.get('basin'), 0, 100_000);
  if (basin !== null) out.basin = basin;
  const step = int(p.get('step'), 0, 50);
  if (step !== null) out.step = step;
  const top = p.get('top');
  if (top === 'off') out.top = null;
  else if (int(top, 0, 50) !== null) out.top = int(top, 0, 50);
  const drop = p.get('drop')?.split(',').map(Number);
  if (drop?.length === 2 && drop.every(Number.isFinite) && Math.abs(drop[0]) <= 180 && Math.abs(drop[1]) <= 90) out.drop = [drop[0], drop[1]];
  const lang = p.get('lang');
  if (lang) out.lang = lang;
  return out;
}

/** Writes the map state into `url`'s query (defaults removed, unrelated parameters kept). */
export function writeLink(url: URL, s: LinkState): URL {
  const p = url.searchParams;
  for (const k of ['view', 'ground', 'basin', 'step', 'top', 'drop']) p.delete(k);
  if (s.view !== 'catchments') p.set('view', s.view);
  if ((s.view === 'mosaic' || s.view === 'story') && s.ground === 'dark') p.set('ground', 'dark');
  if (s.view === 'catchments' || s.view === 'seas' || s.view === 'mosaic') {
    if (s.basin >= 0) p.set('basin', String(s.basin));
  }
  if (s.view === 'story' && s.step > 0) p.set('step', String(s.step));
  if (s.view === 'catchments') {
    if (s.top === null) { if (s.basin < 0) p.set('top', 'off'); }
    else if (s.top > 0) p.set('top', String(s.top));
  }
  if (s.view === 'raindrop' && s.drop) p.set('drop', `${s.drop[0].toFixed(3)},${s.drop[1].toFixed(3)}`);
  return url;
}

/** A shareable link to `s` in `lang`, on the public address. */
export function shareUrl(s: LinkState, lang: string): string {
  const url = writeLink(new URL(APP_CANONICAL_URL), s);
  url.searchParams.set('lang', lang);
  return url.toString();
}
