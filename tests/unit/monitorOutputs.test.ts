// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";
import type {
  OutputConfig,
  OutputPacket,
  TimeSeriesLineOutputConfig,
  ToExtensionMessage,
} from "../../src/shared/protocol";
import { MonitorOutputController } from "../../webview/src/monitorOutputs";

interface MockUPlotInstance {
  options: {
    axes?: Array<{ label?: string; side?: number }>;
    hooks?: {
      setScale?: Array<(plot: MockUPlotInstance, scaleKey: string) => void>;
    };
    legend?: { show?: boolean };
    scales?: Record<string, { min?: number; max?: number; time?: boolean }>;
    series: Array<{ label?: string; scale?: string; show?: boolean }>;
  };
  data: unknown[];
  target: HTMLElement;
  destroy: ReturnType<typeof vi.fn<() => void>>;
  setData: ReturnType<typeof vi.fn<(nextData: unknown[], resetScales?: boolean) => void>>;
  setScale: ReturnType<
    typeof vi.fn<(scaleKey: string, range: { min?: number; max?: number }) => void>
  >;
  setSeries: ReturnType<typeof vi.fn<(index: number, options: { show: boolean }) => void>>;
  setSize: ReturnType<typeof vi.fn<(size: { width: number; height: number }) => void>>;
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
      this.data = data;
      this.target = target;
      this.destroy = vi.fn<() => void>();
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
        },
      );
      this.setSeries = vi.fn<(index: number, options: { show: boolean }) => void>();
      this.setSize = vi.fn<(size: { width: number; height: number }) => void>();
      mockUPlot.instances.push(this);
    }),
  };
});

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
    expect(plot.options.series.map((series) => series.show)).toEqual([undefined, true, false]);
    expect(plot.options.legend).toEqual({ show: false });
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
