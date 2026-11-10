# KMD Engineering & Design System Practices (`AGENTS.md`)

This document defines the mandatory UI, architectural, and engineering conventions for all **KMD (`kmd-labs`)** interactive visualization applications. Every human contributor and AI coding agent MUST follow these rules.

---

## 1. Core Philosophy: Zero Friction, Visualization First

- **Immediate Immersion:** The interactive visualization (3D globe, canvas, simulation, or chart) occupies `100vw × 100vh` and is immediately interactive upon page load.
- **No Settings Bloat:** Never add settings modals, preferences drawers, theme switchers, or onboarding popups that block or distract from the visualization.
- **Single Light Theme:** KMD applications use a single, cohesive **Light Theme** defined in `_variables.scss` (`neutral-50` `#f5f7fb` airy background with frosted glass panels).
  - Do **not** implement dark mode, light/dark toggle buttons, or theme persistence in `localStorage`.
  - Canvas/WebGL renderers read design tokens at runtime via `ThemeService.getTokenColor(token)` from `:root` CSS custom properties (`--color-*`).
- **Unified Typography (`Inter`):** All UI elements and `<canvas>` 2D/3D text labels use a single font family (`$font-family: "Inter", sans-serif;` emitted as `--font-family` on `:root`). Canvas renderers must use `ThemeService.getFontFamily()` instead of hardcoding system font stacks like `"Segoe UI"`.
  - The splash uses the official `assets/design-system/logo/kmd-black-orange.svg` logotype with a left-to-right clip reveal. Numeric readouts use the monospaced face (`$font-family-mono`, emitted as `--font-family-mono`); all other text remains Inter.

---

## 2. Canonical Viewport Layout

Every KMD visualization app follows a strict three-zone HUD floating over the full-screen visualization:

1. **Top-Left — Brand Logotype & Language Selector (`.header__left`):**
   - **Brand Pill (`.header__brand.glass-panel` / `<app-brand>`):** Displays the official `KMD` SVG logotype (`assets/design-system/logo/kmd-black-orange.svg` — black wordmark with `#D37400` orange accent dot) separated by a `1px` vertical divider from the interactive collaboration callout (`[Handshake] Open to new projects` / `t.about.cta`). On hover (and tap on mobile portrait), the brand pill expands smoothly. Clicking opens the official KMD Labs About modal (`AboutModalComponent` / `AboutService`) featuring team credentials, direct contact button (`hello@kmd-labs.org`), and a link to the main website (`kmd-labs.org`). On `mobile` portrait, it collapses in place to save viewport space.
   - **Language Pill (`.header__settings.glass-panel`):** Contains **only** the compact language `app-dropdown` (`EN`, `PL`, `ES`). No theme buttons or extra settings icons.
2. **Top-Right — View Switcher (`.header__right`):**
   - **View Pill (`.header__view.glass-panel`):** Contains a single right-aligned `app-dropdown` (`align="right"`) that switches between the app's primary visualization modes/views.
3. **Bottom Dock — Application Logic, Sliders & Glossaries (`.dock-wrap`):**
   - All simulation controls, timeline/parameter sliders (`app-timeline-slider`), play/pause buttons, layer toggles, color-scale legends, and glossary triggers (`PopupService`) live in floating glassmorphic panels anchored to the **bottom** of the viewport.

---

## 3. Responsive Breakpoints (Single Source of Truth)

Breakpoints are defined **once** in `_variables.scss` and emitted as `:root` CSS custom properties (`--bp-mobile`, `--bp-tablet`, `--bp-desktop`):

| Token | Max-Width | Usage |
| :--- | :--- | :--- |
| `mobile` | `640px` | Compact single-column dock, icon-only controls, hidden app subtitle in brand pill |
| `tablet` | `960px` | Narrower view switcher and stacked dock panels |
| `desktop` | `1280px` | Full multi-panel bottom dock layout |

- **In SCSS:** Always use `@include respond-to("mobile")`, `@include respond-to("tablet")`, or `@include respond-to("desktop")`. Never hardcode `@media (max-width: ...)` pixel values.
- **In TypeScript / Templates:** Always inject `BreakpointService` (`bp.mobile()`, `bp.tablet()`, `bp.desktop()`) or use `isAtMost()` from `@kmd/design-system/utils/breakpoints`.

---

## 4. Internationalization (`I18nService`) & `localStorage` Persistence

- **Mandatory Internationalization (Zero Hardcoded Strings):**
  - Every user-facing string in Angular templates (`.html`), TypeScript components (`.ts`), popups/glossaries, tooltips, ARIA labels, and `<canvas>` / WebGL 2D/3D text labels **must** be resolved through `I18nService` (`i18n.t()`).
  - Never hardcode English or Polish strings directly inside components, services, or canvas renderers.
- **Modular Type-Safe Dictionaries (`src/app/core/i18n/`):**
  - `i18n.types.ts` — defines `Lang` (`'en' | 'pl'`, plus any optional additional locales such as `'es'`) and the `Dict` interface. Always add new translation keys to `Dict` first so TypeScript enforces completeness across every language file.
  - `en.ts` (`EN: Dict`) & `pl.ts` (`PL: Dict`) — every scaffolded KMD app ships with English (`en.ts`) and Polish (`pl.ts`) dictionary files. Whenever you add or modify any UI text, label, or glossary entry, you **must** update both `en.ts` and `pl.ts` simultaneously.
  - `i18n.service.ts` — exposes reactive `lang = signal<Lang>(...)` and `t = computed(() => DICTS[this.lang()])` signals.
- **Zero-Friction Detection & `localStorage` Persistence:**
  - On startup, initial language is resolved in this exact order:
    1. `localStorage` (`<app-slug>.lang`, e.g., `el-nino.lang`) if a supported `Lang` was previously saved.
    2. Browser `navigator.languages` / `navigator.language` prefix match (`en`, `pl`, etc.).
    3. Fallback to `'en'`.
  - **Persistence to `localStorage`:** Whenever the user selects a language from the top-left dropdown (`i18n.setLang(lang)`), an Angular `effect()` automatically updates `document.documentElement.lang`, `document.title`, and persists the selected language to `localStorage.setItem('<app-slug>.lang', lang)`.

---

## 5. Design System Architecture (`@kmd/design-system`)

Shared styles, UI primitives, and core utilities live in the [`kmd-labs/design-system`](https://github.com/kmd-labs/design-system) repository and are projected into each app via a **Git Submodule** at `src/design-system`:

- **SCSS Design Tokens:** `src/design-system/_variables.scss` (imported via `@use "variables" as *;` configured in `angular.json` `stylePreprocessorOptions.includePaths`).
- **UI Components (`@kmd/design-system/ui/*`):**
  - `BrandComponent` (`app-brand`) — standardized KMD brand logotype with interactive "Open to new projects" hover expansion and modal trigger.
  - `ButtonComponent` (`app-button`) — unified `32px` control height (`$control-height`), pill radius.
  - `DropdownComponent` (`app-dropdown`) — accessible floating menu with icon/badge support.
  - `PopupComponent` & `PopupService` (`app-popup`) — modal dialogs for glossaries and deep-dive data.
  - `TooltipComponent`, `TooltipDirective`, & `TooltipService` (`[appTooltip]`).
  - `BadgeComponent` (`app-badge`) — semantic status and phase pills.
  - `SplashComponent` & `SplashService` (`app-splash`) — full-screen KMD loader with the official SVG logotype, progress bar, and reactive state management.
  - `AboutModalComponent` & `AboutService` (`app-about-modal`) — shared KMD Labs team and story modal dialog with direct contact and main website links.
  - `TimelineSliderComponent` (`app-timeline-slider`) — interactive range slider with preset markers.
- **Core Services & Utils (`@kmd/design-system/services/*`, `@kmd/design-system/utils/*`):**
  - `BreakpointService` & `breakpoints.ts`
  - `ThemeService` (stateless CSS `--color-*` token reader for WebGL/Canvas).
  - `SeoService`, `provisionFavicon()`, & `provideKmdFavicon()` (canonical URL, hreflang alternates, OpenGraph meta tags, Twitter Cards, and automatic orange circle favicon provisioning).
- **Shared Assets (`@kmd/design-system/assets/*`):**
  - `favicon.svg` & `favicon.ico` — official KMD orange circle `#D37400` favicon (provisioned automatically at app start).
  - `og-image.png` (`assets/design-system/og-image.png`) — standardized 1200×630 repository-agnostic social media preview card.
