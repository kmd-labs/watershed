/** Primary map modes offered by the top-right view switcher. */
export type MapView = 'catchments' | 'seas' | 'mosaic';

/** Number of sea sub-basins in the dataset (Bothnian Bay … Danish Straits & Kattegat). */
export const SUB_COUNT = 6;

/** Theme token (`--color-sub-<i>`, src/styles.scss) for the sea sub-basin with the given id. */
export const subToken = (sub: number) => `sub-${sub}`;

/** Size of the "Basin mosaic" palette (`--color-mosaic-<i>`, src/styles.scss). */
export const MOSAIC_COUNT = 12;

/** Theme token for a mosaic palette slot. */
export const mosaicToken = (slot: number) => `mosaic-${slot}`;
