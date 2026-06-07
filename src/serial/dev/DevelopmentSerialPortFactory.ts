import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  NodeSerialPortFactory,
  type SerialPortFactory,
  type SerialPortLike,
} from "../SerialService";
import { ScriptedSerialPort, type ScriptedSerialPortDefinition } from "./ScriptedSerialPort";
import type { ConnectionSettings, SerialPortSummary } from "../../shared/protocol";

const devSerialDirectory = "live-serial-plotter-dev-serial";
const e2eRegistryFile = "e2e-ports.json";
const defaultGeneratorRelativePath = "generators/sample-telemetry.mjs";

export interface DevelopmentSerialPortFactoryOptions {
  readonly configPath?: string;
  readonly registryPath?: string;
  readonly realFactory?: SerialPortFactory;
  readonly now?: () => number;
  readonly log?: (message: string) => void;
}

interface ConfigFile {
  readonly ports?: readonly RawScriptedPortConfig[];
}

interface RawScriptedPortConfig {
  readonly path?: unknown;
  readonly label?: unknown;
  readonly baudRate?: unknown;
  readonly generator?: unknown;
  readonly options?: unknown;
}

interface E2eRegistry {
  readonly ports?: readonly E2eRegistryPort[];
}

interface E2eRegistryPort {
  readonly path?: unknown;
  readonly label?: unknown;
  readonly baudRate?: unknown;
  readonly manufacturer?: unknown;
  readonly expiresAt?: unknown;
}

export class DevelopmentSerialPortFactory implements SerialPortFactory {
  private readonly configPath: string;
  private readonly registryPath: string;
  private readonly realFactory: SerialPortFactory;
  private readonly now: () => number;
  private readonly log: ((message: string) => void) | undefined;

  constructor(
    private readonly extensionRoot: string,
    options: DevelopmentSerialPortFactoryOptions = {},
  ) {
    this.configPath =
      options.configPath ?? path.join(extensionRoot, "scripts", "dev-serial", "ports.config.json");
    this.registryPath = options.registryPath ?? getE2eRegistryPath();
    this.realFactory = options.realFactory ?? new NodeSerialPortFactory();
    this.now = options.now ?? Date.now;
    this.log = options.log;
  }

  async list(): Promise<SerialPortSummary[]> {
    const scriptedPorts = this.loadScriptedPortDefinitions().map((port) => ({
      path: port.path,
      manufacturer: port.label,
    }));
    const e2ePorts = this.loadE2eRegistryPorts();
    const realPorts = await this.realFactory.list();

    return [...scriptedPorts, ...e2ePorts, ...realPorts];
  }

  create(settings: ConnectionSettings): SerialPortLike {
    const scriptedPort = this.loadScriptedPortDefinitions().find(
      (port) => port.path === settings.path,
    );

    if (scriptedPort !== undefined) {
      return new ScriptedSerialPort(scriptedPort, settings.baudRate, { log: this.log });
    }

    return this.realFactory.create(settings);
  }

  private loadScriptedPortDefinitions(): ScriptedSerialPortDefinition[] {
    const config = readConfigFile(this.configPath);
    const rawPorts = config.ports ?? getDefaultPortConfigs();

    return rawPorts.map((port, index) =>
      normalizeScriptedPortConfig(port, index, path.dirname(this.configPath), this.extensionRoot),
    );
  }

  private loadE2eRegistryPorts(): SerialPortSummary[] {
    const registry = readRegistryFile(this.registryPath);
    const ports = registry.ports ?? [];
    const now = this.now();

    return ports.flatMap((port) => {
      if (
        typeof port.path !== "string" ||
        typeof port.label !== "string" ||
        typeof port.expiresAt !== "number" ||
        port.expiresAt <= now
      ) {
        return [];
      }

      return [
        {
          path: port.path,
          manufacturer:
            typeof port.manufacturer === "string" ? port.manufacturer : `E2E ${port.label}`,
        },
      ];
    });
  }
}

export function getE2eRegistryPath(): string {
  return path.join(tmpdir(), devSerialDirectory, e2eRegistryFile);
}

function readConfigFile(configPath: string): ConfigFile {
  if (!existsSync(configPath)) {
    return {};
  }

  const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
  return isConfigFile(parsed) ? parsed : {};
}

function readRegistryFile(registryPath: string): E2eRegistry {
  if (!existsSync(registryPath)) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(registryPath, "utf8"));
    return isE2eRegistry(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function getDefaultPortConfigs(): RawScriptedPortConfig[] {
  return [
    {
      path: "sim://telemetry-a",
      label: "Telemetry Simulator A",
      baudRate: 115200,
      generator: `./${defaultGeneratorRelativePath}`,
      options: { intervalMs: 100, phase: 0 },
    },
    {
      path: "sim://telemetry-b",
      label: "Telemetry Simulator B",
      baudRate: 115200,
      generator: `./${defaultGeneratorRelativePath}`,
      options: { intervalMs: 150, phase: 1.2 },
    },
  ];
}

function normalizeScriptedPortConfig(
  port: RawScriptedPortConfig,
  index: number,
  configDirectory: string,
  extensionRoot: string,
): ScriptedSerialPortDefinition {
  const portPath = typeof port.path === "string" ? port.path : `sim://telemetry-${index + 1}`;
  const label = typeof port.label === "string" ? port.label : `Telemetry Simulator ${index + 1}`;
  const baudRate = typeof port.baudRate === "number" ? port.baudRate : 115200;
  const generator =
    typeof port.generator === "string" ? port.generator : `./${defaultGeneratorRelativePath}`;
  const options = isPlainObject(port.options) ? port.options : {};

  return {
    path: portPath,
    label,
    baudRate,
    generatorPath: resolveGeneratorPath(generator, configDirectory, extensionRoot),
    options,
  };
}

function resolveGeneratorPath(
  generator: string,
  configDirectory: string,
  extensionRoot: string,
): string {
  if (path.isAbsolute(generator)) {
    return generator;
  }

  if (generator.startsWith("./") || generator.startsWith("../")) {
    return path.resolve(configDirectory, generator);
  }

  return path.resolve(extensionRoot, generator);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConfigFile(value: unknown): value is ConfigFile {
  return (
    isPlainObject(value) &&
    (value.ports === undefined || (Array.isArray(value.ports) && value.ports.every(isPlainObject)))
  );
}

function isE2eRegistry(value: unknown): value is E2eRegistry {
  return (
    isPlainObject(value) &&
    (value.ports === undefined || (Array.isArray(value.ports) && value.ports.every(isPlainObject)))
  );
}
