import { Injectable, signal } from '@angular/core';

/** The seas whose drainage basins the app can show (data: src/assets/data/<id>.json). */
export type SeaId = 'baltic' | 'north' | 'black' | 'med' | 'caspian';

/** Picker order: the home sea first, then west to east. */
export const SEA_IDS: SeaId[] = ['baltic', 'north', 'med', 'black', 'caspian'];

export const isSeaId = (v: unknown): v is SeaId => SEA_IDS.includes(v as SeaId);

const STORAGE_KEY = 'watershed.sea';

/** Where the entry opens: the choice of look first, or straight at the map of seas. */
export type EntryStep = 'look' | 'sea';

/**
 * The chosen sea. Every visit starts at the entry — pick a look, then a sea on the map of
 * Europe — before any map data is downloaded; only the chosen sea's data is then fetched. A link
 * to a sea (`?sea=`, e.g. a shared view) opens that sea directly.
 */
@Injectable({ providedIn: 'root' })
export class SeaService {
  readonly sea = signal<SeaId | null>(this.fromLink());
  /** The entry is shown at the start of a visit and whenever the user asks to change sea. */
  readonly pickerOpen = signal<boolean>(this.sea() === null);
  readonly entryStep = signal<EntryStep>('look');
  /** The sea of the last visit, marked on the entry map. */
  readonly last = signal<SeaId | null>(this.stored());

  /** Opens the entry at the map of seas (from the view menu or the panel title). */
  openPicker() {
    this.entryStep.set('sea');
    this.pickerOpen.set(true);
  }

  choose(sea: SeaId) {
    this.begin(sea);
    this.pickerOpen.set(false);
  }

  /** Starts the sea (its data begins to load) while the entry finishes its own animation. */
  begin(sea: SeaId) {
    this.sea.set(sea);
    this.last.set(sea);
    try {
      localStorage.setItem(STORAGE_KEY, sea);
    } catch {
      // localStorage unavailable
    }
  }

  private fromLink(): SeaId | null {
    if (typeof location === 'undefined') return null;
    const s = new URLSearchParams(location.search).get('sea');
    return isSeaId(s) ? s : null;
  }

  private stored(): SeaId | null {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      return isSeaId(s) ? s : null;
    } catch {
      return null;
    }
  }
}
