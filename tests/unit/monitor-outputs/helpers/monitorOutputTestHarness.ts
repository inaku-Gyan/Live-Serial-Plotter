import { beforeEach, vi } from "vitest";
import type {
  LayoutConfig,
  OutputConfig,
  TimeSeriesLineOutputConfig,
  ToExtensionMessage,
} from "../../../../src/shared/protocol";
import { MonitorOutputController } from "../../../../webview/src/monitor/outputs/controller";

const uPlotPathCacheKey = "_paths";

export interface MockUPlotInstance {
  options: {
    axes?: MockUPlotAxis[];
    cursor?: {
      drag?: { dist?: number; setScale?: boolean; x?: boolean; y?: boolean };
      focus?: { prox?: number };
      hover?: { prox?: number };
      points?: { one?: boolean };
    };
    hooks?: {
      setScale?: Array<(plot: MockUPlotInstance, scaleKey: string) => void>;
      ready?: Array<(plot: MockUPlotInstance) => void>;
      destroy?: Array<(plot: MockUPlotInstance) => void>;
    };
    legend?: { show?: boolean };
    scales?: Record<string, { min?: number; max?: number; time?: boolean }>;
    plugins?: MockUPlotPlugin[];
    series: MockUPlotSeries[];
  };
  hooks: {
    destroy: Array<() => void>;
  };
  over: HTMLDivElement;
  scales: Record<string, { min?: number; max?: number; time?: boolean }>;
  series: MockUPlotSeries[];
  data: unknown[];
  target: HTMLElement;
  destroy: ReturnType<typeof vi.fn<() => void>>;
  posToVal: ReturnType<typeof vi.fn<(leftTop: number, scaleKey: string) => number>>;
  redraw: ReturnType<typeof vi.fn<(rebuildPaths?: boolean, recalcAxes?: boolean) => void>>;
  setData: ReturnType<typeof vi.fn<(nextData: unknown[], resetScales?: boolean) => void>>;
  setScale: ReturnType<
    typeof vi.fn<(scaleKey: string, range: { min?: number; max?: number }) => void>
  >;
  setSeries: ReturnType<typeof vi.fn<(index: number, options: { show: boolean }) => void>>;
  setSize: ReturnType<typeof vi.fn<(size: { width: number; height: number }) => void>>;
}

interface MockUPlotAxis {
  label?: string;
  side?: number;
  space?: (
    plot: MockUPlotInstance,
    axisIndex: number,
    scaleMin: number,
    scaleMax: number,
    plotDimension: number,
  ) => number;
}

interface MockUPlotSeries {
  [uPlotPathCacheKey]?: unknown;
  label?: string;
  points?: {
    [uPlotPathCacheKey]?: unknown;
  };
  scale?: string;
  show?: boolean;
}

interface MockUPlotPlugin {
  hooks: {
    setScale?:
      | ((plot: MockUPlotInstance, scaleKey: string) => void)
      | Array<(plot: MockUPlotInstance, scaleKey: string) => void>;
    ready?: ((plot: MockUPlotInstance) => void) | Array<(plot: MockUPlotInstance) => void>;
    destroy?: ((plot: MockUPlotInstance) => void) | Array<(plot: MockUPlotInstance) => void>;
  };
}

const mockUPlot = vi.hoisted(() => ({
  instances: [] as MockUPlotInstance[],
}));

vi.mock("uplot", () => {
  return {
    default: vi.fn<
      (
        this: MockUPlotInstance,
        options: MockUPlotInstance["options"],
        data: unknown[],
        target: HTMLElement,
      ) => void
    >(function MockUPlot(
      this: MockUPlotInstance,
      options: MockUPlotInstance["options"],
      data: unknown[],
      target: HTMLElement,
    ) {
      this.options = options;
      this.options.hooks ??= {};
      mergePluginHooks(this.options);
      this.data = data;
      this.series = options.series;
      this.target = target;
      this.over = document.createElement("div");
      this.over.className = "u-over";
      this.over.getBoundingClientRect = vi.fn<() => DOMRect>(
        () =>
          ({
            left: 0,
            top: 0,
            width: 400,
            height: 260,
            right: 400,
            bottom: 260,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          }) as DOMRect,
      );
      target.append(this.over);
      this.scales = this.options.scales ?? {};
      this.hooks = {
        destroy: [],
      };
      this.destroy = vi.fn<() => void>(() => {
        for (const cleanup of this.hooks.destroy) {
          cleanup();
        }
        for (const hook of this.options.hooks?.destroy ?? []) {
          hook(this);
        }
      });
      this.posToVal = vi.fn<(leftTop: number, scaleKey: string) => number>((leftTop, scaleKey) => {
        const scale = this.scales[scaleKey];

        if (scale?.min === undefined || scale.max === undefined) {
          return leftTop;
        }

        const dimension = scaleKey === "x" ? 400 : 260;
        return scale.min + (leftTop / dimension) * (scale.max - scale.min);
      });
      this.redraw = vi.fn<(rebuildPaths?: boolean, recalcAxes?: boolean) => void>();
      this.setData = vi.fn<(nextData: unknown[], resetScales?: boolean) => void>((nextData) => {
        this.data = nextData;
      });
      this.setScale = vi.fn<(scaleKey: string, range: { min?: number; max?: number }) => void>(
        (scaleKey, range) => {
          this.options.scales ??= {};
          this.options.scales[scaleKey] = {
            ...this.options.scales[scaleKey],
            ...range,
          };
          this.scales = this.options.scales;
          for (const hook of this.options.hooks?.setScale ?? []) {
            hook(this, scaleKey);
          }
        },
      );
      this.setSeries = vi.fn<(index: number, options: { show: boolean }) => void>();
      this.setSize = vi.fn<(size: { width: number; height: number }) => void>();
      mockUPlot.instances.push(this);
      for (const hook of this.options.hooks.ready ?? []) {
        hook(this);
      }
    }),
  };
});

function mergePluginHooks(options: MockUPlotInstance["options"]): void {
  for (const plugin of options.plugins ?? []) {
    appendHooks(options, "setScale", plugin.hooks.setScale);
    appendHooks(options, "ready", plugin.hooks.ready);
    appendHooks(options, "destroy", plugin.hooks.destroy);
  }
}

function appendHooks<Key extends keyof NonNullable<MockUPlotInstance["options"]["hooks"]>>(
  options: MockUPlotInstance["options"],
  key: Key,
  hooks: NonNullable<MockUPlotPlugin["hooks"][Key]> | undefined,
): void {
  if (hooks === undefined) {
    return;
  }

  options.hooks ??= {};
  const existingHooks = options.hooks[key] ?? [];
  options.hooks[key] = [
    ...existingHooks,
    ...(Array.isArray(hooks) ? hooks : [hooks]),
  ] as NonNullable<MockUPlotInstance["options"]["hooks"]>[Key];
}

export function setupMonitorOutputTest(): void {
  beforeEach(() => {
    mockUPlot.instances.length = 0;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
  });
}

export function createController(): {
  controller: MonitorOutputController;
  root: HTMLElement;
  messages: ToExtensionMessage[];
} {
  const root = document.createElement("section");
  document.body.replaceChildren(root);
  const messages: ToExtensionMessage[] = [];

  return {
    controller: new MonitorOutputController({ root }),
    root,
    messages,
  };
}

export function renderProfile(root: HTMLElement, outputs: readonly OutputConfig[]): void {
  const controller = new MonitorOutputController({ root });
  controller.renderOutputs(outputs);
}

export function createLayout(
  view: NonNullable<LayoutConfig["outputs"][string]["view"]>,
): LayoutConfig {
  return {
    schemaVersion: 1,
    id: "test-layout",
    name: "Test Layout",
    page: { mode: "grid", columns: "auto", density: "normal" },
    outputs: {
      plot: {
        view,
      },
    },
  };
}

export function createOutputs(): OutputConfig[] {
  return [
    {
      id: "raw",
      kind: "terminalAppend",
      title: "Raw Monitor",
      maxLines: 2,
    },
    createTimeSeriesOutput(),
    {
      id: "frame",
      kind: "terminalFrame",
      title: "Latest Status",
      template: "{status}",
    },
    {
      id: "scatter",
      kind: "framePlot2d",
      title: "Scatter",
      bounds: { xMin: -10, xMax: 10, yMin: -5, yMax: 5 },
      points: { field: "points", x: "x", y: "y" },
    },
  ];
}

export function createTimeSeriesOutput(): TimeSeriesLineOutputConfig {
  return {
    id: "plot",
    kind: "timeSeriesLine",
    title: "Plot",
    time: { source: "sequence" },
    series: {
      temp: {
        field: "sensor.temp",
        label: "Temperature",
        unit: "degC",
        color: "#d97706",
      },
      rpm: {
        field: "rpm",
        label: "RPM",
        visible: false,
      },
    },
  };
}

export function latestPlot(): MockUPlotInstance {
  const plot = mockUPlot.instances.at(-1);

  if (plot === undefined) {
    throw new Error("Expected a uPlot instance.");
  }

  return plot;
}
