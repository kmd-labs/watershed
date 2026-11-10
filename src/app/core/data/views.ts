/** Primary map modes offered by the top-right view switcher. */
export type MapView = 'catchments' | 'seas' | 'mosaic' | 'raindrop';

/** Ground of the "Basin mosaic" view: white (prints, light pages) or black (the classic look). */
export type MosaicGround = 'light' | 'dark';

/** Number of sea sub-basins in the dataset (Bothnian Bay … Danish Straits & Kattegat). */
export const SUB_COUNT = 6;

/** Theme token (`--color-sub-<i>`, src/styles.scss) for the sea sub-basin with the given id. */
export const subToken = (sub: number) => `sub-${sub}`;

/** Size of the "Basin mosaic" palette (`--color-mosaic-<i>` / `--color-mosaic-dark-<i>`). */
export const MOSAIC_COUNT = 16;

/** Theme token for a mosaic palette slot; the dark ground uses lighter shades of the same hues. */
export const mosaicToken = (slot: number, ground: MosaicGround = 'light') => (ground === 'dark' ? `mosaic-dark-${slot}` : `mosaic-${slot}`);
