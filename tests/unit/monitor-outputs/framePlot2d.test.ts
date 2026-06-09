// @vitest-environment jsdom

import { describe, expect, test, vi } from "vitest";
import { createController, setupMonitorOutputTest } from "./helpers/monitorOutputTestHarness";

setupMonitorOutputTest();

describe("frame plot monitor output", () => {
  test("renders standby frame plot and routes frame packets", () => {
    const { controller, root } = createController();
    const fillText = vi.fn<CanvasRenderingContext2D["fillText"]>();
    const arc = vi.fn<CanvasRenderingContext2D["arc"]>();
    const context = {
      setTransform: vi.fn<CanvasRenderingContext2D["setTransform"]>(),
      clearRect: vi.fn<CanvasRenderingContext2D["clearRect"]>(),
      strokeRect: vi.fn<CanvasRenderingContext2D["strokeRect"]>(),
      beginPath: vi.fn<CanvasRenderingContext2D["beginPath"]>(),
      moveTo: vi.fn<CanvasRenderingContext2D["moveTo"]>(),
      lineTo: vi.fn<CanvasRenderingContext2D["lineTo"]>(),
      stroke: vi.fn<CanvasRenderingContext2D["stroke"]>(),
      fillText,
      arc,
      fill: vi.fn<CanvasRenderingContext2D["fill"]>(),
      set strokeStyle(_value: string) {},
      set lineWidth(_value: number) {},
      set fillStyle(_value: string) {},
      set font(_value: string) {},
      set textAlign(_value: string) {},
    };

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- jsdom has no real 2D canvas implementation.
      context as unknown as CanvasRenderingContext2D,
    );
    controller.renderOutputs([
      {
        id: "scatter",
        kind: "framePlot2d",
        title: "Scatter",
        bounds: { xMin: -10, xMax: 10, yMin: -5, yMax: 5 },
        points: { field: "points", x: "x", y: "y" },
      },
    ]);

    expect(root.querySelector('[data-output-id="scatter"]')).not.toBeNull();
    expect(fillText).toHaveBeenCalledWith("Waiting for frame points", 160, 130);

    controller.appendPacket({
      kind: "framePlot2d",
      outputId: "scatter",
      seq: 1,
      receivedAt: 1_000,
      frameId: 1,
      layers: [{ kind: "points", points: [{ x: 1, y: 2 }] }],
    });

    expect(arc).toHaveBeenCalled();
  });
});
