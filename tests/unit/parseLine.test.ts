import { describe, expect, test } from "vitest";
import { BuiltinLineParser, parseLine } from "../../src/parsers/parseLine";

describe("parseLine", () => {
  test("parses CSV numeric channels", () => {
    expect(parseLine("12.5, -3, 42", "csv")).toEqual({
      values: {
        channel1: 12.5,
        channel2: -3,
        channel3: 42,
      },
    });
  });

  test("rejects malformed CSV lines", () => {
    expect(parseLine("12.5, nope, 42", "csv")).toEqual({ values: {} });
  });

  test("parses numeric top-level JSON Lines fields", () => {
    expect(parseLine('{"temp":23.5,"name":"sensor","humidity":45}', "jsonl")).toEqual({
      values: {
        temp: 23.5,
        humidity: 45,
      },
    });
  });

  test("rejects malformed JSON Lines input", () => {
    expect(parseLine('{"temp":', "jsonl")).toEqual({ values: {} });
  });

  test("parses key=value and key:value tokens", () => {
    expect(parseLine("temp=23.5 humidity:45 rpm=1.2e3", "keyValue")).toEqual({
      values: {
        temp: 23.5,
        humidity: 45,
        rpm: 1200,
      },
    });
  });

  test("auto mode prefers JSON, then key=value, then CSV", () => {
    expect(parseLine('{"x":1,"y":2}', "auto")).toEqual({ values: { x: 1, y: 2 } });
    expect(parseLine("x=1 y=2", "auto")).toEqual({ values: { x: 1, y: 2 } });
    expect(parseLine("1,2", "auto")).toEqual({ values: { channel1: 1, channel2: 2 } });
  });

  test("auto mode ignores empty lines", () => {
    expect(parseLine(" \t", "auto")).toEqual({ values: {} });
  });

  test("auto mode keeps numeric fields from nonnumeric key-value input", () => {
    expect(parseLine("temp=23.5 label=ready humidity=unknown", "auto")).toEqual({
      values: { temp: 23.5 },
    });
  });

  test("auto mode handles a stream that mixes JSON, key-value, and CSV frames", () => {
    const parser = new BuiltinLineParser({ kind: "builtin", mode: "auto" });

    expect(parser.parseFrame({ seq: 1, receivedAt: 100, raw: '{"temp":23}' })).toEqual([
      { fields: { temp: 23 } },
    ]);
    expect(parser.parseFrame({ seq: 2, receivedAt: 110, raw: "rpm=1200" })).toEqual([
      { fields: { rpm: 1200 } },
    ]);
    expect(parser.parseFrame({ seq: 3, receivedAt: 120, raw: "1,2" })).toEqual([
      { fields: { channel1: 1, channel2: 2 } },
    ]);
  });

  test("auto mode ignores invalid JSON without throwing", () => {
    expect(() => parseLine('{"temp":', "auto")).not.toThrow();
    expect(parseLine('{"temp":', "auto")).toEqual({ values: {} });
  });

  test("malformed line keeps parser result empty instead of throwing", () => {
    expect(() => parseLine("plain text", "auto")).not.toThrow();
    expect(parseLine("plain text", "auto")).toEqual({ values: {} });
  });

  test("stateful CSV parser supports first-line headers", () => {
    const parser = new BuiltinLineParser({
      kind: "builtin",
      mode: "csv",
      options: { header: "firstLine" },
    });

    expect(parser.parseFrame({ seq: 1, receivedAt: 100, raw: "temp,humidity" })).toEqual([
      { fields: {} },
    ]);
    expect(parser.parseFrame({ seq: 2, receivedAt: 110, raw: "23.5,45" })).toEqual([
      {
        fields: {
          temp: 23.5,
          humidity: 45,
        },
      },
    ]);
  });

  test("JSON Lines parser can flatten nested fields", () => {
    const parser = new BuiltinLineParser({
      kind: "builtin",
      mode: "jsonl",
      options: { flatten: true },
    });

    expect(
      parser.parseFrame({
        seq: 1,
        receivedAt: 100,
        raw: '{"imu":{"ax":1,"ay":2},"name":"sensor"}',
      }),
    ).toEqual([
      {
        fields: {
          "imu.ax": 1,
          "imu.ay": 2,
          name: "sensor",
        },
      },
    ]);
  });

  test("builtin parser can carry forward previous fields", () => {
    const parser = new BuiltinLineParser({
      kind: "builtin",
      mode: "keyValue",
      options: { carryForward: true },
    });

    expect(parser.parseFrame({ seq: 1, receivedAt: 100, raw: "temp=20 humidity=40" })).toEqual([
      { fields: { temp: 20, humidity: 40 } },
    ]);
    expect(parser.parseFrame({ seq: 2, receivedAt: 110, raw: "temp=21" })).toEqual([
      { fields: { temp: 21, humidity: 40 } },
    ]);
  });
});
