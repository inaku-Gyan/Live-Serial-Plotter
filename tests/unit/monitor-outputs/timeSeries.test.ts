// @vitest-environment jsdom

import { describe, expect, test, vi } from "vitest";
import {
  createController,
  createLayout,
  createTimeSeriesOutput,
  latestPlot,
  renderProfile,
  setupMonitorOutputTest,
} from "./helpers/monitorOutputTestHarness";

const uPlotPathCacheKey = "_paths";

setupMonitorOutputTest();

describe("time-series monitor output", () => {
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

    expect(controller.captureSavableViewState().outputs.plot?.viewState).toMatchObject({
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

  test("zooms inferred y ranges when uPlot keeps y scales auto-ranged", () => {
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

    expect(plot.scales.y1).toEqual({});

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
      min: 20.5,
      max: 21.5,
    });
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

    expect(plot.setScale).toHaveBeenCalledWith("y1", { min: -10, max: 90 });
    expect(plot.setScale).toHaveBeenCalledWith("y2", { min: 190, max: 290 });
  });

  test("pans inferred y ranges when uPlot keeps y scales auto-ranged", () => {
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

    expect(plot.scales.y1).toEqual({});

    plot.over.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: 26,
      }),
    );

    expect(plot.setScale).toHaveBeenCalledWith("y1", {
      min: 19.8,
      max: 21.8,
    });
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
    expect(plot.setScale).toHaveBeenCalledWith("y1", { min: -10, max: 90 });
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
      min: -10,
      max: 90,
    });
  });

  test("pans inferred y ranges with the uPlot pointer interaction plugin", () => {
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

    expect(plot.scales.y1).toEqual({});

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

    expect(plot.setScale).toHaveBeenCalledWith("x", {
      min: -0.2,
      max: 1.8,
    });
    expect(plot.setScale).toHaveBeenCalledWith("y1", {
      min: 19.8,
      max: 21.8,
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
});
