import { MapView, MosaicGround } from './data/views';

export const APP_CANONICAL_URL = 'https://kmd-labs.github.io/watershed/';

/** The view a plain link opens: "Where the rivers end", the sea-by-sea tour. */
export const START_VIEW: MapView = 'story';

const VIEWS: MapView[] = ['top', 'catchments', 'story', 'seas', 'mosaic', 'raindrop'];

/**
 * Everything a link can carry: `?view=mosaic&ground=dark`, `?view=catchments&basin=412`,
 * `?step=3` ("Where the rivers end", the start view), `?view=top&step=5`, `?view=raindrop&drop=22.6,50.2`.
 * Defaults are left out so the plain URL stays clean. Links from before the top 20 became a view
 * of its own (`?top=5`, `?top=off`, `?basin=412`) still open what they used to.
 */
export interface LinkState {
  view: MapView;
  ground: MosaicGround;
  /** Selected river basin id, or −1. */
  basin: number;
  /** Step of the running tour (top 20 or "Where the rivers end"). */
  step: number;
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
  if (!out.view) {
    const top = p.get('top');
    const topStep = int(top, 0, 50);
    if (top === 'off' || out.basin !== undefined) out.view = 'catchments';
    else if (topStep !== null) { out.view = 'top'; out.step = topStep; }
  }
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
  if (s.view !== START_VIEW) p.set('view', s.view);
  if ((s.view === 'mosaic' || s.view === 'story') && s.ground === 'dark') p.set('ground', 'dark');
  if ((s.view === 'catchments' || s.view === 'seas' || s.view === 'mosaic') && s.basin >= 0) p.set('basin', String(s.basin));
  if ((s.view === 'top' || s.view === 'story') && s.step > 0) p.set('step', String(s.step));
  if (s.view === 'raindrop' && s.drop) p.set('drop', `${s.drop[0].toFixed(3)},${s.drop[1].toFixed(3)}`);
  return url;
}

/** A shareable link to `s` in `lang`, on the public address. */
export function shareUrl(s: LinkState, lang: string): string {
  const url = writeLink(new URL(APP_CANONICAL_URL), s);
  url.searchParams.set('lang', lang);
  return url.toString();
}
