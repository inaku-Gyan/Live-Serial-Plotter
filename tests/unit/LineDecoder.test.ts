import { describe, expect, test } from "vitest";
import { LineDecoder } from "../../src/serial/LineDecoder";

describe("LineDecoder", () => {
  test("decodes newline-delimited UTF-8 data across chunks", () => {
    const decoder = new LineDecoder();

    expect(decoder.push(Buffer.from("temp=1"))).toEqual([]);
    expect(decoder.push(Buffer.from("\nhum=2\r\npartial"))).toEqual(["temp=1", "hum=2"]);
    expect(decoder.flush()).toEqual(["partial"]);
  });
});
