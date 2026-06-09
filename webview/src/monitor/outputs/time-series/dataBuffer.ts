import type uPlot from "uplot";
import type {
  TimeSeriesLineOutputConfig,
  TimeSeriesSample,
  TimeSeriesWindowConfig,
} from "../../../../../src/shared/protocol";
import {
  defaultDurationSeconds,
  defaultMaxPlotPoints,
  defaultVisiblePlotPoints,
} from "./constants";
import { pickConfiguredValues } from "./seriesConfig";
import { positiveNumberOrDefault } from "./scales";
import type { PlotWindowConfig } from "../types";

export interface AppendSamplesResult {
  discoveredChannelNames: string[];
}

export class TimeSeriesDataBuffer {
  readonly timeValues: number[] = [];
  readonly seriesData = new Map<string, Array<number | null>>();

  constructor(private readonly config: TimeSeriesLineOutputConfig) {}

  initializeConfiguredSeries(): string[] {
    const initializedChannelNames: string[] = [];

    for (const channelName of Object.keys(this.config.series)) {
      if (!this.seriesData.has(channelName)) {
        this.seriesData.set(channelName, []);
        initializedChannelNames.push(channelName);
      }
    }

    return initializedChannelNames;
  }

  appendSamples(samples: readonly TimeSeriesSample[]): AppendSamplesResult {
    const isAutoSeries = Object.keys(this.config.series).length === 0;
    const discoveredChannelNames: string[] = [];

    for (const sample of samples) {
      const sampleValues = isAutoSeries
        ? sample.values
        : pickConfiguredValues(sample.values, this.config);

      for (const channelName of Object.keys(sampleValues)) {
        if (!this.seriesData.has(channelName)) {
          this.seriesData.set(
            channelName,
            Array.from({ length: this.timeValues.length }, () => null),
          );
          discoveredChannelNames.push(channelName);
        }
      }

      this.timeValues.push(sample.time);

      for (const [channelName, values] of this.seriesData.entries()) {
        const value = sampleValues[channelName];
        values.push(typeof value === "number" && Number.isFinite(value) ? value : null);
      }
    }

    this.trimPlotData();

    return { discoveredChannelNames };
  }

  clear(): void {
    this.timeValues.length = 0;
    this.seriesData.clear();
  }

  getChannelNames(): string[] {
    return [...this.seriesData.keys()];
  }

  getPlotData(): uPlot.AlignedData {
    return [this.timeValues, ...this.seriesData.values()];
  }

  getLatestTime(): number | undefined {
    return this.timeValues.at(-1);
  }

  getXWindowRange(): { min?: number; max?: number } {
    const latestTime = this.getLatestTime();

    if (latestTime === undefined) {
      return {};
    }

    const windowConfig = this.getWindowConfig();

    if (windowConfig.mode === "duration") {
      return {
        min: latestTime - windowConfig.seconds,
        max: latestTime,
      };
    }

    const max = latestTime;
    const visiblePointCount = Math.min(windowConfig.maxPoints, defaultVisiblePlotPoints);
    const min = latestTime - this.getPointWindowSpan(visiblePointCount);

    if (min === max) {
      return {
        min: min - 0.5,
        max: max + 0.5,
      };
    }

    return { min, max };
  }

  private trimPlotData(): void {
    const windowConfig = this.getWindowConfig();

    if (windowConfig.mode === "points") {
      this.trimPlotDataByPoints(windowConfig.maxPoints);
    } else {
      this.trimPlotDataByDuration(windowConfig.seconds);
    }
  }

  private trimPlotDataByPoints(maxPoints: number): void {
    if (this.timeValues.length <= maxPoints) {
      return;
    }

    this.removeLeadingPlotPoints(this.timeValues.length - maxPoints);
  }

  private trimPlotDataByDuration(seconds: number): void {
    const latestTime = this.getLatestTime();

    if (latestTime === undefined) {
      return;
    }

    const minTime = latestTime - seconds;
    const removeCount = this.timeValues.findIndex((time) => time >= minTime);

    if (removeCount <= 0) {
      return;
    }

    this.removeLeadingPlotPoints(removeCount);
  }

  private removeLeadingPlotPoints(removeCount: number): void {
    this.timeValues.splice(0, removeCount);

    for (const values of this.seriesData.values()) {
      values.splice(0, removeCount);
    }
  }

  private getWindowConfig(): PlotWindowConfig {
    const windowConfig: TimeSeriesWindowConfig | undefined = this.config.window;

    if (windowConfig?.mode === "duration") {
      return {
        mode: "duration",
        seconds: positiveNumberOrDefault(windowConfig.seconds, defaultDurationSeconds),
      };
    }

    return {
      mode: "points",
      maxPoints: positiveNumberOrDefault(windowConfig?.maxPoints, defaultMaxPlotPoints),
    };
  }

  private getPointWindowSpan(maxPoints: number): number {
    return Math.max(1, maxPoints - 1) * this.getPointWindowStep();
  }

  private getPointWindowStep(): number {
    if (this.config.time.source === "sequence") {
      return 1;
    }

    if (this.config.time.source === "fixedInterval") {
      return this.config.time.intervalMs / 1000;
    }

    for (let index = this.timeValues.length - 1; index > 0; index -= 1) {
      const current = this.timeValues[index];
      const previous = this.timeValues[index - 1];

      if (current === undefined || previous === undefined) {
        continue;
      }

      const delta = current - previous;

      if (Number.isFinite(delta) && delta > 0) {
        return delta;
      }
    }

    return 1;
  }
}
