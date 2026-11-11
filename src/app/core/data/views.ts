/**
 * Primary map modes offered by the top-right view switcher. The two guided tours are views of
 * their own: "top" (the 20 largest river basins) runs on the catchments map, "story" (where the
 * rivers end, sea by sea) on its own river colouring and closes onto the sea sub-basins.
 * "poster" is the poster maker (src/app/poster).
 */
export type MapView = 'top' | 'catchments' | 'story' | 'seas' | 'mosaic' | 'raindrop' | 'poster';

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

/** "Where the rivers end": river colour per sea (`--color-sea-<i>` / `--color-sea-dark-<i>`). */
export const seaToken = (sub: number, ground: MosaicGround = 'light') => (ground === 'dark' ? `sea-dark-${sub}` : `sea-${sub}`);

/** Steps of the "Where the rivers end" presentation: intro, one per sea, finale. */
export const STORY_STEPS = SUB_COUNT + 2;
