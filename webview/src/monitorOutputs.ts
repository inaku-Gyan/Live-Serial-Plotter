import uPlot from "uplot";
import { defaultLayout } from "../../src/profiles/defaultLayout";
import type {
  FramePlot2dOutputConfig,
  FramePlot2dPacket,
  FramePlot2dViewLayoutConfig,
  LayoutConfig,
  OutputLayoutConfig,
  OutputConfig,
  OutputPacket,
  TerminalAppendOutputConfig,
  TerminalAppendPacket,
  TerminalFrameOutputConfig,
  TerminalFramePacket,
  TerminalViewLayoutConfig,
  TimeSeriesLineOutputConfig,
  TimeSeriesSample,
  TimeSeriesViewLayoutConfig,
  TimeSeriesWindowConfig,
  ToExtensionMessage,
} from "../../src/shared/protocol";
import {
  createTimeSeriesInteractionPlugins,
  defaultTimeSeriesInteractionConfig,
} from "./monitor/uplotInteractions";

type PostMessage = (message: ToExtensionMessage) => void;

interface MonitorOutputControllerOptions {
  root: HTMLElement;
  postMessage: PostMessage;
}

interface OutputView {
  readonly outputId: string;
  readonly kind: OutputConfig["kind"];
  appendPacket(packet: OutputPacket): void;
  applyViewLayout(layout: OutputLayoutConfig["view"] | undefined): void;
  resetView(): void;
  captureViewLayout(): OutputLayoutConfig["view"] | undefined;
  clear(): void;
  dispose(): void;
}

const defaultMaxRawLines = 500;
const defaultMaxPlotPoints = 3000;
const defaultVisiblePlotPoints = 300;
const defaultDurationSeconds = 30;
const defaultValueUnit = "Value";
const uPlotPathCacheKey = "_paths";
const minXAxisTickSpace = 22;
const maxXAxisTickSpace = 72;
const targetXAxisTickDivisions = 6;
const minYAxisTickSpace = 18;
const maxYAxisTickSpace = 44;
const targetYAxisTickDivisions = 8;
const colors = ["#4cc9f0", "#f72585", "#ffd166", "#06d6a0", "#c77dff", "#f77f00", "#90be6d"];

type PlotWindowConfig =
  | { mode: "points"; maxPoints: number }
  | { mode: "duration"; seconds: number };

type TimeSeriesFollowMode = NonNullable<TimeSeriesViewLayoutConfig["followMode"]>;
type PlotScaleRanges = NonNullable<TimeSeriesViewLayoutConfig["zoom"]>;

interface UnitGroup {
  unit: string;
  channelNames: string[];
}

interface PlotRebuildOptions {
  applyViewDefaults: boolean;
}

export class MonitorOutputController {
  private readonly views = new Map<string, OutputView>();
  private currentLayout: LayoutConfig | undefined;
  private readonly postMessage: PostMessage;

  constructor(private readonly options: MonitorOutputControllerOptions) {
    this.postMessage = options.postMessage;
  }

  renderOutputs(outputs: readonly OutputConfig[], layout: LayoutConfig = defaultLayout): void {
    this.disposeViews();
    this.currentLayout = layout;
    this.applyPageLayout(layout);
    this.options.root.replaceChildren();

    for (const output of sortOutputsByLayout(outputs, layout)) {
      const view = this.createOutputView(output, layout.outputs[output.id]);
      this.views.set(output.id, view);
    }
  }

  appendPacket(packet: OutputPacket): void {
    this.views.get(packet.outputId)?.appendPacket(packet);
  }

  appendLegacyRawLine(line: string, timestamp: number): void {
    const view = this.findFirstView("terminalAppend");

    if (view instanceof TerminalAppendView) {
      view.appendLines([{ text: line }], timestamp);
    }
  }

  appendLegacySeries(samples: readonly { t: number; values: Record<string, number> }[]): void {
    const view = this.findFirstView("timeSeriesLine");

    if (view instanceof TimeSeriesLineView) {
      view.appendSamples(samples.map((sample) => ({ time: sample.t, values: sample.values })));
    }
  }

  clearAll(): void {
    for (const view of this.views.values()) {
      view.clear();
    }
  }

  resetOutputView(outputId: string): void {
    this.views.get(outputId)?.resetView();
  }

  resetPageLayout(): void {
    if (this.currentLayout === undefined) {
      return;
    }

    this.applyPageLayout(this.currentLayout);

    for (const view of this.views.values()) {
      view.resetView();
      const panel = this.options.root.querySelector<HTMLElement>(
        `[data-output-id="${cssEscape(view.outputId)}"]`,
      );
      applyPanelLayout(panel, this.currentLayout.outputs[view.outputId]);
    }
  }

  captureSavableViewState(): LayoutConfig {
    const baseLayout = this.currentLayout;

    if (baseLayout === undefined) {
      return {
        schemaVersion: 1,
        id: "unsaved",
        name: "Unsaved Layout",
        page: { mode: "grid", columns: "auto", density: "normal" },
        outputs: {},
      };
    }

    const outputs: Record<string, OutputLayoutConfig> = {};

    for (const [outputId, view] of this.views.entries()) {
      outputs[outputId] = {
        ...baseLayout.outputs[outputId],
        view: view.captureViewLayout(),
      };
    }

    return {
      ...baseLayout,
      outputs: {
        ...baseLayout.outputs,
        ...outputs,
      },
    };
  }

  dispose(): void {
    this.disposeViews();
  }

  private createOutputView(
    output: OutputConfig,
    layout: OutputLayoutConfig | undefined,
  ): OutputView {
    const section = document.createElement("section");
    section.className = `output-panel output-panel-${output.kind}`;
    section.dataset.outputId = output.id;
    section.dataset.outputKind = output.kind;
    applyPanelLayout(section, layout);
    this.options.root.append(section);

    if (output.kind === "terminalAppend") {
      return new TerminalAppendView(section, output, layout?.view, this.postMessage);
    }

    if (output.kind === "terminalFrame") {
      return new TerminalFrameView(section, output, layout?.view);
    }

    if (output.kind === "timeSeriesLine") {
      return new TimeSeriesLineView(section, output, layout?.view);
    }

    return new FramePlot2dView(section, output, layout?.view);
  }

  private findFirstView(kind: OutputConfig["kind"]): OutputView | undefined {
    return [...this.views.values()].find((view) => view.kind === kind);
  }

  private disposeViews(): void {
    for (const view of this.views.values()) {
      view.dispose();
    }

    this.views.clear();
  }

  private applyPageLayout(layout: LayoutConfig): void {
    this.options.root.dataset.layoutColumns = layout.page.columns ?? "auto";
    this.options.root.dataset.layoutDensity = layout.page.density ?? "normal";
  }
}

class TerminalAppendView implements OutputView {
  readonly outputId: string;
  readonly kind = "terminalAppend" as const;

  private readonly lines: string[] = [];
  private readonly pre: HTMLPreElement;
  private viewLayout: TerminalViewLayoutConfig | undefined;

  constructor(
    parent: HTMLElement,
    private readonly config: TerminalAppendOutputConfig,
    viewLayout: OutputLayoutConfig["view"] | undefined,
    private readonly postMessage: PostMessage,
  ) {
    this.outputId = config.id;
    this.applyViewLayout(viewLayout);

    const header = createPanelHeader(config, "Terminal", () => this.resetView());
    appendPanelHeaderButton(
      header,
      "Clear",
      () => {
        this.clear();
        this.postMessage({ type: "clearLog" });
      },
      "output-clear-button",
    );

    this.pre = document.createElement("pre");
    this.pre.className = "output-terminal output-standby";
    this.pre.textContent = "Waiting for serial text";

    parent.append(header, this.pre);
  }

  appendPacket(packet: OutputPacket): void {
    if (packet.kind !== "terminalAppend") {
      return;
    }

    this.appendLines(packet.lines, packet.receivedAt);
  }

  appendLines(lines: TerminalAppendPacket["lines"], timestamp: number): void {
    const time = new Date(timestamp).toLocaleTimeString();
    this.lines.push(...lines.map((line) => `[${time}] ${line.text}`));

    const maxLines = this.config.maxLines ?? defaultMaxRawLines;

    if (this.lines.length > maxLines) {
      this.lines.splice(0, this.lines.length - maxLines);
    }

    this.pre.classList.remove("output-standby");
    this.pre.textContent = this.lines.join("\n");

    if (this.getAutoScroll()) {
      this.pre.scrollTop = this.pre.scrollHeight;
    }
  }

  applyViewLayout(layout: OutputLayoutConfig["view"] | undefined): void {
    this.viewLayout = layout?.kind === "terminalAppend" ? layout : undefined;
  }

  resetView(): void {
    this.applyViewLayout(undefined);
  }

  captureViewLayout(): OutputLayoutConfig["view"] {
    return {
      kind: "terminalAppend",
      autoScroll: this.getAutoScroll(),
    };
  }

  clear(): void {
    this.lines.length = 0;
    this.pre.classList.add("output-standby");
    this.pre.textContent = "Waiting for serial text";
  }

  dispose(): void {}

  private getAutoScroll(): boolean {
    return this.viewLayout?.autoScroll ?? this.config.autoScroll !== false;
  }
}

class TerminalFrameView implements OutputView {
  readonly outputId: string;
  readonly kind = "terminalFrame" as const;

  private readonly frames = new Map<string | number, string>();
  private readonly pre: HTMLPreElement;
  private viewLayout: TerminalViewLayoutConfig | undefined;

  constructor(
    parent: HTMLElement,
    config: TerminalFrameOutputConfig,
    viewLayout: OutputLayoutConfig["view"] | undefined,
  ) {
    this.outputId = config.id;
    this.applyViewLayout(viewLayout);
    this.pre = document.createElement("pre");
    this.pre.className = "output-terminal output-frame-terminal output-standby";
    this.pre.textContent = "Waiting for frame data";

    parent.append(
      createPanelHeader(config, "Frame Terminal", () => this.resetView()),
      this.pre,
    );
  }

  appendPacket(packet: OutputPacket): void {
    if (packet.kind !== "terminalFrame") {
      return;
    }

    this.appendFrame(packet);
  }

  appendFrame(packet: TerminalFramePacket): void {
    this.frames.set(packet.frameId, packet.text);
    this.pre.classList.remove("output-standby");
    this.pre.textContent = [...this.frames.entries()]
      .map(([frameId, text]) => `#${String(frameId)}\n${text}`)
      .join("\n\n");
  }

  applyViewLayout(layout: OutputLayoutConfig["view"] | undefined): void {
    this.viewLayout = layout?.kind === "terminalFrame" ? layout : undefined;
  }

  resetView(): void {
    this.applyViewLayout(undefined);
  }

  captureViewLayout(): OutputLayoutConfig["view"] {
    return {
      kind: "terminalFrame",
      autoScroll: this.viewLayout?.autoScroll,
    };
  }

  clear(): void {
    this.frames.clear();
    this.pre.classList.add("output-standby");
    this.pre.textContent = "Waiting for frame data";
  }

  dispose(): void {}
}

class TimeSeriesLineView implements OutputView {
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

interface PathCachedSeries extends uPlot.Series {
  [uPlotPathCacheKey]?: unknown;
  points?: uPlot.Series.Points & {
    [uPlotPathCacheKey]?: unknown;
  };
}

function invalidatePlotPaths(plot: uPlot): void {
  for (const series of plot.series.slice(1) as PathCachedSeries[]) {
    series[uPlotPathCacheKey] = null;

    if (series.points !== undefined) {
      series.points[uPlotPathCacheKey] = null;
    }
  }
}

class FramePlot2dView implements OutputView {
  readonly outputId: string;
  readonly kind = "framePlot2d" as const;

  private readonly canvas: HTMLCanvasElement;
  private readonly resizeObserver: ResizeObserver | undefined;
  private latestPacket: FramePlot2dPacket | undefined;
  private viewLayout: FramePlot2dViewLayoutConfig | undefined;

  constructor(
    parent: HTMLElement,
    private readonly config: FramePlot2dOutputConfig,
    viewLayout: OutputLayoutConfig["view"] | undefined,
  ) {
    this.outputId = config.id;
    this.applyViewLayout(viewLayout);
    this.canvas = document.createElement("canvas");
    this.canvas.className = "output-frame-canvas";
    this.canvas.setAttribute("aria-label", "Frame plot");

    parent.append(
      createPanelHeader(config, "Frame Plot", () => this.resetView()),
      this.canvas,
    );
    this.draw();

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.draw());
      this.resizeObserver.observe(this.canvas);
    }
  }

  appendPacket(packet: OutputPacket): void {
    if (packet.kind !== "framePlot2d") {
      return;
    }

    this.latestPacket = packet;
    this.draw();
  }

  clear(): void {
    this.latestPacket = undefined;
    this.draw();
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
  }

  applyViewLayout(layout: OutputLayoutConfig["view"] | undefined): void {
    this.viewLayout = layout?.kind === "framePlot2d" ? layout : undefined;
  }

  resetView(): void {
    this.applyViewLayout(this.viewLayout);
    this.draw();
  }

  captureViewLayout(): OutputLayoutConfig["view"] {
    return {
      kind: "framePlot2d",
      bounds: this.viewLayout?.bounds,
    };
  }

  private draw(): void {
    const context = getCanvasContext(this.canvas);

    if (context === undefined) {
      return;
    }

    const size = getCanvasSize(this.canvas);
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(size.width * ratio));
    this.canvas.height = Math.max(1, Math.floor(size.height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);

    const style = getComputedStyle(this.canvas);
    const foreground = readCssColor(style, "--vscode-foreground", "#cccccc");
    const muted = readCssColor(style, "--vscode-descriptionForeground", "#8f8f8f");
    const grid = readCssColor(style, "--vscode-panel-border", "#3c3c3c");
    const bounds =
      this.viewLayout?.bounds ??
      this.latestPacket?.bounds ??
      this.config.bounds ??
      inferBounds(this.latestPacket);
    const plotBounds = bounds ?? { xMin: -1, xMax: 1, yMin: -1, yMax: 1 };
    const area = {
      left: 42,
      top: 16,
      right: size.width - 14,
      bottom: size.height - 28,
    };

    context.strokeStyle = grid;
    context.lineWidth = 1;
    context.strokeRect(area.left, area.top, area.right - area.left, area.bottom - area.top);
    drawCenterAxes(context, plotBounds, area, grid);

    context.fillStyle = muted;
    context.font = "11px sans-serif";
    context.fillText(String(plotBounds.yMax), 6, area.top + 4);
    context.fillText(String(plotBounds.yMin), 6, area.bottom);
    context.fillText(String(plotBounds.xMin), area.left, size.height - 8);
    context.fillText(
      String(plotBounds.xMax),
      Math.max(area.left, area.right - 42),
      size.height - 8,
    );

    const layers = this.latestPacket?.layers ?? [];

    if (layers.length === 0) {
      context.fillStyle = muted;
      context.textAlign = "center";
      context.fillText("Waiting for frame points", size.width / 2, size.height / 2);
      context.textAlign = "start";
      return;
    }

    for (const layer of layers) {
      for (const point of layer.points) {
        const x = scaleLinear(point.x, plotBounds.xMin, plotBounds.xMax, area.left, area.right);
        const y = scaleLinear(point.y, plotBounds.yMin, plotBounds.yMax, area.bottom, area.top);
        const pointStyle =
          point.styleKey === undefined ? undefined : this.config.styles?.[point.styleKey];
        context.fillStyle = point.color ?? pointStyle?.color ?? foreground;
        context.beginPath();
        context.arc(x, y, point.size ?? pointStyle?.size ?? 3, 0, Math.PI * 2);
        context.fill();
      }
    }
  }
}

function createPanelHeader(
  config: OutputConfig,
  fallbackKind: string,
  onReset?: () => void,
): HTMLElement {
  const header = document.createElement("header");
  header.className = "output-header";

  const text = document.createElement("div");
  text.className = "output-title-block";

  const title = document.createElement("strong");
  title.textContent = config.title ?? config.id;

  const meta = document.createElement("span");
  meta.textContent = `${fallbackKind} / ${config.id}`;

  text.append(title, meta);
  header.append(text);

  if (onReset !== undefined) {
    appendPanelHeaderButton(header, "Reset", onReset, "output-reset-button");
  }

  return header;
}

function appendPanelHeaderButton(
  header: HTMLElement,
  label: string,
  onClick: () => void,
  className: string,
): HTMLButtonElement {
  const actions = getPanelHeaderActions(header);
  const button = document.createElement("button");
  button.className = `button button-secondary ${className}`;
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  actions.append(button);
  return button;
}

function getPanelHeaderActions(header: HTMLElement): HTMLElement {
  const existingActions = header.querySelector<HTMLElement>(".output-header-actions");

  if (existingActions !== null) {
    return existingActions;
  }

  const actions = document.createElement("div");
  actions.className = "output-header-actions";
  header.append(actions);
  return actions;
}

function pickConfiguredValues(
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

function sortOutputsByLayout(
  outputs: readonly OutputConfig[],
  layout: LayoutConfig,
): readonly OutputConfig[] {
  const sorted: OutputConfig[] = [];

  for (const output of outputs) {
    const insertIndex = sorted.findIndex(
      (candidate) => compareOutputLayoutOrder(output, candidate, outputs, layout) < 0,
    );

    if (insertIndex === -1) {
      sorted.push(output);
    } else {
      sorted.splice(insertIndex, 0, output);
    }
  }

  return sorted;
}

function compareOutputLayoutOrder(
  left: OutputConfig,
  right: OutputConfig,
  outputs: readonly OutputConfig[],
  layout: LayoutConfig,
): number {
  const leftOrder = layout.outputs[left.id]?.panel?.order;
  const rightOrder = layout.outputs[right.id]?.panel?.order;
  const leftIndex = outputs.findIndex((output) => output.id === left.id);
  const rightIndex = outputs.findIndex((output) => output.id === right.id);

  return (leftOrder ?? 10_000 + leftIndex) - (rightOrder ?? 10_000 + rightIndex);
}

function applyPanelLayout(panel: HTMLElement | null, layout: OutputLayoutConfig | undefined): void {
  if (panel === null) {
    return;
  }

  const panelLayout = layout?.panel;
  panel.style.order = panelLayout?.order === undefined ? "" : String(panelLayout.order);
  panel.style.gridColumn =
    panelLayout?.columnSpan === undefined ? "" : `span ${panelLayout.columnSpan}`;
  panel.style.minHeight = panelLayout?.minHeight === undefined ? "" : `${panelLayout.minHeight}px`;
  panel.dataset.collapsed = panelLayout?.collapsed === true ? "true" : "false";
  panel.dataset.maximized = panelLayout?.maximized === true ? "true" : "false";
}

function cssEscape(value: string): string {
  return typeof CSS === "undefined" || CSS.escape === undefined
    ? value.replaceAll('"', '\\"')
    : CSS.escape(value);
}

function getUnitScaleKey(unitIndex: number): string {
  return `y${unitIndex + 1}`;
}

function getXAxisTickSpace(
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

function getYAxisTickSpace(
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

function positiveNumberOrDefault(value: number | undefined, defaultValue: number): number {
  return typeof value === "number" && value > 0 ? value : defaultValue;
}

function hasScaleRange(range: {
  min?: number;
  max?: number;
}): range is { min: number; max: number } {
  return typeof range.min === "number" && typeof range.max === "number";
}

function getCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | undefined {
  try {
    return canvas.getContext("2d") ?? undefined;
  } catch {
    return undefined;
  }
}

function getCanvasSize(canvas: HTMLCanvasElement): { width: number; height: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    width: Math.max(320, Math.floor(rect.width)),
    height: Math.max(260, Math.floor(rect.height)),
  };
}

function readCssColor(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = style.getPropertyValue(name).trim();
  return value.length === 0 ? fallback : value;
}

function inferBounds(
  packet: FramePlot2dPacket | undefined,
): { xMin: number; xMax: number; yMin: number; yMax: number } | undefined {
  const points = packet?.layers.flatMap((layer) => layer.points) ?? [];

  if (points.length === 0) {
    return undefined;
  }

  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);

  return {
    xMin: xMin === xMax ? xMin - 1 : xMin,
    xMax: xMin === xMax ? xMax + 1 : xMax,
    yMin: yMin === yMax ? yMin - 1 : yMin,
    yMax: yMin === yMax ? yMax + 1 : yMax,
  };
}

function drawCenterAxes(
  context: CanvasRenderingContext2D,
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  area: { left: number; top: number; right: number; bottom: number },
  color: string,
): void {
  context.strokeStyle = color;
  context.beginPath();

  if (bounds.xMin < 0 && bounds.xMax > 0) {
    const x = scaleLinear(0, bounds.xMin, bounds.xMax, area.left, area.right);
    context.moveTo(x, area.top);
    context.lineTo(x, area.bottom);
  }

  if (bounds.yMin < 0 && bounds.yMax > 0) {
    const y = scaleLinear(0, bounds.yMin, bounds.yMax, area.bottom, area.top);
    context.moveTo(area.left, y);
    context.lineTo(area.right, y);
  }

  context.stroke();
}

function scaleLinear(
  value: number,
  fromMin: number,
  fromMax: number,
  toMin: number,
  toMax: number,
): number {
  if (fromMin === fromMax) {
    return (toMin + toMax) / 2;
  }

  return toMin + ((value - fromMin) / (fromMax - fromMin)) * (toMax - toMin);
}
