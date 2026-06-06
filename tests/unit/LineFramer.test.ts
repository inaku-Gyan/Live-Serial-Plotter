import { describe, expect, test } from "vitest";
import { LineFramer } from "../../src/pipeline/LineFramer";

describe("LineFramer", () => {
  test("frames newline-delimited UTF-8 data across chunks", () => {
    const framer = new LineFramer();

    expect(framer.push(Buffer.from("temp=1"), 100)).toEqual([]);
    expect(framer.push(Buffer.from("\nhum=2\r\npartial"), 110)).toEqual([
      { seq: 1, receivedAt: 110, raw: "temp=1" },
      { seq: 2, receivedAt: 110, raw: "hum=2" },
    ]);
    expect(framer.flush(120)).toEqual([{ seq: 3, receivedAt: 120, raw: "partial" }]);
  });

  test("supports explicit carriage-return delimiter", () => {
    const framer = new LineFramer({
      kind: "line",
      encoding: "utf8",
      delimiter: "cr",
    });

    expect(framer.push(Buffer.from("a\rb\r"), 100)).toEqual([
      { seq: 1, receivedAt: 100, raw: "a" },
      { seq: 2, receivedAt: 100, raw: "b" },
    ]);
  });

  test("waits for complete CRLF delimiters", () => {
    const framer = new LineFramer({
      kind: "line",
      encoding: "utf8",
      delimiter: "crlf",
    });

    expect(framer.push(Buffer.from("a\r"), 100)).toEqual([]);
    expect(framer.push(Buffer.from("\nb\r\n"), 110)).toEqual([
      { seq: 1, receivedAt: 110, raw: "a" },
      { seq: 2, receivedAt: 110, raw: "b" },
    ]);
  });

  test("trims frames when configured", () => {
    const framer = new LineFramer({
      kind: "line",
      encoding: "utf8",
      delimiter: "lf",
      trim: true,
    });

    expect(framer.push(Buffer.from("  a  \n"), 100)).toEqual([
      { seq: 1, receivedAt: 100, raw: "a" },
    ]);
  });

  test("drops frames that exceed maxFrameBytes", () => {
    const framer = new LineFramer({
      kind: "line",
      encoding: "utf8",
      delimiter: "lf",
      maxFrameBytes: 4,
    });

    expect(framer.push(Buffer.from("abcde\nok\n"), 100)).toEqual([
      { seq: 1, receivedAt: 100, raw: "ok" },
    ]);
  });
});
