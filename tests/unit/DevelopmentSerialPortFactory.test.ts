import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as vscode from "vscode";
import { describe, expect, test } from "vitest";
import { createSerialPortFactory } from "../../src/extension";
import { DevelopmentSerialPortFactory } from "../../src/serial/dev/DevelopmentSerialPortFactory";
import { ScriptedSerialPort } from "../../src/serial/dev/ScriptedSerialPort";
import {
  NodeSerialPortFactory,
  type SerialPortFactory,
  type SerialPortLike,
} from "../../src/serial/SerialService";
import type { ConnectionSettings, SerialPortSummary } from "../../src/shared/protocol";

class FakeRealFactory implements SerialPortFactory {
  async list(): Promise<SerialPortSummary[]> {
    return [{ path: "/dev/REAL", manufacturer: "Real Device" }];
  }

  create(_settings: ConnectionSettings): SerialPortLike {
    throw new Error("Fake real factory should not be used by this test.");
  }
}

describe("DevelopmentSerialPortFactory", () => {
  test("lists configured simulated ports, live E2E ports, and real ports", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "lsp-dev-factory-"));
    const configPath = path.join(root, "ports.config.json");
    const registryPath = path.join(root, "registry.json");
    const generatorPath = path.join(root, "generator.mjs");
    const now = 1_000;

    writeFileSync(generatorPath, "export async function* generate() {}\n");
    writeFileSync(
      configPath,
      JSON.stringify({
        ports: [
          {
            path: "sim://one",
            label: "One",
            baudRate: 115200,
            generator: "./generator.mjs",
          },
        ],
      }),
    );
    writeFileSync(
      registryPath,
      JSON.stringify({
        ports: [
          {
            path: "/tmp/live-vscode",
            label: "Live",
            manufacturer: "Live E2E",
            expiresAt: now + 1_000,
          },
          {
            path: "/tmp/stale-vscode",
            label: "Stale",
            expiresAt: now - 1,
          },
        ],
      }),
    );

    const factory = new DevelopmentSerialPortFactory(root, {
      configPath,
      registryPath,
      realFactory: new FakeRealFactory(),
      now: () => now,
    });

    await expect(factory.list()).resolves.toEqual([
      { path: "sim://one", manufacturer: "One" },
      { path: "/tmp/live-vscode", manufacturer: "Live E2E" },
      { path: "/dev/REAL", manufacturer: "Real Device" },
    ]);
  });

  test("creates scripted serial ports for sim paths", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lsp-dev-factory-"));
    const configPath = path.join(root, "ports.config.json");

    writeFileSync(
      configPath,
      JSON.stringify({
        ports: [
          {
            path: "sim://one",
            label: "One",
            baudRate: 115200,
            generator: "./generator.mjs",
          },
        ],
      }),
    );

    const factory = new DevelopmentSerialPortFactory(root, {
      configPath,
      realFactory: new FakeRealFactory(),
    });

    expect(
      factory.create({ path: "sim://one", baudRate: 115200, parserMode: "auto" }),
    ).toBeInstanceOf(ScriptedSerialPort);
  });

  test("uses the real factory in production mode and dev factory otherwise", () => {
    const context: Parameters<typeof createSerialPortFactory>[0] = {
      extensionUri: vscode.Uri.file("/extension"),
      extensionMode: 1,
    };
    const developmentContext: Parameters<typeof createSerialPortFactory>[0] = {
      extensionUri: vscode.Uri.file("/extension"),
      extensionMode: 2,
    };

    expect(createSerialPortFactory(context)).toBeInstanceOf(NodeSerialPortFactory);
    expect(createSerialPortFactory(developmentContext)).toBeInstanceOf(
      DevelopmentSerialPortFactory,
    );
  });
});
