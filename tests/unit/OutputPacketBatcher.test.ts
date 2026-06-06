import { describe, expect, test, vi } from "vitest";
import { OutputPacketBatcher } from "../../src/session/OutputPacketBatcher";
import type { OutputPacket } from "../../src/shared/protocol";

describe("OutputPacketBatcher", () => {
  test("merges terminal and time-series packets by output id", () => {
    const flushed: OutputPacket[] = [];
    const batcher = new OutputPacketBatcher(50, (packet) => flushed.push(packet));

    batcher.add({
      kind: "terminalAppend",
      outputId: "raw",
      seq: 1,
      receivedAt: 100,
      lines: [{ text: "a" }],
    });
    batcher.add({
      kind: "terminalAppend",
      outputId: "raw",
      seq: 2,
      receivedAt: 110,
      lines: [{ text: "b" }],
    });
    batcher.add({
      kind: "timeSeriesAppend",
      outputId: "plot",
      seq: 1,
      receivedAt: 100,
      samples: [{ time: 0, values: { temp: 20 } }],
    });
    batcher.add({
      kind: "timeSeriesAppend",
      outputId: "plot",
      seq: 2,
      receivedAt: 110,
      samples: [{ time: 0.1, values: { temp: 21 } }],
    });

    batcher.flush();

    expect(flushed).toEqual([
      {
        kind: "terminalAppend",
        outputId: "raw",
        seq: 2,
        receivedAt: 110,
        lines: [{ text: "a" }, { text: "b" }],
      },
      {
        kind: "timeSeriesAppend",
        outputId: "plot",
        seq: 2,
        receivedAt: 110,
        samples: [
          { time: 0, values: { temp: 20 } },
          { time: 0.1, values: { temp: 21 } },
        ],
      },
    ]);
  });

  test("keeps only the latest frame packets", () => {
    const flushed: OutputPacket[] = [];
    const batcher = new OutputPacketBatcher(50, (packet) => flushed.push(packet));

    batcher.add({
      kind: "terminalFrame",
      outputId: "status",
      seq: 1,
      receivedAt: 100,
      frameId: 1,
      text: "old",
    });
    batcher.add({
      kind: "terminalFrame",
      outputId: "status",
      seq: 2,
      receivedAt: 110,
      frameId: 2,
      text: "new",
    });

    batcher.flush();

    expect(flushed).toEqual([
      {
        kind: "terminalFrame",
        outputId: "status",
        seq: 2,
        receivedAt: 110,
        frameId: 2,
        text: "new",
      },
    ]);
  });

  test("flushes on timer", () => {
    vi.useFakeTimers();
    const flushed: OutputPacket[] = [];
    const batcher = new OutputPacketBatcher(50, (packet) => flushed.push(packet));

    batcher.add({
      kind: "terminalAppend",
      outputId: "raw",
      seq: 1,
      receivedAt: 100,
      lines: [{ text: "a" }],
    });
    vi.advanceTimersByTime(50);

    expect(flushed).toHaveLength(1);
    vi.useRealTimers();
  });
});
