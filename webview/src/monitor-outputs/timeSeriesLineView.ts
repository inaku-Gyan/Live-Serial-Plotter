import uPlot from "uplot";
import type {
  OutputLayoutConfig,
  OutputPacket,
  TimeSeriesLineOutputConfig,
  TimeSeriesSample,
  TimeSeriesViewLayoutConfig,
  TimeSeriesWindowConfig,
} from "../../../src/shared/protocol";
import {
  createTimeSeriesInteractionPlugins,
  defaultTimeSeriesInteractionConfig,
} from "../monitor/uplotInteractions";
import { appendPanelHeaderButton, createPanelHeader } from "./panelChrome";
import {
  colors,
  defaultDurationSeconds,
  defaultMaxPlotPoints,
  defaultValueUnit,
  defaultVisiblePlotPoints,
  getUnitScaleKey,
  getXAxisTickSpace,
  getYAxisTickSpace,
  hasScaleRange,
  invalidatePlotPaths,
  pickConfiguredValues,
  positiveNumberOrDefault,
} from "./timeSeriesPlotUtils";
import type {
  OutputView,
  PlotRebuildOptions,
  PlotScaleRanges,
  PlotWindowConfig,
  TimeSeriesFollowMode,
  UnitGroup,
} from "./types";

export class TimeSeriesLineView implements OutputView {
  readonly outputId: string;
  readonly kind = "timeSeriesLine" as const;

  private readonly timeValues: number[] = [];
  private readonly seriesData = new Map<string, Array<number | null>>();
  private readonly seriesVisibility = new Map<string, boolean>();
  private readonly chartElement: HTMLElement;
  private followButton: HTMLButtonElement | undefined;
  private readonly legendElement: HTMLElement;
  private readonly resizeObserver: ResizeObserver | undefined;
  private isAutoFollowEnabled = true;
  private isApplyingScaleUpdate = false;
  private followMode: TimeSeriesFollowMode = "unlocked";
  private lockedFollowResumeTimer: ReturnType<typeof setTimeout> | undefined;
  private shouldPreserveScaleWhileFollowing = false;
  private viewLayout: TimeSeriesViewLayoutConfig | undefined;
  private plot: uPlot | undefined;

  constructor(
    parent: HTMLElement,
    private readonly config: TimeSeriesLineOutputConfig,
    viewLayout: OutputLayoutConfig["view"] | undefined,
  ) {
    this.outputId = config.id;
    this.applyViewLayout(viewLayout);
    this.chartElement = document.createElement("div");
    this.chartElement.className = "output-chart";
    this.legendElement = document.createElement("div");
    this.legendElement.className = "output-legend";

    const header = createPanelHeader(config, "Time Series");
    this.followButton = appendPanelHeaderButton(
      header,
      "Follow",
      () => this.toggleFollowMode(),
      "output-follow-button",
    );
    appendPanelHeaderButton(header, "Reset", () => this.resetView(), "output-reset-button");
    this.updateFollowButton();

    parent.append(header, this.chartElement, this.legendElement);
    this.initializeConfiguredSeries();
    this.rebuildPlot();

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        this.plot?.setSize(this.getChartSize());
      });
      this.resizeObserver.observe(this.chartElement);
    }
  }

  appendPacket(packet: OutputPacket): void {
    if (packet.kind !== "timeSeriesAppend") {
      return;
    }

    this.appendSamples(packet.samples);
  }

  appendSamples(samples: readonly TimeSeriesSample[]): void {
    const isAutoSeries = Object.keys(this.config.series).length === 0;
    let needsRebuild = false;

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
          this.seriesVisibility.set(channelName, this.getSeriesVisible(channelName));
          needsRebuild = true;
        }
      }

      this.timeValues.push(sample.time);

      for (const [channelName, values] of this.seriesData.entries()) {
        const value = sampleValues[channelName];
        values.push(typeof value === "number" && Number.isFinite(value) ? value : null);
      }
    }

    this.trimPlotData();

    if (needsRebuild) {
      this.rebuildPlot({ applyViewDefaults: false });
      return;
    }

    this.updatePlotData();
  }

  clear(): void {
    this.clearLockedFollowResumeTimer();
    this.followMode = this.getDefaultFollowMode();
    this.isAutoFollowEnabled = this.getDefaultAutoFollow();
    this.shouldPreserveScaleWhileFollowing = false;
    this.timeValues.length = 0;
    this.seriesData.clear();
    this.seriesVisibility.clear();
    this.initializeConfiguredSeries();
    this.updateFollowButton();
    this.rebuildPlot();
  }

  dispose(): void {
    this.clearLockedFollowResumeTimer();
    this.resizeObserver?.disconnect();
    this.plot?.destroy();
    this.plot = undefined;
  }

  applyViewLayout(layout: OutputLayoutConfig["view"] | undefined): void {
    this.viewLayout = layout?.kind === "timeSeriesLine" ? layout : undefined;
    this.followMode = this.getDefaultFollowMode();
    this.isAutoFollowEnabled = this.getDefaultAutoFollow();
    this.shouldPreserveScaleWhileFollowing = false;
    this.updateFollowButton();
  }

  resetView(): void {
    this.applyViewLayout(this.viewLayout);
    for (const channelName of this.seriesData.keys()) {
      const visible = this.getSeriesVisible(channelName);
      this.seriesVisibility.set(channelName, visible);
    }
    this.applyViewDefaults();
    this.renderLegend([...this.seriesData.keys()]);
    this.syncSeriesVisibility();
    this.updateFollowButton();
  }

  resumeAutoFollow(): void {
    this.clearLockedFollowResumeTimer();
    this.followMode = "unlocked";
    this.isAutoFollowEnabled = true;
    this.shouldPreserveScaleWhileFollowing = true;
    this.applyAutoFollowRange(true);
    this.updateFollowButton();
  }

  captureViewLayout(): OutputLayoutConfig["view"] {
    return {
      kind: "timeSeriesLine",
      showLegend: !this.legendElement.hidden,
      autoFollow: this.isAutoFollowEnabled,
      followMode: this.followMode,
      zoom: this.captureZoom(),
    };
  }

  private initializeConfiguredSeries(): void {
    for (const channelName of Object.keys(this.config.series)) {
      this.seriesData.set(channelName, []);
      this.seriesVisibility.set(channelName, this.getSeriesVisible(channelName));
    }
  }

  private rebuildPlot(options: PlotRebuildOptions = { applyViewDefaults: true }): void {
    const runtimeScaleRanges = options.applyViewDefaults ? undefined : this.captureScaleRanges();
    this.plot?.destroy();

    const channelNames = [...this.seriesData.keys()];
    const unitGroups = this.getUnitGroups(channelNames);
    const scales: uPlot.Options["scales"] = {
      x: {
        time: false,
        ...this.getXWindowRange(),
      },
    };
    const axes: uPlot.Axis[] = [
      {
        label: this.getTimeAxisLabel(),
        space: getXAxisTickSpace,
        stroke: "var(--vscode-foreground)",
        grid: {
          stroke: "var(--vscode-panel-border)",
        },
      },
    ];

    for (const [index, unitGroup] of unitGroups.entries()) {
      const scaleKey = getUnitScaleKey(index);
      scales[scaleKey] = {};
      axes.push({
        label: this.getYAxisLabel(unitGroup),
        side: index === 0 ? 3 : 1,
        space: getYAxisTickSpace,
        stroke: "var(--vscode-foreground)",
        grid:
          index === 0
            ? {
                stroke: "var(--vscode-panel-border)",
              }
            : {
                show: false,
              },
      });
    }

    const series: uPlot.Series[] = [
      {},
      ...channelNames.map((channelName, index) => ({
        label: this.getSeriesLabel(channelName),
        stroke: this.getSeriesColor(channelName, index),
        width: this.getSeriesWidth(channelName),
        show: this.seriesVisibility.get(channelName) ?? this.getSeriesVisible(channelName),
        scale: getUnitScaleKey(this.getUnitGroupIndex(unitGroups, channelName)),
      })),
    ];

    this.plot = new uPlot(
      {
        ...this.getChartSize(),
        scales,
        axes,
        legend: {
          show: false,
        },
        cursor: defaultTimeSeriesInteractionConfig.cursor,
        plugins: createTimeSeriesInteractionPlugins({
          config: defaultTimeSeriesInteractionConfig,
          onScaleChanged: (scaleKey) => this.handlePlotScaleChanged(scaleKey),
          onUserInteraction: () => this.handlePlotUserInteraction(),
          onUserInteractionSettled: () => this.handlePlotUserInteractionSettled(),
          resetView: () => this.resetView(),
        }),
        series,
      },
      this.getPlotData(),
      this.chartElement,
    );

    this.renderLegend(channelNames);

    if (options.applyViewDefaults) {
      this.applyViewDefaults();
    } else {
      this.restoreRuntimeViewAfterRebuild(runtimeScaleRanges);
    }
  }

  private updatePlotData(): void {
    if (this.plot === undefined) {
      return;
    }

    this.isApplyingScaleUpdate = true;
    try {
      invalidatePlotPaths(this.plot);
      this.plot.setData(
        this.getPlotData(),
        this.isAutoFollowEnabled && !this.shouldPreserveScaleWhileFollowing,
      );

      const xWindowRange = this.getAutoFollowRange(this.shouldPreserveScaleWhileFollowing);

      if (this.isAutoFollowEnabled && hasScaleRange(xWindowRange)) {
        this.setPlotScale("x", xWindowRange);
      } else if (!this.isAutoFollowEnabled) {
        this.plot.redraw(true, false);
      }
    } finally {
      this.isApplyingScaleUpdate = false;
    }
  }

  private handlePlotScaleChanged(scaleKey: string): void {
    if (this.plot === undefined || this.isApplyingScaleUpdate) {
      return;
    }

    if (scaleKey === "x" || scaleKey.startsWith("y")) {
      this.handlePlotUserInteraction();
    }
  }

  private handlePlotUserInteraction(): void {
    if (this.followMode === "locked") {
      this.isAutoFollowEnabled = false;
      this.scheduleLockedFollowResume();
    } else {
      this.clearLockedFollowResumeTimer();
      this.isAutoFollowEnabled = false;
    }

    this.updateFollowButton();
  }

  private handlePlotUserInteractionSettled(): void {
    if (this.followMode === "locked") {
      this.scheduleLockedFollowResume();
    }
  }

  private getPlotData(): uPlot.AlignedData {
    return [this.timeValues, ...this.seriesData.values()];
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
    const latestTime = this.timeValues.at(-1);

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

  private getXWindowRange(): { min?: number; max?: number } {
    const latestTime = this.timeValues.at(-1);

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

  private getSeriesLabel(channelName: string): string {
    const series = this.config.series[channelName];
    const unit = series?.unit;
    const label = series?.label ?? channelName;
    return unit === undefined ? label : `${label} (${unit})`;
  }

  private getSeriesColor(channelName: string, index: number): string {
    return this.config.series[channelName]?.color ?? colors[index % colors.length] ?? colors[0];
  }

  private getSeriesWidth(channelName: string): number {
    return this.config.series[channelName]?.line?.width ?? 2;
  }

  private getSeriesVisible(channelName: string): boolean {
    return this.config.series[channelName]?.visible ?? true;
  }

  private getSeriesUnit(channelName: string): string {
    return this.config.series[channelName]?.unit ?? defaultValueUnit;
  }

  private getUnitGroups(channelNames: readonly string[]): UnitGroup[] {
    const unitGroups: UnitGroup[] = [];

    for (const channelName of channelNames) {
      const unit = this.getSeriesUnit(channelName);
      const unitGroup = unitGroups.find((group) => group.unit === unit);

      if (unitGroup === undefined) {
        unitGroups.push({ unit, channelNames: [channelName] });
      } else {
        unitGroup.channelNames.push(channelName);
      }
    }

    return unitGroups.length === 0 ? [{ unit: defaultValueUnit, channelNames: [] }] : unitGroups;
  }

  private getUnitGroupIndex(unitGroups: readonly UnitGroup[], channelName: string): number {
    return Math.max(
      0,
      unitGroups.findIndex((group) => group.unit === this.getSeriesUnit(channelName)),
    );
  }

  private getTimeAxisLabel(): string {
    if (this.config.time.source === "sequence") {
      return "Sequence";
    }

    return "Time (s)";
  }

  private getYAxisLabel(unitGroup: UnitGroup): string {
    if (unitGroup.unit === defaultValueUnit) {
      return defaultValueUnit;
    }

    if (unitGroup.channelNames.length === 1) {
      const channelName = unitGroup.channelNames[0];
      const label =
        channelName === undefined
          ? unitGroup.unit
          : (this.config.series[channelName]?.label ?? channelName);
      return `${label} (${unitGroup.unit})`;
    }

    return unitGroup.unit;
  }

  private renderLegend(channelNames: string[]): void {
    this.legendElement.replaceChildren();
    this.legendElement.hidden = !this.getShowLegend();

    if (channelNames.length === 0) {
      const empty = document.createElement("span");
      empty.className = "legend-empty";
      empty.textContent = "Waiting for numeric data";
      this.legendElement.append(empty);
      return;
    }

    for (const [index, channelName] of channelNames.entries()) {
      const label = document.createElement("label");
      label.className = "legend-item";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = this.seriesVisibility.get(channelName) ?? true;
      checkbox.addEventListener("change", () => {
        this.seriesVisibility.set(channelName, checkbox.checked);
        this.plot?.setSeries(index + 1, { show: checkbox.checked });
      });

      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.backgroundColor = this.getSeriesColor(channelName, index);

      const text = document.createElement("span");
      text.textContent = this.getSeriesLabel(channelName);

      label.append(checkbox, swatch, text);
      this.legendElement.append(label);
    }
  }

  private syncSeriesVisibility(): void {
    if (this.plot === undefined) {
      return;
    }

    for (const [index, channelName] of [...this.seriesData.keys()].entries()) {
      this.plot.setSeries(index + 1, {
        show: this.seriesVisibility.get(channelName) ?? this.getSeriesVisible(channelName),
      });
    }
  }

  private getChartSize(): { width: number; height: number } {
    const rect = this.chartElement.getBoundingClientRect();
    return {
      width: Math.max(320, Math.floor(rect.width)),
      height: Math.max(260, Math.floor(rect.height)),
    };
  }

  private getShowLegend(): boolean {
    return this.viewLayout?.showLegend ?? this.config.style?.showLegend !== false;
  }

  private getDefaultFollowMode(): TimeSeriesFollowMode {
    return this.viewLayout?.followMode ?? "unlocked";
  }

  private getDefaultAutoFollow(): boolean {
    if (this.getDefaultFollowMode() === "locked") {
      return true;
    }

    return this.viewLayout?.autoFollow ?? true;
  }

  private toggleFollowMode(): void {
    this.clearLockedFollowResumeTimer();

    if (this.followMode === "locked") {
      this.followMode = "unlocked";
      this.isAutoFollowEnabled = true;
      this.shouldPreserveScaleWhileFollowing = true;
      this.applyAutoFollowRange(true);
      this.updateFollowButton();
      return;
    }

    if (!this.isAutoFollowEnabled) {
      this.isAutoFollowEnabled = true;
      this.shouldPreserveScaleWhileFollowing = true;
      this.applyAutoFollowRange(true);
      this.updateFollowButton();
      return;
    }

    this.followMode = "locked";
    this.isAutoFollowEnabled = true;
    this.shouldPreserveScaleWhileFollowing = true;
    this.applyAutoFollowRange(true);
    this.updateFollowButton();
  }

  private scheduleLockedFollowResume(): void {
    this.clearLockedFollowResumeTimer();
    this.lockedFollowResumeTimer = setTimeout(() => {
      this.lockedFollowResumeTimer = undefined;

      if (this.followMode !== "locked") {
        return;
      }

      this.isAutoFollowEnabled = true;
      this.shouldPreserveScaleWhileFollowing = true;
      this.applyAutoFollowRange(true);
      this.updateFollowButton();
    }, 350);
  }

  private clearLockedFollowResumeTimer(): void {
    if (this.lockedFollowResumeTimer === undefined) {
      return;
    }

    clearTimeout(this.lockedFollowResumeTimer);
    this.lockedFollowResumeTimer = undefined;
  }

  private updateFollowButton(): void {
    if (this.followButton === undefined) {
      return;
    }

    if (this.followMode === "locked") {
      this.followButton.textContent = "Locked Follow";
      this.followButton.title = "Keep following latest data after interactions";
      this.followButton.setAttribute("aria-pressed", "true");
      return;
    }

    if (!this.isAutoFollowEnabled) {
      this.followButton.textContent = "Follow";
      this.followButton.title = "Resume following latest data";
      this.followButton.setAttribute("aria-pressed", "false");
      return;
    }

    this.followButton.textContent = "Following";
    this.followButton.title = "Lock follow after interactions";
    this.followButton.setAttribute("aria-pressed", "false");
  }

  private applyViewDefaults(): void {
    if (this.plot === undefined) {
      return;
    }

    const zoom = this.viewLayout?.zoom;

    if (zoom?.x !== undefined) {
      this.setPlotScale("x", zoom.x);
    }

    if (zoom?.y !== undefined) {
      for (const [scaleKey, range] of Object.entries(zoom.y)) {
        this.setPlotScale(scaleKey, range);
      }
    }

    if (zoom?.x !== undefined || zoom?.y !== undefined) {
      if (this.followMode === "locked") {
        this.isAutoFollowEnabled = true;
        this.shouldPreserveScaleWhileFollowing = true;
        this.applyAutoFollowRange(true);
        this.updateFollowButton();
        return;
      }

      this.isAutoFollowEnabled = false;
      this.updateFollowButton();
      return;
    }

    if (this.isAutoFollowEnabled) {
      this.applyAutoFollowRange(false);
    }

    this.updateFollowButton();
  }

  private restoreRuntimeViewAfterRebuild(ranges: PlotScaleRanges | undefined): void {
    if (ranges !== undefined) {
      this.applyScaleRanges(ranges);
    }

    if (this.isAutoFollowEnabled) {
      this.applyAutoFollowRange(this.shouldPreserveScaleWhileFollowing);
    }

    this.updateFollowButton();
  }

  private applyScaleRanges(ranges: PlotScaleRanges): void {
    if (ranges.x !== undefined) {
      this.setPlotScale("x", ranges.x);
    }

    if (ranges.y === undefined) {
      return;
    }

    for (const [scaleKey, range] of Object.entries(ranges.y)) {
      this.setPlotScale(scaleKey, range);
    }
  }

  private applyAutoFollowRange(preserveCurrentSpan: boolean): void {
    const range = this.getAutoFollowRange(preserveCurrentSpan);

    if (this.plot !== undefined && hasScaleRange(range)) {
      this.setPlotScale("x", range);
    }
  }

  private getAutoFollowRange(preserveCurrentSpan: boolean): { min?: number; max?: number } {
    if (preserveCurrentSpan) {
      const range = this.getPreservedXWindowRange();

      if (hasScaleRange(range)) {
        return range;
      }
    }

    return this.getXWindowRange();
  }

  private getPreservedXWindowRange(): { min?: number; max?: number } {
    const latestTime = this.timeValues.at(-1);
    const xScale = this.plot?.scales.x;
    const currentMin = xScale?.min;
    const currentMax = xScale?.max;

    if (
      latestTime === undefined ||
      typeof currentMin !== "number" ||
      typeof currentMax !== "number" ||
      !Number.isFinite(currentMin) ||
      !Number.isFinite(currentMax) ||
      currentMax <= currentMin
    ) {
      return {};
    }

    const span = currentMax - currentMin;
    return {
      min: latestTime - span,
      max: latestTime,
    };
  }

  private setPlotScale(scaleKey: string, range: { min: number; max: number }): void {
    if (this.plot === undefined) {
      return;
    }

    this.isApplyingScaleUpdate = true;
    try {
      this.plot.setScale(scaleKey, range);
    } finally {
      this.isApplyingScaleUpdate = false;
    }
  }

  private captureZoom(): TimeSeriesViewLayoutConfig["zoom"] {
    if (this.plot === undefined || this.isAutoFollowEnabled) {
      return undefined;
    }

    return this.captureScaleRanges();
  }

  private captureScaleRanges(): PlotScaleRanges | undefined {
    const xScale = this.plot?.scales.x;

    if (this.plot === undefined) {
      return undefined;
    }

    const zoom: PlotScaleRanges = {};

    if (xScale !== undefined && typeof xScale.min === "number" && typeof xScale.max === "number") {
      zoom.x = {
        min: xScale.min,
        max: xScale.max,
      };
    }

    for (const [scaleKey, scale] of Object.entries(this.plot.scales)) {
      if (scaleKey === "x") {
        continue;
      }

      if (typeof scale.min !== "number" || typeof scale.max !== "number") {
        continue;
      }

      zoom.y ??= {};
      zoom.y[scaleKey] = {
        min: scale.min,
        max: scale.max,
      };
    }

    return zoom.x === undefined && zoom.y === undefined ? undefined : zoom;
  }
}
