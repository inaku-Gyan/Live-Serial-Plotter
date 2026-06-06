import { describe, expect, test } from "vitest";
import { PipelineRunner } from "../../src/pipeline/PipelineRunner";
import { TimeAxisResolver } from "../../src/pipeline/TimeAxisResolver";
import type { OutputPacket, ParsedRecord } from "../../src/shared/protocol";

describe("PipelineRunner", () => {
  test("maps serial frames to terminal and time-series packets", () => {
    const packets: OutputPacket[] = [];
    const runner = new PipelineRunner({
      codec: { kind: "text", encoding: "utf8" },
      framing: { kind: "line", delimiter: "auto" },
      parser: { kind: "builtin", mode: "keyValue" },
      outputs: [
        { id: "raw", kind: "terminalAppend", source: "raw" },
        {
          id: "plot",
          kind: "timeSeriesLine",
          time: { source: "hostReceived", unit: "s", zero: "first" },
          series: {
            temp: { field: "temp", color: "#4cc9f0" },
            rpm: { field: "rpm", scale: 0.1 },
          },
        },
      ],
      onPacket: (packet) => packets.push(packet),
    });

    runner.handleBytes(Buffer.from("temp=21.5 rpm=1200\n"), 1_000);
    runner.handleBytes(Buffer.from("temp=22\n"), 1_100);

    expect(packets).toEqual([
      {
        kind: "terminalAppend",
        outputId: "raw",
        seq: 1,
        receivedAt: 1_000,
        lines: [{ text: "temp=21.5 rpm=1200" }],
      },
      {
        kind: "timeSeriesAppend",
        outputId: "plot",
        seq: 1,
        receivedAt: 1_000,
        samples: [{ time: 0, values: { temp: 21.5, rpm: 120 } }],
      },
      {
        kind: "terminalAppend",
        outputId: "raw",
        seq: 2,
        receivedAt: 1_100,
        lines: [{ text: "temp=22" }],
      },
      {
        kind: "timeSeriesAppend",
        outputId: "plot",
        seq: 2,
        receivedAt: 1_100,
        samples: [{ time: 0.1, values: { temp: 22 } }],
      },
    ]);
  });

  test("supports template terminal output", () => {
    const packets: OutputPacket[] = [];
    const runner = new PipelineRunner({
      codec: { kind: "text", encoding: "utf8" },
      framing: { kind: "line", delimiter: "lf" },
      parser: { kind: "builtin", mode: "jsonl" },
      outputs: [
        {
          id: "events",
          kind: "terminalAppend",
          source: "template",
          template: "#{seq} {level}: {message}",
        },
      ],
      onPacket: (packet) => packets.push(packet),
    });

    runner.handleBytes(Buffer.from('{"level":"warn","message":"hot"}\n'), 1_000);

    expect(packets).toEqual([
      {
        kind: "terminalAppend",
        outputId: "events",
        seq: 1,
        receivedAt: 1_000,
        lines: [{ text: "#1 warn: hot" }],
      },
    ]);
  });
});

describe("TimeAxisResolver", () => {
  const record: ParsedRecord = {
    seq: 10,
    receivedAt: 2_000,
    raw: "",
    fields: {
      time_ms: 150,
    },
  };

  test("uses host received time with first-sample zeroing", () => {
    const resolver = new TimeAxisResolver({ source: "hostReceived", unit: "s", zero: "first" });

    expect(resolver.next({ ...record, receivedAt: 2_000 })).toBe(0);
    expect(resolver.next({ ...record, receivedAt: 2_250 })).toBe(0.25);
  });

  test("uses field time with unit conversion", () => {
    const resolver = new TimeAxisResolver({
      source: "field",
      field: "time_ms",
      unit: "ms",
      zero: "none",
    });

    expect(resolver.next(record)).toBe(0.15);
  });

  test("uses fixed interval and sequence axes", () => {
    const fixed = new TimeAxisResolver({ source: "fixedInterval", intervalMs: 20 });
    const sequence = new TimeAxisResolver({ source: "sequence" });

    expect(fixed.next(record)).toBe(0);
    expect(fixed.next(record)).toBe(0.02);
    expect(sequence.next(record)).toBe(10);
  });
});
