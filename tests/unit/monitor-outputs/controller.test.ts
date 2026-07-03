// @vitest-environment jsdom

import { describe, expect, test } from "vitest";
import type { OutputPacket } from "../../../src/shared/protocol";
import {
  createController,
  createOutputs,
  latestPlot,
  renderProfile,
  setupMonitorOutputTest,
} from "./helpers/monitorOutputTestHarness";

setupMonitorOutputTest();

describe("DomOutputGridController", () => {
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
