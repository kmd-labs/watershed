/** Everything the poster maker lets the user choose (also carried by `?view=poster` links). */

/** Paper and river colours: white with black ink or pastels; black with white, vivid or neon rivers. */
export type PosterPalette = 'white-ink' | 'white-pastel' | 'black-white' | 'black-vivid' | 'black-neon';
export const POSTER_PALETTES: PosterPalette[] = ['white-ink', 'white-pastel', 'black-white', 'black-vivid', 'black-neon'];

/** Coloured palettes colour each river by its basin (mosaic) or by the sea it ends in. */
export type PosterColourBy = 'basin' | 'sea';

/** ISO sheet sizes; all share the A2 layout (same proportions). */
export type PosterFormat = 'A4' | 'A3' | 'A2';
export const POSTER_FORMATS: Record<PosterFormat, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
  A2: { w: 420, h: 594 }
};

export interface PosterOptions {
  palette: PosterPalette;
  by: PosterColourBy;
  /** River basin the poster is about, or −1 for the whole Baltic drainage basin. */
  focus: number;
  format: PosterFormat;
  /** Figures row with numbered sources. */
  facts: boolean;
  seaNames: boolean;
  coords: boolean;
  /** Custom texts; null follows the area and the language. */
  title: string | null;
  subtitle: string | null;
  line: string | null;
}

export const DEFAULT_POSTER: PosterOptions = {
  palette: 'white-ink',
  by: 'basin',
  focus: -1,
  format: 'A2',
  facts: true,
  seaNames: true,
  coords: true,
  title: null,
  subtitle: null,
  line: null
};

export const isDarkPalette = (p: PosterPalette) => p.startsWith('black');

/** Token family of a palette's coloured rivers (`--color-<family>-<i>`, `-sea-<i>`), or null for one ink. */
export function colourFamily(p: PosterPalette): string | null {
  return p === 'white-pastel' ? 'print-pastel' : p === 'black-vivid' ? 'print-vivid' : p === 'black-neon' ? 'print-neon' : null;
}

/** Surface of the Baltic Sea (HELCOM), for the basin-to-sea ratio. */
export const BALTIC_SEA_KM2 = 415_266;
