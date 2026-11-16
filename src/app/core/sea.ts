import { Injectable, signal } from '@angular/core';

/** The seas whose drainage basins the app can show (data: src/assets/data/<id>.json). */
export type SeaId = 'baltic' | 'north' | 'black' | 'med' | 'caspian';

/** Picker order: the home sea first, then west to east. */
export const SEA_IDS: SeaId[] = ['baltic', 'north', 'med', 'black', 'caspian'];

export const isSeaId = (v: unknown): v is SeaId => SEA_IDS.includes(v as SeaId);

const STORAGE_KEY = 'watershed.sea';

/**
 * The chosen sea. Resolved from the link (`?sea=`), then the last choice (localStorage), else
 * unknown — and then the sea picker opens before anything is downloaded: each sea's data is
 * fetched only once it is chosen.
 */
@Injectable({ providedIn: 'root' })
export class SeaService {
  readonly sea = signal<SeaId | null>(this.initial());
  /** The picker is shown at entry (no sea known yet) and whenever the user asks to change sea. */
  readonly pickerOpen = signal<boolean>(this.sea() === null);

  choose(sea: SeaId) {
    this.sea.set(sea);
    this.pickerOpen.set(false);
    try {
      localStorage.setItem(STORAGE_KEY, sea);
    } catch {
      // localStorage unavailable: the choice lasts for this visit
    }
  }

  private initial(): SeaId | null {
    if (typeof location !== 'undefined') {
      const fromLink = new URLSearchParams(location.search).get('sea');
      if (isSeaId(fromLink)) {
        // A link to a sea counts as choosing it: the next plain visit opens it too.
        try { localStorage.setItem(STORAGE_KEY, fromLink); } catch { /* unavailable */ }
        return fromLink;
      }
    }
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (isSeaId(stored)) return stored;
    } catch {
      // localStorage unavailable
    }
    return null;
  }
}
