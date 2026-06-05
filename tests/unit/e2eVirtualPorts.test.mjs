import { describe, expect, test } from "vitest";
import {
  buildCom0ComInstallArgs,
  buildCom0ComRemoveArgs,
  buildRegistry,
  buildSocatArgs,
  getPlatformPlan,
  getSafePortFileName,
  parseArgs,
  parseCom0ComInstallOutput,
  parseWindowsPairs,
} from "../../scripts/dev-serial/e2e-helpers.mjs";

describe("E2E virtual serial helpers", () => {
  test("parses Windows COM pairs", () => {
    expect(parseWindowsPairs("COM30:COM31,COM32:COM33")).toEqual([
      { device: "COM30", vscode: "COM31" },
      { device: "COM32", vscode: "COM33" },
    ]);
    expect(() => parseWindowsPairs("COM30")).toThrow("Invalid Windows COM pair");
  });

  test("parses CLI arguments", () => {
    expect(
      parseArgs([
        "--create",
        "--windows-pairs",
        "COM30:COM31",
        "--config",
        "/tmp/config.json",
        "--registry",
        "/tmp/registry.json",
      ]),
    ).toMatchObject({
      create: true,
      configPath: "/tmp/config.json",
      registryPath: "/tmp/registry.json",
      windowsPairs: [{ device: "COM30", vscode: "COM31" }],
    });
  });

  test("builds platform-specific commands", () => {
    expect(getPlatformPlan("linux", {})).toEqual({ kind: "socat", tool: "socat" });
    expect(buildSocatArgs("/tmp/device", "/tmp/vscode")).toEqual([
      "-d",
      "-d",
      "pty,raw,echo=0,link=/tmp/device",
      "pty,raw,echo=0,link=/tmp/vscode",
    ]);
    expect(buildCom0ComInstallArgs({ device: "COM30", vscode: "COM31" })).toEqual([
      "install",
      "PortName=COM30",
      "PortName=COM31",
    ]);
    expect(buildCom0ComRemoveArgs(4)).toEqual(["remove", "4"]);
  });

  test("parses com0com install output and builds registry", () => {
    expect(parseCom0ComInstallOutput("Added CNCA7 & CNCB7")).toBe(7);
    expect(parseCom0ComInstallOutput("unknown")).toBeUndefined();
    expect(
      buildRegistry([{ path: "/tmp/vscode", label: "Telemetry", baudRate: 115200 }], 1_000),
    ).toEqual({
      version: 1,
      updatedAt: 1_000,
      ports: [
        {
          path: "/tmp/vscode",
          label: "Telemetry",
          baudRate: 115200,
          manufacturer: "Live Serial Plotter E2E: Telemetry",
          expiresAt: 6_000,
        },
      ],
    });
  });

  test("creates safe file names from serial IDs", () => {
    expect(getSafePortFileName("sim://telemetry-a")).toBe("telemetry-a");
    expect(getSafePortFileName("sim://scope/a b")).toBe("scope-a-b");
  });
});
