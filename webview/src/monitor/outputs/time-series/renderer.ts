import uPlot from "uplot";
import type {
  OutputLayoutConfig,
  OutputPacket,
  TimeSeriesLineOutputConfig,
  TimeSeriesSample,
  TimeSeriesViewStateConfig,
} from "../../../../../src/shared/protocol";
import {
  createTimeSeriesInteractionPlugins,
  defaultTimeSeriesInteractionConfig,
} from "./interactions";
import { appendTileHeaderButton, createTileHeader } from "../tile/chrome";
import { TimeSeriesDataBuffer } from "./dataBuffer";
import { renderTimeSeriesLegend } from "./legend";
import { invalidatePlotPaths } from "./pathCache";
import { getUnitScaleKey, getXAxisTickSpace, getYAxisTickSpace, hasScaleRange } from "./scales";
import {
  getSeriesColor,
  getSeriesLabel,
  getSeriesVisible,
  getSeriesWidth,
  getTimeAxisLabel,
  getUnitGroupIndex,
  getUnitGroups,
  getYAxisLabel,
} from "./seriesConfig";
import type {
  OutputRenderer,
  PlotRebuildOptions,
  PlotScaleRanges,
  TimeSeriesFollowMode,
} from "../types";

export class TimeSeriesLineRenderer implements OutputRenderer {
  readonly outputId: string;
  readonly kind = "timeSeriesLine" as const;

  private readonly dataBuffer: TimeSeriesDataBuffer;
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
  private viewLayout: TimeSeriesViewStateConfig | undefined;
  private plot: uPlot | undefined;

  constructor(
    parent: HTMLElement,
    private readonly config: TimeSeriesLineOutputConfig,
    viewLayout: OutputLayoutConfig["viewState"] | undefined,
  ) {
    this.outputId = config.id;
    this.dataBuffer = new TimeSeriesDataBuffer(config);
    this.applyViewState(viewLayout);
    this.chartElement = document.createElement("div");
    this.chartElement.className = "output-chart";
    this.legendElement = document.createElement("div");
    this.legendElement.className = "output-legend";

    const header = createTileHeader(config, "Time Series");
    this.followButton = appendTileHeaderButton(
      header,
      "Follow",
      () => this.toggleFollowMode(),
      "output-follow-button",
    );
    appendTileHeaderButton(header, "Reset", () => this.resetViewState(), "output-reset-button");
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

  updateData(packet: OutputPacket): void {
    if (packet.kind !== "timeSeriesAppend") {
      return;
    }

    this.appendSamples(packet.samples);
  }

  appendSamples(samples: readonly TimeSeriesSample[]): void {
    const result = this.dataBuffer.appendSamples(samples);

    for (const channelName of result.discoveredChannelNames) {
      this.seriesVisibility.set(channelName, this.getSeriesVisible(channelName));
    }

    if (result.discoveredChannelNames.length > 0) {
      this.rebuildPlot({ applyViewDefaults: false });
      return;
    }

    this.updatePlotData();
  }

  clearData(): void {
    this.clearLockedFollowResumeTimer();
    this.followMode = this.getDefaultFollowMode();
    this.isAutoFollowEnabled = this.getDefaultAutoFollow();
    this.shouldPreserveScaleWhileFollowing = false;
    this.dataBuffer.clear();
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

  applyViewState(layout: OutputLayoutConfig["viewState"] | undefined): void {
    this.viewLayout = layout?.kind === "timeSeriesLine" ? layout : undefined;
    this.followMode = this.getDefaultFollowMode();
    this.isAutoFollowEnabled = this.getDefaultAutoFollow();
    this.shouldPreserveScaleWhileFollowing = false;
    this.updateFollowButton();
  }

  resetViewState(): void {
    this.applyViewState(this.viewLayout);
    for (const channelName of this.dataBuffer.getChannelNames()) {
      const visible = this.getSeriesVisible(channelName);
      this.seriesVisibility.set(channelName, visible);
    }
    this.applyViewDefaults();
    this.renderLegend(this.dataBuffer.getChannelNames());
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

  captureViewState(): OutputLayoutConfig["viewState"] {
    const layout: TimeSeriesViewStateConfig = {
      kind: "timeSeriesLine",
      showLegend: !this.legendElement.hidden,
      autoFollow: this.isAutoFollowEnabled,
      followMode: this.followMode,
    };
    const zoom = this.captureZoom();

    if (zoom !== undefined) {
      layout.zoom = zoom;
    }

    return layout;
  }

  private initializeConfiguredSeries(): void {
    for (const channelName of this.dataBuffer.initializeConfiguredSeries()) {
      this.seriesVisibility.set(channelName, this.getSeriesVisible(channelName));
    }
  }

  private rebuildPlot(options: PlotRebuildOptions = { applyViewDefaults: true }): void {
    const runtimeScaleRanges = options.applyViewDefaults ? undefined : this.captureScaleRanges();
    this.plot?.destroy();

    const channelNames = this.dataBuffer.getChannelNames();
    const unitGroups = getUnitGroups(this.config, channelNames);
    const scales: uPlot.Options["scales"] = {
      x: {
        time: false,
        ...this.getXWindowRange(),
      },
    };
    const axes: uPlot.Axis[] = [
      {
        label: getTimeAxisLabel(this.config),
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
        label: getYAxisLabel(this.config, unitGroup),
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
        scale: getUnitScaleKey(getUnitGroupIndex(this.config, unitGroups, channelName)),
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
          resetViewState: () => this.resetViewState(),
        }),
        series,
      },
      this.dataBuffer.getPlotData(),
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
        this.dataBuffer.getPlotData(),
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

  private getXWindowRange(): { min?: number; max?: number } {
    return this.dataBuffer.getXWindowRange();
  }

  private getSeriesLabel(channelName: string): string {
    return getSeriesLabel(this.config, channelName);
  }

  private getSeriesColor(channelName: string, index: number): string {
    return getSeriesColor(this.config, channelName, index);
  }

  private getSeriesWidth(channelName: string): number {
    return getSeriesWidth(this.config, channelName);
  }

  private getSeriesVisible(channelName: string): boolean {
    return getSeriesVisible(this.config, channelName);
  }

  private renderLegend(channelNames: string[]): void {
    renderTimeSeriesLegend({
      legendElement: this.legendElement,
      channelNames,
      showLegend: this.getShowLegend(),
      getChecked: (channelName) => this.seriesVisibility.get(channelName) ?? true,
      getColor: (channelName, index) => this.getSeriesColor(channelName, index),
      getLabel: (channelName) => this.getSeriesLabel(channelName),
      onVisibilityChange: (channelName, index, visible) => {
        this.seriesVisibility.set(channelName, visible);
        this.plot?.setSeries(index + 1, { show: visible });
      },
    });
  }

  private syncSeriesVisibility(): void {
    if (this.plot === undefined) {
      return;
    }

    for (const [index, channelName] of this.dataBuffer.getChannelNames().entries()) {
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
    const latestTime = this.dataBuffer.getLatestTime();
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

  private captureZoom(): TimeSeriesViewStateConfig["zoom"] {
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
