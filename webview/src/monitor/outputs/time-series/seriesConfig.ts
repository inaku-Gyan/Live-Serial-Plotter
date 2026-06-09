import type { TimeSeriesLineOutputConfig } from "../../../../../src/shared/protocol";
import { defaultValueUnit, seriesColors } from "./constants";

export interface UnitGroup {
  unit: string;
  channelNames: string[];
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

export function getSeriesLabel(config: TimeSeriesLineOutputConfig, channelName: string): string {
  const series = config.series[channelName];
  const unit = series?.unit;
  const label = series?.label ?? channelName;
  return unit === undefined ? label : `${label} (${unit})`;
}

export function getSeriesColor(
  config: TimeSeriesLineOutputConfig,
  channelName: string,
  index: number,
): string {
  return (
    config.series[channelName]?.color ??
    seriesColors[index % seriesColors.length] ??
    seriesColors[0]
  );
}

export function getSeriesWidth(config: TimeSeriesLineOutputConfig, channelName: string): number {
  return config.series[channelName]?.line?.width ?? 2;
}

export function getSeriesVisible(config: TimeSeriesLineOutputConfig, channelName: string): boolean {
  return config.series[channelName]?.visible ?? true;
}

export function getSeriesUnit(config: TimeSeriesLineOutputConfig, channelName: string): string {
  return config.series[channelName]?.unit ?? defaultValueUnit;
}

export function getUnitGroups(
  config: TimeSeriesLineOutputConfig,
  channelNames: readonly string[],
): UnitGroup[] {
  const unitGroups: UnitGroup[] = [];

  for (const channelName of channelNames) {
    const unit = getSeriesUnit(config, channelName);
    const unitGroup = unitGroups.find((group) => group.unit === unit);

    if (unitGroup === undefined) {
      unitGroups.push({ unit, channelNames: [channelName] });
    } else {
      unitGroup.channelNames.push(channelName);
    }
  }

  return unitGroups.length === 0 ? [{ unit: defaultValueUnit, channelNames: [] }] : unitGroups;
}

export function getUnitGroupIndex(
  config: TimeSeriesLineOutputConfig,
  unitGroups: readonly UnitGroup[],
  channelName: string,
): number {
  return Math.max(
    0,
    unitGroups.findIndex((group) => group.unit === getSeriesUnit(config, channelName)),
  );
}

export function getTimeAxisLabel(config: TimeSeriesLineOutputConfig): string {
  if (config.time.source === "sequence") {
    return "Sequence";
  }

  return "Time (s)";
}

export function getYAxisLabel(config: TimeSeriesLineOutputConfig, unitGroup: UnitGroup): string {
  if (unitGroup.unit === defaultValueUnit) {
    return defaultValueUnit;
  }

  if (unitGroup.channelNames.length === 1) {
    const channelName = unitGroup.channelNames[0];
    const label =
      channelName === undefined
        ? unitGroup.unit
        : (config.series[channelName]?.label ?? channelName);
    return `${label} (${unitGroup.unit})`;
  }

  return unitGroup.unit;
}
