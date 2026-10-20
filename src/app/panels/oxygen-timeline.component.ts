import { Component, OnDestroy, computed, inject, input, output, signal } from '@angular/core';
import { LucideAngularModule, Pause, Play } from 'lucide-angular';
import { ButtonComponent, TimelineMarker, TimelineSliderComponent } from '@kmd/design-system';
import { I18nService } from '../core/i18n/i18n.service';
import { OXYGEN_BASELINE, OXYGEN_CHANGE_TOKENS, OXYGEN_TOKENS, OxygenSeries } from '../core/data/sea-layers';

export type OxygenMode = 'state' | 'change';

/** The two largest recent Major Baltic Inflows, which temporarily re-oxygenated the deep basins. */
const INFLOWS = [1993, 2014];

const W = 320, H = 76, PAD_L = 4, PAD_R = 4, PAD_T = 6, PAD_B = 14;

/** Year scrubber, state/change switch and area-over-time chart for the dead-zone layer. */
@Component({
  selector: 'app-oxygen-timeline',
  standalone: true,
  imports: [LucideAngularModule, ButtonComponent, TimelineSliderComponent],
  templateUrl: './oxygen-timeline.component.html',
  styleUrl: './oxygen-timeline.component.scss'
})
export class OxygenTimelineComponent implements OnDestroy {
  readonly i18n = inject(I18nService);

  readonly series = input.required<OxygenSeries>();
  readonly year = input.required<number>();
  readonly mode = input<OxygenMode>('state');
  readonly yearChange = output<number>();
  readonly modeChange = output<OxygenMode>();

  readonly playing = signal(false);
  readonly playIcon = Play;
  readonly pauseIcon = Pause;
  readonly W = W;
  readonly H = H;
  private timer: ReturnType<typeof setInterval> | null = null;

  readonly first = computed(() => this.series().years[0]);
  readonly last = computed(() => this.series().years[this.series().years.length - 1]);
  readonly idx = computed(() => Math.max(0, this.series().years.indexOf(this.year())));

  readonly markers = computed<TimelineMarker[]>(() => {
    const t = this.i18n.t();
    return INFLOWS.map(y => ({ id: 'inflow' + y, value: y, label: t.oxygenInflow(y), active: this.year() === y }));
  });

  readonly colors = {
    hypoxic: `var(--color-${OXYGEN_TOKENS.hypoxic})`,
    anoxic: `var(--color-${OXYGEN_TOKENS.anoxic})`,
    persistent: `var(--color-${OXYGEN_CHANGE_TOKENS[1]})`,
    appeared: `var(--color-${OXYGEN_CHANGE_TOKENS[2]})`,
    recovered: `var(--color-${OXYGEN_CHANGE_TOKENS[3]})`
  };

  /** Rounded thousands of km² for labels. */
  kkm2(v: number): string {
    return this.i18n.num(v / 1000, v < 10_000 ? 1 : 0);
  }

  readonly stats = computed(() => {
    const s = this.series();
    const i = this.idx();
    return { hyp: this.kkm2(s.hypoxic[i]), anox: this.kkm2(s.anoxic[i]) };
  });

  readonly chart = computed(() => {
    const s = this.series();
    const n = s.years.length;
    const yMax = Math.ceil(Math.max(...s.hypoxic) / 20_000) * 20_000;
    const x = (i: number) => PAD_L + (i / (n - 1)) * (W - PAD_L - PAD_R);
    const y = (v: number) => PAD_T + (1 - v / yMax) * (H - PAD_T - PAD_B);
    const area = (vals: number[]) =>
      `M${x(0)},${y(0)} ` + vals.map((v, i) => `L${x(i)},${y(v)}`).join(' ') + ` L${x(n - 1)},${y(0)} Z`;
    const line = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
    const ticks = s.years.filter(yr => yr % 20 === 0 || yr === s.years[0]).map(yr => ({ x: x(s.years.indexOf(yr)), label: String(yr) }));
    const base = { x0: x(s.years.indexOf(OXYGEN_BASELINE.from)), x1: x(s.years.indexOf(OXYGEN_BASELINE.to)) };
    const t = this.i18n.t();
    const hits = s.years.map((yr, i) => ({
      year: yr,
      x: x(i) - (W - PAD_L - PAD_R) / (n - 1) / 2,
      w: (W - PAD_L - PAD_R) / (n - 1),
      title: t.oxygenChartPoint(yr, this.kkm2(s.hypoxic[i]), this.kkm2(s.anoxic[i]))
    }));
    return {
      hypArea: area(s.hypoxic),
      hypLine: line(s.hypoxic),
      anoxArea: area(s.anoxic),
      anoxLine: line(s.anoxic),
      cursorX: x(this.idx()),
      yMaxLabel: `${this.kkm2(yMax)} ${t.thousandKm2}`,
      yTop: y(yMax),
      yBase: y(0),
      ticks,
      base,
      hits
    };
  });

  togglePlay() {
    if (this.playing()) {
      this.stop();
      return;
    }
    const s = this.series();
    if (this.year() >= this.last()) this.yearChange.emit(this.first());
    this.playing.set(true);
    this.timer = setInterval(() => {
      const i = s.years.indexOf(this.year());
      if (i < 0 || i >= s.years.length - 1) {
        this.stop();
        return;
      }
      this.yearChange.emit(s.years[i + 1]);
    }, 280);
  }

  onSlider(v: number) {
    this.stop();
    this.yearChange.emit(Math.round(v));
  }

  pickYear(y: number) {
    this.stop();
    this.yearChange.emit(y);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.playing.set(false);
  }

  ngOnDestroy() {
    this.stop();
  }
}
