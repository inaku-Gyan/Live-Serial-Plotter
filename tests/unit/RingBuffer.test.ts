import { describe, expect, test } from "vitest";
import { RingBuffer } from "../../src/session/RingBuffer";

describe("RingBuffer", () => {
  test("keeps only the most recent items within capacity", () => {
    const buffer = new RingBuffer<number>(3);

    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    buffer.push(4);

    expect(buffer.toArray()).toEqual([2, 3, 4]);
    expect(buffer.length).toBe(3);
  });

  test("pushMany applies the same capacity limit", () => {
    const buffer = new RingBuffer<string>(2);

    buffer.pushMany(["a", "b", "c"]);

    expect(buffer.toArray()).toEqual(["b", "c"]);
  });

  test("clear removes all buffered items", () => {
    const buffer = new RingBuffer<number>(2);

    buffer.pushMany([1, 2]);
    buffer.clear();

    expect(buffer.toArray()).toEqual([]);
    expect(buffer.length).toBe(0);
  });

  test("rejects invalid capacity", () => {
    expect(() => new RingBuffer(0)).toThrow("capacity");
  });
});
