import { Component, ElementRef, afterNextRender, computed, inject, viewChild } from '@angular/core';
import { LucideAngularModule, X } from 'lucide-angular';
import { I18nService } from '../core/i18n/i18n.service';
import { SEA_IDS, SeaId, SeaService } from '../core/sea';
import { SEA_THUMBS } from './sea-thumbs';

/**
 * Sea picker: the five drainage basins as silhouettes with their headline numbers. Shown at the
 * first visit — before any map data is downloaded — and whenever the user asks to change sea.
 * Only the chosen sea's data is then fetched (BalticDataService.load).
 */
@Component({
  selector: 'app-sea-picker',
  standalone: true,
  imports: [LucideAngularModule],
  templateUrl: './sea-picker.component.html',
  styleUrl: './sea-picker.component.scss',
  host: { '(document:keydown.escape)': 'close()' }
})
export class SeaPickerComponent {
  readonly i18n = inject(I18nService);
  readonly seas = inject(SeaService);
  readonly closeIcon = X;
  private readonly dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');

  /** Closing is possible once a sea is on screen; at the first visit a choice is needed. */
  readonly closable = computed(() => this.seas.sea() !== null);

  readonly cards = computed(() => {
    const t = this.i18n.t();
    return SEA_IDS.map(id => {
      const th = SEA_THUMBS[id];
      return {
        id,
        name: t.seaNames[id],
        thumb: th,
        stats: t.pickerStats(this.i18n.area(th.area), this.i18n.num(th.mouths)),
        people: th.pop ? t.pickerPeople(t.millionPeople(this.i18n.num(th.pop / 1e6))) : '',
        current: this.seas.sea() === id
      };
    });
  });

  constructor() {
    // Focus the dialog so keyboard users start inside it.
    afterNextRender(() => this.dialog().nativeElement.focus());
  }

  choose(id: SeaId) {
    if (this.seas.sea() === id) this.seas.pickerOpen.set(false);
    else this.seas.choose(id);
  }

  close() {
    if (this.closable()) this.seas.pickerOpen.set(false);
  }
}
