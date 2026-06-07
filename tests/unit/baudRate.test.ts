import { describe, expect, test } from "vitest";
import { isBaudRateInputValid, parseBaudRateInput } from "../../webview/src/baudRate";

describe("baudRate", () => {
  test("parses custom positive integer baud rates", () => {
    expect(parseBaudRateInput("250000")).toBe(250000);
    expect(parseBaudRateInput("1000000")).toBe(1000000);
    expect(parseBaudRateInput(" 115200 ")).toBe(115200);
    expect(parseBaudRateInput(230400)).toBe(230400);
  });

  test("rejects invalid baud rate input", () => {
    for (const value of ["", "abc", "1.5", "-9600", "0"]) {
      expect(() => parseBaudRateInput(value)).toThrow("Baud rate must be");
      expect(isBaudRateInputValid(value)).toBe(false);
    }
  });
});
