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
    legend?: { show?: boolean };
    series: Array<{ label?: string; show?: boolean }>;
  };
  data: unknown[];
  target: HTMLElement;
  destroy: () => void;
  setData: (nextData: unknown[]) => void;
  setSeries: (index: number, options: { show: boolean }) => void;
  setSize: (size: { width: number; height: number }) => void;
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
      this.setData = vi.fn<(nextData: unknown[]) => void>((nextData) => {
        this.data = nextData;
      });
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
    expect(latestPlot().data).toEqual([[1], [22.5], [1200]]);
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
