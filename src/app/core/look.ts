import { Injectable, computed, inject, signal } from '@angular/core';
import { ThemeService } from '@kmd/design-system';

/**
 * The app's two looks: "White & Classy" (the design system's light theme) and "Midnight City
 * Neons" (its opt-in Midnight dark theme, tuned in src/styles.scss) — the default.
 */
export type Look = 'classic' | 'midnight';

export const LOOKS: Look[] = ['classic', 'midnight'];

/** `<app-slug>.theme`, as the design system asks; index.html reads it before the first paint. */
const STORAGE_KEY = 'watershed.theme';

@Injectable({ providedIn: 'root' })
export class LookService {
  private readonly theme = inject(ThemeService);

  readonly look = signal<Look>(this.initial());
  readonly midnight = computed(() => this.look() === 'midnight');

  constructor() {
    // index.html already set <html data-theme> before the first paint; this syncs the service.
    this.theme.setMode(this.look() === 'midnight' ? 'dark' : 'light');
  }

  set(look: Look) {
    if (look === this.look()) return;
    this.theme.setMode(look === 'midnight' ? 'dark' : 'light');
    this.look.set(look);
    try {
      localStorage.setItem(STORAGE_KEY, look === 'midnight' ? 'dark' : 'light');
    } catch {
      // localStorage unavailable: the look lasts for this visit
    }
  }

  private initial(): Look {
    try {
      if (localStorage.getItem(STORAGE_KEY) === 'light') return 'classic';
    } catch {
      // localStorage unavailable
    }
    return 'midnight';
  }
}
