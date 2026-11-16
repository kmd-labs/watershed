import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Dict, Lang, SeaOverlay } from './i18n.types';
import { EN } from './en';
import { PL } from './pl';
import { SEAS_EN } from './seas.en';
import { SEAS_PL } from './seas.pl';
import { SeaId, SeaService } from '../sea';

const DICTS: Record<Lang, Dict> = { en: EN, pl: PL };
/** Per-sea texts laid over the base dictionary (which is the Baltic's). */
const SEA_OVERLAYS: Record<Lang, Partial<Record<SeaId, SeaOverlay>>> = { en: SEAS_EN, pl: SEAS_PL };
const STORAGE_KEY = 'watershed.lang';

/**
 * Manages UI language and localized texts.
 * Resolves initial language from localStorage ('watershed.lang') or Navigator API,
 * falling back to 'en', and persists selection to localStorage.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly dicts = DICTS;
  readonly langs: Lang[] = ['en', 'pl'];
  private readonly seas = inject(SeaService);
  readonly lang = signal<Lang>(this.resolveInitialLang());
  /** The current language's texts for the current sea. */
  readonly t = computed(() => {
    const base = DICTS[this.lang()];
    const sea = this.seas.sea();
    const overlay = sea ? SEA_OVERLAYS[this.lang()][sea] : undefined;
    return overlay ? { ...base, ...overlay(base) } : base;
  });
  /** English names of the loaded sea's rivers and countries (its data names them in Polish). */
  readonly dataNames = signal<{ rivers: Record<string, string>; countries: Record<string, string> } | null>(null);

  constructor() {
    effect(() => {
      const currentLang = this.lang();
      const d = this.t();
      if (typeof document !== 'undefined') {
        document.documentElement.lang = d.htmlLang;
        document.title = d.docTitle;
      }
      this.persistLang(currentLang);
    });
  }

  setLang(lang: Lang) {
    this.lang.set(lang);
  }

  /** Localized river name (dataset names are Polish exonyms). */
  river(name: string): string {
    return this.t().riverNames[name] ?? (this.lang() === 'en' ? this.dataNames()?.rivers[name] : undefined) ?? name;
  }

  country(name: string): string {
    return this.t().countries[name] ?? (this.lang() === 'en' ? this.dataNames()?.countries[name] : undefined) ?? name;
  }

  num(v: number, digits = 0): string {
    return v.toLocaleString(this.t().numberLocale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  /** Area: "1.75 million km²" / "192,632 km²" / "48.3 km²". */
  area(km2: number): string {
    const t = this.t();
    if (km2 >= 1_000_000) return `${this.num(km2 / 1_000_000, 2)} ${t.millionKm2}`;
    return `${this.num(km2, km2 < 100 ? 1 : 0)} ${t.areaUnit}`;
  }

  /** Discharge in m³/s with precision that suits the magnitude. */
  flow(m3s: number): string {
    return `${this.num(m3s, m3s < 10 ? 1 : 0)} ${this.t().flowUnit}`;
  }

  private resolveInitialLang(): Lang {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (this.isSupportedLang(stored)) {
        return stored;
      }
    } catch {
      // localStorage unavailable
    }

    if (typeof navigator !== 'undefined') {
      const candidates = [
        ...(Array.isArray(navigator.languages) ? navigator.languages : []),
        navigator.language
      ].filter(Boolean);

      for (const candidate of candidates) {
        const prefix = candidate.slice(0, 2).toLowerCase();
        if (this.isSupportedLang(prefix)) {
          return prefix;
        }
      }
    }

    return 'en';
  }

  private isSupportedLang(val: string | null | undefined): val is Lang {
    return val === 'en' || val === 'pl';
  }

  private persistLang(lang: Lang) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // localStorage unavailable
    }
  }
}
