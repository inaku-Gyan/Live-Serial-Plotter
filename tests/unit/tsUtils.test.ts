import { describe, expect, it } from "vitest";
import { assertNever, isPlainObject, stripTrailingCarriageReturn } from "../../src/shared/tsUtils";

describe("tsUtils", () => {
  it("throws an assertion error with context for unreachable values", () => {
    const variant: KnownVariant = { kind: "known" };
    Object.defineProperty(variant, "kind", { value: "extra" });

    expect(() => handleKnownVariant(variant)).toThrow('Unhandled variant: {"kind":"extra"}');
  });

  it("identifies plain object records", () => {
    expect(isPlainObject({ value: 1 })).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject("value")).toBe(false);
    expect(isPlainObject(1)).toBe(false);
  });

  it("removes only one trailing carriage return", () => {
    expect(stripTrailingCarriageReturn("line\r")).toBe("line");
    expect(stripTrailingCarriageReturn("line\r\r")).toBe("line\r");
    expect(stripTrailingCarriageReturn("line")).toBe("line");
  });
});

type KnownVariant = { kind: "known" } | { kind: "other" };

function handleKnownVariant(variant: KnownVariant): string {
  switch (variant.kind) {
    case "known":
      return "known";
    case "other":
      return "other";
    default:
      return assertNever(variant, "Unhandled variant");
  }
}
