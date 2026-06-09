import type uPlot from "uplot";
import type { TimeSeriesLineOutputConfig } from "../../../src/shared/protocol";

export const defaultMaxPlotPoints = 3000;
export const defaultVisiblePlotPoints = 300;
export const defaultDurationSeconds = 30;
export const defaultValueUnit = "Value";
export const colors = ["#4cc9f0", "#f72585", "#ffd166", "#06d6a0", "#c77dff", "#f77f00", "#90be6d"];

const uPlotPathCacheKey = "_paths";
const minXAxisTickSpace = 22;
const maxXAxisTickSpace = 72;
const targetXAxisTickDivisions = 6;
const minYAxisTickSpace = 18;
const maxYAxisTickSpace = 44;
const targetYAxisTickDivisions = 8;

interface PathCachedSeries extends uPlot.Series {
  [uPlotPathCacheKey]?: unknown;
  points?: uPlot.Series.Points & {
    [uPlotPathCacheKey]?: unknown;
  };
}

export function invalidatePlotPaths(plot: uPlot): void {
  for (const series of plot.series.slice(1) as PathCachedSeries[]) {
    series[uPlotPathCacheKey] = null;

    if (series.points !== undefined) {
      series.points[uPlotPathCacheKey] = null;
    }
  }
}

export function pickConfiguredValues(
  values: Record<string, number>,
  config: TimeSeriesLineOutputConfig,
): Record<string, number> {
  const nextValues: Record<string, number> = {};

  for (const seriesName of Object.keys(config.series)) {
    const value = values[seriesName];

    if (typeof value === "number") {
      nextValues[seriesName] = value;
    }
  }

  return nextValues;
}

export function getUnitScaleKey(unitIndex: number): string {
  return `y${unitIndex + 1}`;
}

export function getXAxisTickSpace(
  _plot: uPlot,
  _axisIndex: number,
  _scaleMin: number,
  _scaleMax: number,
  plotDimension: number,
): number {
  return getDynamicAxisTickSpace(
    plotDimension,
    minXAxisTickSpace,
    maxXAxisTickSpace,
    targetXAxisTickDivisions,
  );
}

export function getYAxisTickSpace(
  _plot: uPlot,
  _axisIndex: number,
  _scaleMin: number,
  _scaleMax: number,
  plotDimension: number,
): number {
  return getDynamicAxisTickSpace(
    plotDimension,
    minYAxisTickSpace,
    maxYAxisTickSpace,
    targetYAxisTickDivisions,
  );
}

function getDynamicAxisTickSpace(
  plotDimension: number,
  minSpace: number,
  maxSpace: number,
  targetDivisions: number,
): number {
  if (!Number.isFinite(plotDimension) || plotDimension <= 0) {
    return minSpace;
  }

  return Math.min(maxSpace, Math.max(minSpace, plotDimension / targetDivisions));
}

export function positiveNumberOrDefault(value: number | undefined, defaultValue: number): number {
  return typeof value === "number" && value > 0 ? value : defaultValue;
}

export function hasScaleRange(range: {
  min?: number;
  max?: number;
}): range is { min: number; max: number } {
  return typeof range.min === "number" && typeof range.max === "number";
}
