import type {
  LayoutConfig,
  OutputConfig,
  OutputLayoutConfig,
  OutputPacket,
  TimeSeriesViewStateConfig,
} from "../../../../src/shared/protocol";

export interface OutputGridControllerOptions {
  root: HTMLElement;
}

/**
 * Port used by the page store to drive the output grid without depending on the
 * DOM implementation. `DomOutputGridController` is the production implementation.
 */
export interface OutputGridController {
  renderOutputs(outputs: readonly OutputConfig[], layout: LayoutConfig): void;
  appendPacket(packet: OutputPacket): void;
  resetOutputViewState(outputId: string): void;
  resetPageLayout(): void;
  captureLayout(): LayoutConfig;
  dispose(): void;
}

/**
 * Common adapter used by the output grid controller to drive one output renderer.
 */
export interface OutputRenderer {
  /** Profile output id used for packet routing and layout snapshots. */
  readonly outputId: string;
  /** Renderer kind declared by the output profile config. */
  readonly kind: OutputConfig["kind"];
  /** Append runtime data; implementations ignore packets for other output kinds. */
  updateData(packet: OutputPacket): void;
  /** Clear runtime data currently displayed by this output. */
  clearData(): void;
  /** Apply renderer-specific view state, not the outer tile grid layout. */
  applyViewState(layout: OutputLayoutConfig["viewState"] | undefined): void;
  /** Reset interaction/view state without clearing runtime data. */
  resetViewState(): void;
  /** Capture renderer-specific view state that can be saved into a layout profile. */
  captureViewState(): OutputLayoutConfig["viewState"] | undefined;
  /** Release observers, chart instances, and other renderer-owned resources. */
  dispose(): void;
}

export type PlotWindowConfig =
  | { mode: "points"; maxPoints: number }
  | { mode: "duration"; seconds: number };

export type TimeSeriesFollowMode = NonNullable<TimeSeriesViewStateConfig["followMode"]>;
export type PlotScaleRanges = NonNullable<TimeSeriesViewStateConfig["zoom"]>;

export interface UnitGroup {
  unit: string;
  channelNames: string[];
}

export interface PlotRebuildOptions {
  applyViewDefaults: boolean;
}
