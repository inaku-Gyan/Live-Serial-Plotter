import type {
  OutputConfig,
  OutputLayoutConfig,
  OutputPacket,
  TimeSeriesViewLayoutConfig,
  ToExtensionMessage,
} from "../../../src/shared/protocol";

export type PostMessage = (message: ToExtensionMessage) => void;

export interface MonitorOutputControllerOptions {
  root: HTMLElement;
  postMessage: PostMessage;
}

export interface OutputView {
  readonly outputId: string;
  readonly kind: OutputConfig["kind"];
  appendPacket(packet: OutputPacket): void;
  applyViewLayout(layout: OutputLayoutConfig["view"] | undefined): void;
  resetView(): void;
  captureViewLayout(): OutputLayoutConfig["view"] | undefined;
  clear(): void;
  dispose(): void;
}

export type PlotWindowConfig =
  | { mode: "points"; maxPoints: number }
  | { mode: "duration"; seconds: number };

export type TimeSeriesFollowMode = NonNullable<TimeSeriesViewLayoutConfig["followMode"]>;
export type PlotScaleRanges = NonNullable<TimeSeriesViewLayoutConfig["zoom"]>;

export interface UnitGroup {
  unit: string;
  channelNames: string[];
}

export interface PlotRebuildOptions {
  applyViewDefaults: boolean;
}
