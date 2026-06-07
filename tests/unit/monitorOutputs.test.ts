// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";
import type {
  LayoutConfig,
  OutputConfig,
  OutputPacket,
  TimeSeriesLineOutputConfig,
  ToExtensionMessage,
} from "../../src/shared/protocol";
import { MonitorOutputController } from "../../webview/src/monitorOutputs";

const uPlotPathCacheKey = "_paths";

interface MockUPlotInstance {
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

describe("MonitorOutputController", () => {
  beforeEach(() => {
    mockUPlot.instances.length = 0;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
  });

  test("renders profile outputs as standby panels in profile order", () => {
    const { root } = createController();

    renderProfile(root, createOutputs());

    expect(
      [...root.querySelectorAll(".output-panel")].map((panel) =>
        panel.getAttribute("data-output-id"),
      ),
    ).toEqual(["raw", "plot", "frame", "scatter"]);
    expect(root.querySelector('[data-output-id="raw"]')?.textContent).toContain(
      "Waiting for serial text",
    );
    expect(root.querySelector('[data-output-id="frame"]')?.textContent).toContain(
      "Waiting for frame data",
    );
    expect(root.querySelector('[data-output-id="scatter"] canvas')).not.toBeNull();
  });

  test("precreates configured time-series legend and empty uPlot series", () => {
    const { root } = createController();

    renderProfile(root, [createTimeSeriesOutput()]);

    expect(root.querySelector('[data-output-id="plot"]')?.textContent).toContain(
      "Temperature (degC)",
    );
    expect(root.querySelector('[data-output-id="plot"]')?.textContent).toContain("RPM");

    const plot = latestPlot();
    expect(plot.options.series.map((series) => series.label)).toEqual([
      undefined,
      "Temperature (degC)",
      "RPM",
    ]);
    expect(plot.options.series.map((series) => series.scale)).toEqual([undefined, "y1", "y2"]);
    expect(plot.options.axes?.map((axis) => axis.label)).toEqual([
      "Sequence",
      "Temperature (degC)",
      "Value",
    ]);
    expect(plot.options.axes?.[0]?.space?.(plot, 0, 0, 10, 90)).toBe(22);
    expect(plot.options.axes?.[0]?.space?.(plot, 0, 0, 10, 360)).toBe(60);
    expect(plot.options.axes?.[1]?.space?.(plot, 1, 0, 100, 100)).toBe(18);
    expect(plot.options.axes?.[1]?.space?.(plot, 1, 0, 100, 320)).toBe(40);
    expect(plot.options.series.map((series) => series.show)).toEqual([undefined, true, false]);
    expect(plot.options.legend).toEqual({ show: false });
    expect(plot.options.cursor?.drag).toEqual({ dist: 8, setScale: true, x: true, y: false });
    expect(plot.options.cursor?.points).toEqual({ one: true });
    expect(plot.options.cursor?.focus?.prox).toBe(10);
    expect(plot.options.cursor?.hover?.prox).toBe(10);
    expect(plot.data).toEqual([[], [], []]);
  });

  test("keeps empty-series plots generic until numeric samples arrive", () => {
    const { controller, root } = createController();

    controller.renderOutputs([
      {
        id: "auto",
        kind: "timeSeriesLine",
        title: "Auto Plot",
        time: { source: "sequence" },
        series: {},
      },
    ]);

    expect(root.querySelector('[data-output-id="auto"]')?.textContent).toContain(
      "Waiting for numeric data",
    );
    expect(latestPlot().options.series).toHaveLength(1);

    controller.appendPacket({
      kind: "timeSeriesAppend",
      outputId: "auto",
      seq: 1,
      receivedAt: 1_000,
      samples: [{ time: 1, values: { temp: 22.5, rpm: 1200 } }],
    });

    expect(root.querySelector('[data-output-id="auto"]')?.textContent).toContain("temp");
    expect(root.querySelector('[data-output-id="auto"]')?.textContent).toContain("rpm");
    expect(latestPlot().options.series.map((series) => series.label)).toEqual([
      undefined,
      "temp",
      "rpm",
    ]);
    expect(latestPlot().options.series.map((series) => series.scale)).toEqual([
      undefined,
      "y1",
      "y1",
    ]);
    expect(latestPlot().options.axes?.map((axis) => axis.label)).toEqual(["Sequence", "Value"]);
    expect(latestPlot().data).toEqual([[1], [22.5], [1200]]);
  });

  test("preserves follow state when auto-series discovery rebuilds the plot", () => {
    const { controller, root } = createController();

    controller.renderOutputs([
      {
        id: "auto",
        kind: "timeSeriesLine",
        title: "Auto Plot",
        time: { source: "sequence" },
        series: {},
      },
    ]);
    controller.appendPacket({
      kind: "timeSeriesAppend",
      outputId: "auto",
      seq: 1,
      receivedAt: 1_000,
      samples: [{ time: 1, values: { temp: 22.5 } }],
    });

    const firstPlot = latestPlot();
    const followButton = root.querySelector<HTMLButtonElement>(
      '[data-output-id="auto"] .output-follow-button',
    );

    if (followButton === null) {
      throw new Error("Missing plot follow button.");
    }

    firstPlot.setScale("x", { min: 0, max: 0.5 });
    expect(followButton.textContent).toBe("Follow");

    followButton.click();
    expect(followButton.textContent).toBe("Following");
    expect(firstPlot.setScale).toHaveBeenLastCalledWith("x", { min: 0.5, max: 1 });

    controller.appendPacket({
      kind: "timeSeriesAppend",
      outputId: "auto",
      seq: 2,
      receivedAt: 1_100,
      samples: [{ time: 2, values: { temp: 23, rpm: 1200 } }],
    });

    const rebuiltPlot = latestPlot();
    expect(rebuiltPlot).not.toBe(firstPlot);
    expect(followButton.textContent).toBe("Following");
    expect(rebuiltPlot.options.series.map((series) => series.label)).toEqual([
      undefined,
      "temp",
      "rpm",
    ]);
    expect(rebuiltPlot.setScale).toHaveBeenLastCalledWith("x", { min: 1.5, max: 2 });
  });

  test("keeps a rolling points window and tracks the latest x range", () => {
    const { controller } = createController();
    controller.renderOutputs([
      {
        ...createTimeSeriesOutput(),
        window: { mode: "points", maxPoints: 3 },
      },
    ]);

    controller.appendPacket({
      kind: "timeSeriesAppend",
      outputId: "plot",
      seq: 1,
      receivedAt: 1_000,
      samples: [
        { time: 0, values: { temp: 20, rpm: 1 } },
        { time: 1, values: { temp: 21, rpm: 2 } },
        { time: 2, values: { temp: 22, rpm: 3 } },
        { time: 3, values: { temp: 23, rpm: 4 } },
      ],
    });

    const plot = latestPlot();
    expect(plot.data).toEqual([
      [1, 2, 3],
      [21, 22, 23],
      [2, 3, 4],
    ]);
    expect(plot.setScale).toHaveBeenLastCalledWith("x", { min: 1, max: 3 });
  });

  test("invalidates cached uPlot paths when appending data in auto-follow mode", () => {
    const { controller } = createController();
    controller.renderOutputs([
      {
        ...createTimeSeriesOutput(),
        window: { mode: "points", maxPoints: 3 },
      },
    ]);
    controller.appendPacket({
      kind: "timeSeriesAppend",
      outputId: "plot",
      seq: 1,
      receivedAt: 1_000,
      samples: [
        { time: 0, values: { temp: 20, rpm: 1 } },
        { time: 1, values: { temp: 21, rpm: 2 } },
        { time: 2, values: { temp: 22, rpm: 3 } },
      ],
    });
    const plot = latestPlot();
    plot.series[1][uPlotPathCacheKey] = { stale: true };
    plot.series[1].points = { [uPlotPathCacheKey]: { stale: true } };
    plot.series[2][uPlotPathCacheKey] = { stale: true };

    controller.appendPacket({
      kind: "timeSeriesAppend",
      outputId: "plot",
      seq: 2,
      receivedAt: 1_100,
      samples: [{ time: 3, values: { temp: 23, rpm: 4 } }],
    });

    expect(plot.series[1][uPlotPathCacheKey]).toBeNull();
    expect(plot.series[1].points?.[uPlotPathCacheKey]).toBeNull();
    expect(plot.series[2][uPlotPathCacheKey]).toBeNull();
    expect(plot.setScale).toHaveBeenLastCalledWith("x", { min: 1, max: 3 });
  });

  test("uses a fixed points window range before the window fills", () => {
    const { controller } = createController();
    controller.renderOutputs([
      {
        ...createTimeSeriesOutput(),
        window: { mode: "points", maxPoints: 4 },
      },
    ]);

    controller.appendPacket({
      kind: "timeSeriesAppend",
      outputId: "plot",
      seq: 1,
      receivedAt: 1_000,
      samples: [
        { time: 0, values: { temp: 20, rpm: 1 } },
        { time: 1, values: { temp: 21, rpm: 2 } },
      ],
    });

    const plot = latestPlot();
    expect(plot.data).toEqual([
      [0, 1],
      [20, 21],
      [1, 2],
    ]);
    expect(plot.setScale).toHaveBeenLastCalledWith("x", { min: -2, max: 1 });
  });

  test("caps the default visible x range while retaining the configured point buffer", () => {
    const { controller } = createController();
    controller.renderOutputs([
      {
        ...createTimeSeriesOutput(),
        window: { mode: "points", maxPoints: 1_000 },
      },
    ]);

    controller.appendPacket({
      kind: "timeSeriesAppend",
      outputId: "plot",
      seq: 1,
      receivedAt: 1_000,
      samples: [
        { time: 0, values: { temp: 20, rpm: 1 } },
        { time: 1, values: { temp: 21, rpm: 2 } },
      ],
    });

    const plot = latestPlot();
    expect(plot.data[0]).toEqual([0, 1]);
    expect(plot.setScale).toHaveBeenLastCalledWith("x", { min: -298, max: 1 });
  });

  test("keeps a rolling duration window and tracks the latest x range", () => {
    const { controller } = createController();
    controller.renderOutputs([
      {
        ...createTimeSeriesOutput(),
        window: { mode: "duration", seconds: 2 },
      },
    ]);

    controller.appendPacket({
      kind: "timeSeriesAppend",
      outputId: "plot",
      seq: 1,
      receivedAt: 1_000,
      samples: [
        { time: 0, values: { temp: 20, rpm: 1 } },
        { time: 1, values: { temp: 21, rpm: 2 } },
        { time: 3, values: { temp: 23, rpm: 4 } },
        { time: 4, values: { temp: 24, rpm: 5 } },
      ],
    });

    const plot = latestPlot();
    expect(plot.data).toEqual([
      [3, 4],
      [23, 24],
      [4, 5],
    ]);
    expect(plot.setScale).toHaveBeenLastCalledWith("x", { min: 2, max: 4 });
  });

  test("preserves manual zoom instead of snapping back to the rolling x range", () => {
    const { controller } = createController();
    controller.renderOutputs([
      {
        ...createTimeSeriesOutput(),
        window: { mode: "points", maxPoints: 3 },
      },
    ]);
    controller.appendPacket({
      kind: "timeSeriesAppend",
      outputId: "plot",
      seq: 1,
      receivedAt: 1_000,
      samples: [
        { time: 0, values: { temp: 20, rpm: 1 } },
        { time: 1, values: { temp: 21, rpm: 2 } },
        { time: 2, values: { temp: 22, rpm: 3 } },
      ],
    });
    const plot = latestPlot();
    const setScaleCallCount = plot.setScale.mock.calls.length;

    plot.options.hooks?.setScale?.[0]?.(plot, "x");
    controller.appendPacket({
      kind: "timeSeriesAppend",
      outputId: "plot",
      seq: 2,
      receivedAt: 1_100,
      samples: [{ time: 3, values: { temp: 23, rpm: 4 } }],
    });

    expect(plot.data).toEqual([
      [1, 2, 3],
      [21, 22, 23],
      [2, 3, 4],
    ]);
    expect(plot.setScale).toHaveBeenCalledTimes(setScaleCallCount);
    expect(plot.setData).toHaveBeenLastCalledWith(
      [
        [1, 2, 3],
        [21, 22, 23],
        [2, 3, 4],
      ],
      false,
    );
    expect(plot.redraw).toHaveBeenLastCalledWith(true, false);
  });

  test("resumes auto-follow from the plot header without clearing data or legend state", () => {
    const { controller, root } = createController();
    controller.renderOutputs([
      {
        ...createTimeSeriesOutput(),
        window: { mode: "points", maxPoints: 3 },
      },
    ]);
    controller.appendPacket({
      kind: "timeSeriesAppend",
      outputId: "plot",
      seq: 1,
      receivedAt: 1_000,
      samples: [
        { time: 0, values: { temp: 20, rpm: 1 } },
        { time: 1, values: { temp: 21, rpm: 2 } },
        { time: 2, values: { temp: 22, rpm: 3 } },
      ],
    });
    const plot = latestPlot();
    const rpmCheckbox = root.querySelector<HTMLInputElement>(
      '[data-output-id="plot"] .legend-item:nth-child(2) input',
    );
    const followButton = root.querySelector<HTMLButtonElement>(
      '[data-output-id="plot"] .output-follow-button',
    );

    if (rpmCheckbox === null || followButton === null) {
      throw new Error("Missing plot follow controls.");
    }

    rpmCheckbox.checked = true;
    rpmCheckbox.dispatchEvent(new Event("change"));
    plot.scales.y1 = { min: 10, max: 30 };
    plot.setScale("x", { min: 1.5, max: 2 });
    controller.appendPacket({
      kind: "timeSeriesAppend",
      outputId: "plot",
      seq: 2,
      receivedAt: 1_100,
      samples: [{ time: 3, values: { temp: 23, rpm: 4 } }],
    });

    expect(plot.setData).toHaveBeenLastCalledWith(
      [
        [1, 2, 3],
        [21, 22, 23],
        [2, 3, 4],
      ],
      false,
    );

    followButton.click();
    expect(plot.data).toEqual([
      [1, 2, 3],
      [21, 22, 23],
      [2, 3, 4],
    ]);
    expect(rpmCheckbox.checked).toBe(true);
    expect(plot.scales.y1).toEqual({ min: 10, max: 30 });
    expect(plot.setScale).toHaveBeenLastCalledWith("x", { min: 2.5, max: 3 });

    controller.appendPacket({
      kind: "timeSeriesAppend",
      outputId: "plot",
      seq: 3,
      receivedAt: 1_200,
      samples: [{ time: 4, values: { temp: 24, rpm: 5 } }],
    });

    expect(plot.setData).toHaveBeenLastCalledWith(
      [
        [2, 3, 4],
        [22, 23, 24],
        [3, 4, 5],
      ],
      false,
    );
    expect(plot.scales.y1).toEqual({ min: 10, max: 30 });
    expect(plot.setScale).toHaveBeenLastCalledWith("x", { min: 3.5, max: 4 });
  });

  test("keeps following after resuming from a saved zoom layout", () => {
    const { controller, root } = createController();
    controller.renderOutputs(
      [
        {
          ...createTimeSeriesOutput(),
          window: { mode: "points", maxPoints: 3 },
        },
      ],
      createLayout({
        kind: "timeSeriesLine",
        autoFollow: false,
        zoom: { x: { min: 10, max: 20 } },
      }),
    );
    controller.appendPacket({
      kind: "timeSeriesAppend",
      outputId: "plot",
      seq: 1,
      receivedAt: 1_000,
      samples: [
        { time: 0, values: { temp: 20, rpm: 1 } },
        { time: 1, values: { temp: 21, rpm: 2 } },
        { time: 2, values: { temp: 22, rpm: 3 } },
      ],
    });
    const plot = latestPlot();
    const followButton = root.querySelector<HTMLButtonElement>(
      '[data-output-id="plot"] .output-follow-button',
    );

    if (followButton === null) {
      throw new Error("Missing plot follow button.");
    }

    expect(followButton.textContent).toBe("Follow");

    followButton.click();
    expect(followButton.textContent).toBe("Following");
    expect(plot.setScale).toHaveBeenLastCalledWith("x", { min: -8, max: 2 });

    controller.appendPacket({
      kind: "timeSeriesAppend",
      outputId: "plot",
      seq: 2,
      receivedAt: 1_100,
      samples: [{ time: 3, values: { temp: 23, rpm: 4 } }],
    });

    expect(followButton.textContent).toBe("Following");
    expect(plot.setScale).toHaveBeenLastCalledWith("x", { min: -7, max: 3 });
  });

  test("uses one plot header button for follow, following, and locked follow states", () => {
    const { controller, root } = createController();
    controller.renderOutputs([
      {
        ...createTimeSeriesOutput(),
        window: { mode: "points", maxPoints: 3 },
      },
    ]);
    controller.appendPacket({
      kind: "timeSeriesAppend",
      outputId: "plot",
      seq: 1,
      receivedAt: 1_000,
      samples: [
        { time: 0, values: { temp: 20, rpm: 1 } },
        { time: 1, values: { temp: 21, rpm: 2 } },
        { time: 2, values: { temp: 22, rpm: 3 } },
      ],
    });
    const plot = latestPlot();
    const followButton = root.querySelector<HTMLButtonElement>(
      '[data-output-id="plot"] .output-follow-button',
    );

    if (followButton === null) {
      throw new Error("Missing plot follow button.");
    }

    expect(followButton.textContent).toBe("Following");
    expect(followButton.getAttribute("aria-pressed")).toBe("false");

    followButton.click();
    expect(followButton.textContent).toBe("Locked Follow");
    expect(followButton.getAttribute("aria-pressed")).toBe("true");

    plot.setScale("x", { min: 1.5, max: 2 });
    expect(followButton.textContent).toBe("Locked Follow");
    expect(followButton.getAttribute("aria-pressed")).toBe("true");

    followButton.click();
    expect(followButton.textContent).toBe("Following");
    expect(followButton.getAttribute("aria-pressed")).toBe("false");

    plot.setScale("x", { min: 1.5, max: 2 });
    expect(followButton.textContent).toBe("Follow");

    followButton.click();
    expect(followButton.textContent).toBe("Following");
    expect(plot.setScale).toHaveBeenLastCalledWith("x", { min: 1.5, max: 2 });
  });

  test("resumes locked follow after a debounce while preserving x span and y ranges", () => {
    vi.useFakeTimers();

    try {
      const { controller, root } = createController();
      controller.renderOutputs(
        [
          {
            ...createTimeSeriesOutput(),
            window: { mode: "points", maxPoints: 5 },
          },
        ],
        createLayout({
          kind: "timeSeriesLine",
          followMode: "locked",
        }),
      );
      controller.appendPacket({
        kind: "timeSeriesAppend",
        outputId: "plot",
        seq: 1,
        receivedAt: 1_000,
        samples: [
          { time: 0, values: { temp: 20, rpm: 1 } },
          { time: 1, values: { temp: 21, rpm: 2 } },
          { time: 2, values: { temp: 22, rpm: 3 } },
        ],
      });
      const plot = latestPlot();
      const followButton = root.querySelector<HTMLButtonElement>(
        '[data-output-id="plot"] .output-follow-button',
      );

      if (followButton === null) {
        throw new Error("Missing plot follow button.");
      }

      expect(followButton.textContent).toBe("Locked Follow");
      plot.scales.y1 = { min: 10, max: 30 };
      plot.setScale("x", { min: 1.25, max: 2 });
      plot.setScale("y1", { min: 15, max: 35 });
      expect(followButton.textContent).toBe("Locked Follow");

      controller.appendPacket({
        kind: "timeSeriesAppend",
        outputId: "plot",
        seq: 2,
        receivedAt: 1_100,
        samples: [{ time: 3, values: { temp: 23, rpm: 4 } }],
      });

      expect(plot.setData).toHaveBeenLastCalledWith(
        [
          [0, 1, 2, 3],
          [20, 21, 22, 23],
          [1, 2, 3, 4],
        ],
        false,
      );
      expect(plot.scales.y1).toEqual({ min: 15, max: 35 });

      vi.advanceTimersByTime(349);
      expect(followButton.textContent).toBe("Locked Follow");

      vi.advanceTimersByTime(1);
      expect(followButton.textContent).toBe("Locked Follow");
      expect(plot.setScale).toHaveBeenLastCalledWith("x", { min: 2.25, max: 3 });
      expect(plot.scales.y1).toEqual({ min: 15, max: 35 });
    } finally {
      vi.useRealTimers();
    }
  });

  test("captures and restores locked follow mode in saved layouts", () => {
    const { controller, root } = createController();
    controller.renderOutputs([createTimeSeriesOutput()]);
    const followButton = root.querySelector<HTMLButtonElement>(
      '[data-output-id="plot"] .output-follow-button',
    );

    if (followButton === null) {
      throw new Error("Missing plot follow button.");
    }

    followButton.click();

    expect(controller.captureSavableViewState().outputs.plot?.view).toMatchObject({
      kind: "timeSeriesLine",
      followMode: "locked",
      autoFollow: true,
    });

    controller.renderOutputs(
      [createTimeSeriesOutput()],
      createLayout({
        kind: "timeSeriesLine",
        followMode: "locked",
      }),
    );

    const restoredFollowButton = root.querySelector<HTMLButtonElement>(
      '[data-output-id="plot"] .output-follow-button',
    );
    expect(restoredFollowButton?.textContent).toBe("Locked Follow");
  });

  test("zooms the x and y ranges with ctrl wheel through the uPlot interaction config", () => {
    const { controller } = createController();
    controller.renderOutputs([
      {
        ...createTimeSeriesOutput(),
        window: { mode: "points", maxPoints: 3 },
      },
    ]);
    controller.appendPacket({
      kind: "timeSeriesAppend",
      outputId: "plot",
      seq: 1,
      receivedAt: 1_000,
      samples: [
        { time: 0, values: { temp: 20, rpm: 1 } },
        { time: 1, values: { temp: 21, rpm: 2 } },
        { time: 2, values: { temp: 22, rpm: 3 } },
      ],
    });
    const plot = latestPlot();
    const setScaleCallCount = plot.setScale.mock.calls.length;
    plot.scales.y1 = { min: 0, max: 100 };

    plot.over.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: 200,
        clientY: 130,
        ctrlKey: true,
        deltaY: -100,
      }),
    );

    expect(plot.setScale).toHaveBeenCalledWith("x", {
      min: 0.5,
      max: 1.5,
    });
    expect(plot.setScale).toHaveBeenCalledWith("y1", {
      min: 25,
      max: 75,
    });

    controller.appendPacket({
      kind: "timeSeriesAppend",
      outputId: "plot",
      seq: 2,
      receivedAt: 1_100,
      samples: [{ time: 3, values: { temp: 23, rpm: 4 } }],
    });

    expect(plot.setScale).toHaveBeenCalledTimes(setScaleCallCount + 2);
    expect(plot.setData).toHaveBeenLastCalledWith(
      [
        [1, 2, 3],
        [21, 22, 23],
        [2, 3, 4],
      ],
      false,
    );
    expect(plot.redraw).toHaveBeenLastCalledWith(true, false);
  });

  test("pans y scales with ordinary wheel through the uPlot interaction config", () => {
    const { controller } = createController();
    controller.renderOutputs([
      {
        ...createTimeSeriesOutput(),
        window: { mode: "points", maxPoints: 3 },
      },
    ]);
    controller.appendPacket({
      kind: "timeSeriesAppend",
      outputId: "plot",
      seq: 1,
      receivedAt: 1_000,
      samples: [
        { time: 0, values: { temp: 20, rpm: 1 } },
        { time: 1, values: { temp: 21, rpm: 2 } },
        { time: 2, values: { temp: 22, rpm: 3 } },
      ],
    });
    const plot = latestPlot();
    plot.scales.y1 = { min: 0, max: 100 };
    plot.scales.y2 = { min: 200, max: 300 };

    plot.over.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: 26,
      }),
    );

    expect(plot.setScale).toHaveBeenCalledWith("y1", { min: 10, max: 110 });
    expect(plot.setScale).toHaveBeenCalledWith("y2", { min: 210, max: 310 });
  });

  test("pans the x range with shift wheel through the uPlot interaction config", () => {
    const { controller } = createController();
    controller.renderOutputs([
      {
        ...createTimeSeriesOutput(),
        window: { mode: "points", maxPoints: 3 },
      },
    ]);
    controller.appendPacket({
      kind: "timeSeriesAppend",
      outputId: "plot",
      seq: 1,
      receivedAt: 1_000,
      samples: [
        { time: 0, values: { temp: 20, rpm: 1 } },
        { time: 1, values: { temp: 21, rpm: 2 } },
        { time: 2, values: { temp: 22, rpm: 3 } },
      ],
    });
    const plot = latestPlot();

    plot.over.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: 40,
        shiftKey: true,
      }),
    );

    const panCall = plot.setScale.mock.calls.at(-1);
    expect(panCall?.[0]).toBe("x");
    expect(panCall?.[1].min).toBeCloseTo(0.2);
    expect(panCall?.[1].max).toBeCloseTo(2.2);
  });

  test("pans both axes with touchpad wheel deltas through the uPlot interaction config", () => {
    const { controller } = createController();
    controller.renderOutputs([
      {
        ...createTimeSeriesOutput(),
        window: { mode: "points", maxPoints: 3 },
      },
    ]);
    controller.appendPacket({
      kind: "timeSeriesAppend",
      outputId: "plot",
      seq: 1,
      receivedAt: 1_000,
      samples: [
        { time: 0, values: { temp: 20, rpm: 1 } },
        { time: 1, values: { temp: 21, rpm: 2 } },
        { time: 2, values: { temp: 22, rpm: 3 } },
      ],
    });
    const plot = latestPlot();
    plot.scales.y1 = { min: 0, max: 100 };

    plot.over.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaX: 40,
        deltaY: 26,
      }),
    );

    expect(plot.setScale).toHaveBeenCalledWith("x", {
      min: 0.2,
      max: 2.2,
    });
    expect(plot.setScale).toHaveBeenCalledWith("y1", { min: 10, max: 110 });
  });

  test("pinch-zooms x and y ranges with the uPlot pointer interaction plugin", () => {
    const { controller } = createController();
    controller.renderOutputs([
      {
        ...createTimeSeriesOutput(),
        window: { mode: "points", maxPoints: 3 },
      },
    ]);
    controller.appendPacket({
      kind: "timeSeriesAppend",
      outputId: "plot",
      seq: 1,
      receivedAt: 1_000,
      samples: [
        { time: 0, values: { temp: 20, rpm: 1 } },
        { time: 1, values: { temp: 21, rpm: 2 } },
        { time: 2, values: { temp: 22, rpm: 3 } },
      ],
    });
    const plot = latestPlot();
    plot.scales.y1 = { min: 0, max: 100 };

    plot.over.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        clientX: 150,
        clientY: 130,
        pointerId: 1,
        pointerType: "touch",
      }),
    );
    plot.over.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        clientX: 250,
        clientY: 130,
        pointerId: 2,
        pointerType: "touch",
      }),
    );
    plot.over.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: 300,
        clientY: 130,
        pointerId: 2,
        pointerType: "touch",
      }),
    );

    expect(plot.setScale).toHaveBeenCalledWith("x", {
      min: 0.25,
      max: 1.5833333333333333,
    });
    const yZoomCall = plot.setScale.mock.calls.find((call) => call[0] === "y1");
    expect(yZoomCall?.[1].min).toBeCloseTo(16.666666666666664);
    expect(yZoomCall?.[1].max).toBeCloseTo(83.33333333333334);
  });

  test("pans x and y ranges with the uPlot pointer interaction plugin", () => {
    const { controller } = createController();
    controller.renderOutputs([
      {
        ...createTimeSeriesOutput(),
        window: { mode: "points", maxPoints: 3 },
      },
    ]);
    controller.appendPacket({
      kind: "timeSeriesAppend",
      outputId: "plot",
      seq: 1,
      receivedAt: 1_000,
      samples: [
        { time: 0, values: { temp: 20, rpm: 1 } },
        { time: 1, values: { temp: 21, rpm: 2 } },
        { time: 2, values: { temp: 22, rpm: 3 } },
      ],
    });
    const plot = latestPlot();
    plot.scales.y1 = { min: 0, max: 100 };

    plot.over.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 1,
        clientX: 200,
        clientY: 100,
        pointerId: 1,
        pointerType: "mouse",
      }),
    );
    plot.over.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: 240,
        clientY: 126,
        pointerId: 1,
        pointerType: "mouse",
      }),
    );
    plot.over.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 1,
        pointerType: "mouse",
      }),
    );

    expect(plot.setScale).toHaveBeenCalledWith("x", {
      min: -0.2,
      max: 1.8,
    });
    expect(plot.setScale).toHaveBeenCalledWith("y1", {
      min: 10,
      max: 110,
    });
  });

  test("resets plot view without clearing data", () => {
    const { controller, root } = createController();
    controller.renderOutputs([
      {
        ...createTimeSeriesOutput(),
        window: { mode: "points", maxPoints: 3 },
      },
    ]);
    controller.appendPacket({
      kind: "timeSeriesAppend",
      outputId: "plot",
      seq: 1,
      receivedAt: 1_000,
      samples: [
        { time: 0, values: { temp: 20, rpm: 1 } },
        { time: 1, values: { temp: 21, rpm: 2 } },
        { time: 2, values: { temp: 22, rpm: 3 } },
      ],
    });
    const plot = latestPlot();
    const rpmCheckbox = root.querySelector<HTMLInputElement>(
      '[data-output-id="plot"] .legend-item:nth-child(2) input',
    );

    if (rpmCheckbox === null) {
      throw new Error("Missing RPM checkbox.");
    }

    rpmCheckbox.checked = true;
    rpmCheckbox.dispatchEvent(new Event("change"));
    plot.options.hooks?.setScale?.[0]?.(plot, "x");

    controller.resetOutputView("plot");

    expect(plot.data).toEqual([
      [0, 1, 2],
      [20, 21, 22],
      [1, 2, 3],
    ]);
    expect(plot.setSeries).toHaveBeenLastCalledWith(2, { show: false });
    expect(plot.setScale).toHaveBeenLastCalledWith("x", { min: 0, max: 2 });
  });

  test("resets the plot view with the uPlot double-click interaction plugin", () => {
    const { controller } = createController();
    controller.renderOutputs([
      {
        ...createTimeSeriesOutput(),
        window: { mode: "points", maxPoints: 3 },
      },
    ]);
    controller.appendPacket({
      kind: "timeSeriesAppend",
      outputId: "plot",
      seq: 1,
      receivedAt: 1_000,
      samples: [
        { time: 0, values: { temp: 20, rpm: 1 } },
        { time: 1, values: { temp: 21, rpm: 2 } },
        { time: 2, values: { temp: 22, rpm: 3 } },
      ],
    });
    const plot = latestPlot();

    plot.over.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: 200,
        deltaY: -100,
      }),
    );
    plot.over.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));

    expect(plot.data).toEqual([
      [0, 1, 2],
      [20, 21, 22],
      [1, 2, 3],
    ]);
    expect(plot.setScale).toHaveBeenLastCalledWith("x", { min: 0, max: 2 });
  });

  test("routes output packets by outputId", () => {
    const { controller, root } = createController();
    controller.renderOutputs(createOutputs());

    const packets: OutputPacket[] = [
      {
        kind: "terminalAppend",
        outputId: "raw",
        seq: 1,
        receivedAt: 1_000,
        lines: [{ text: "temp=22" }],
      },
      {
        kind: "terminalFrame",
        outputId: "frame",
        seq: 2,
        receivedAt: 1_100,
        frameId: "status",
        text: "OK",
      },
      {
        kind: "timeSeriesAppend",
        outputId: "plot",
        seq: 3,
        receivedAt: 1_200,
        samples: [{ time: 0, values: { temp: 22, rpm: 10 } }],
      },
      {
        kind: "framePlot2d",
        outputId: "scatter",
        seq: 4,
        receivedAt: 1_300,
        frameId: 4,
        layers: [{ kind: "points", points: [{ x: 1, y: 2 }] }],
      },
    ];

    for (const packet of packets) {
      controller.appendPacket(packet);
    }

    expect(root.querySelector('[data-output-id="raw"]')?.textContent).toContain("temp=22");
    expect(root.querySelector('[data-output-id="frame"]')?.textContent).toContain("OK");
    expect(latestPlot().data).toEqual([[0], [22], [10]]);
  });

  test("switching profiles clears previous output state and layout", () => {
    const { controller, root } = createController();
    controller.renderOutputs(createOutputs());
    controller.appendPacket({
      kind: "terminalAppend",
      outputId: "raw",
      seq: 1,
      receivedAt: 1_000,
      lines: [{ text: "old line" }],
    });

    controller.renderOutputs([
      {
        id: "next",
        kind: "terminalAppend",
        title: "Next",
      },
    ]);

    expect(root.querySelector('[data-output-id="raw"]')).toBeNull();
    expect(root.querySelector('[data-output-id="next"]')?.textContent).toContain(
      "Waiting for serial text",
    );
    expect(root.textContent).not.toContain("old line");
  });
});

function createController(): {
  controller: MonitorOutputController;
  root: HTMLElement;
  messages: ToExtensionMessage[];
} {
  const root = document.createElement("section");
  document.body.replaceChildren(root);
  const messages: ToExtensionMessage[] = [];

  return {
    controller: new MonitorOutputController({
      root,
      postMessage: (message) => messages.push(message),
    }),
    root,
    messages,
  };
}

function renderProfile(root: HTMLElement, outputs: readonly OutputConfig[]): void {
  const messages: ToExtensionMessage[] = [];
  const controller = new MonitorOutputController({
    root,
    postMessage: (message) => messages.push(message),
  });
  controller.renderOutputs(outputs);
}

function createLayout(view: NonNullable<LayoutConfig["outputs"][string]["view"]>): LayoutConfig {
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

function createOutputs(): OutputConfig[] {
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

function createTimeSeriesOutput(): TimeSeriesLineOutputConfig {
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

function latestPlot(): MockUPlotInstance {
  const plot = mockUPlot.instances.at(-1);

  if (plot === undefined) {
    throw new Error("Expected a uPlot instance.");
  }

  return plot;
}
