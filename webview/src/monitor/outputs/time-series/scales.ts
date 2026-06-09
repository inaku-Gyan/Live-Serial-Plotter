import type uPlot from "uplot";

const minXAxisTickSpace = 22;
const maxXAxisTickSpace = 72;
const targetXAxisTickDivisions = 6;
const minYAxisTickSpace = 18;
const maxYAxisTickSpace = 44;
const targetYAxisTickDivisions = 8;

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

export function positiveNumberOrDefault(value: number | undefined, defaultValue: number): number {
  return typeof value === "number" && value > 0 ? value : defaultValue;
}

export function hasScaleRange(range: {
  min?: number;
  max?: number;
}): range is { min: number; max: number } {
  return typeof range.min === "number" && typeof range.max === "number";
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
