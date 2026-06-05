import type { PlotSample } from "../shared/protocol";

export class PointBatcher {
  private readonly pending: PlotSample[] = [];
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly flushIntervalMs: number,
    private readonly onFlush: (samples: PlotSample[]) => void,
  ) {}

  add(sample: PlotSample): void {
    this.pending.push(sample);

    if (this.timer === undefined) {
      this.timer = setTimeout(() => this.flush(), this.flushIntervalMs);
    }
  }

  flush(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    if (this.pending.length === 0) {
      return;
    }

    const samples = this.pending.splice(0, this.pending.length);
    this.onFlush(samples);
  }

  dispose(): void {
    this.flush();
  }
}
