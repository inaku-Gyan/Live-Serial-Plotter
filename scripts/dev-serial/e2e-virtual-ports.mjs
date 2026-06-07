#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleepTimer } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { SerialPort } from "serialport";
import {
  assertToolAvailable,
  buildCom0ComInstallArgs,
  buildCom0ComRemoveArgs,
  buildRegistry,
  buildSocatArgs,
  getDefaultRegistryPath,
  getSafePortFileName,
  getToolMissingMessage,
  parseArgs,
  parseCom0ComInstallOutput,
  resolveCommand,
} from "./e2e-helpers.mjs";

const portProcesses = [];
const serialPorts = [];
const abortControllers = [];
const createdCom0ComPairs = [];
let registryPath = getDefaultRegistryPath();
let registryTimer;
let shuttingDown = false;

main().catch((error) => {
  console.error(formatError(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  registryPath = options.registryPath;
  const configs = loadPortConfigs(options.configPath);

  if (configs.length === 0) {
    throw new Error(`No dev serial ports are configured in ${options.configPath}.`);
  }

  if (process.platform === "linux" || process.platform === "darwin") {
    await startSocatPorts(configs, options);
  } else if (process.platform === "win32") {
    await startWindowsPorts(configs, options);
  } else {
    throw new Error(`Unsupported platform: ${process.platform}`);
  }

  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));

  await new Promise(() => undefined);
}

async function startSocatPorts(configs, options) {
  assertToolAvailable("socat", ["-V"]);

  const root = path.join(tmpdir(), "live-serial-plotter-dev-serial", "pty");
  mkdirSync(root, { recursive: true });

  const activePorts = [];

  for (const config of configs) {
    const fileName = getSafePortFileName(config.path);
    const devicePath = path.join(root, `${fileName}-device`);
    const vscodePath = path.join(root, `${fileName}-vscode`);

    rmSync(devicePath, { force: true });
    rmSync(vscodePath, { force: true });

    const socat = spawn("socat", buildSocatArgs(devicePath, vscodePath), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    portProcesses.push(socat);
    socat.stderr.on("data", (chunk) => process.stderr.write(`[socat:${config.path}] ${chunk}`));

    // oxlint-disable-next-line no-await-in-loop -- Virtual serial ports are external resources set up one pair at a time.
    await Promise.all([waitForPath(devicePath), waitForPath(vscodePath)]);
    // oxlint-disable-next-line no-await-in-loop -- Start the writer only after its matching port pair is ready.
    await startGeneratorWriter(config, devicePath);

    activePorts.push({
      path: vscodePath,
      label: config.label,
      baudRate: config.baudRate,
    });
  }

  startRegistryHeartbeat(activePorts);
  printActivePorts(activePorts, options.registryPath);
}

async function startWindowsPorts(configs, options) {
  const setupcPath = resolveSetupcPath();

  if (setupcPath === undefined) {
    throw new Error(getToolMissingMessage("setupc.exe"));
  }

  if (options.windowsPairs.length < configs.length) {
    throw new Error(
      [
        `Windows requires one COM pair per configured port (${configs.length} required).`,
        "Example:",
        "pnpm dev:serial:e2e -- --create --windows-pairs COM30:COM31,COM32:COM33",
      ].join("\n"),
    );
  }

  const activePorts = [];

  for (const [index, config] of configs.entries()) {
    const pair = options.windowsPairs[index];

    if (options.create) {
      const install = spawnSync(setupcPath, buildCom0ComInstallArgs(pair), {
        encoding: "utf8",
      });

      if (install.status !== 0) {
        throw new Error(
          `com0com failed to create ${pair.device}:${pair.vscode}\n${install.stderr}${install.stdout}`,
        );
      }

      const pairIndex = parseCom0ComInstallOutput(`${install.stdout}\n${install.stderr}`);

      if (pairIndex !== undefined) {
        createdCom0ComPairs.push({ setupcPath, pairIndex });
      } else {
        console.warn(
          `Created ${pair.device}:${pair.vscode}, but could not parse the com0com pair index for cleanup.`,
        );
      }
    }

    // oxlint-disable-next-line no-await-in-loop -- com0com pairs are external resources set up one pair at a time.
    await startGeneratorWriter(config, pair.device);
    activePorts.push({
      path: pair.vscode,
      label: config.label,
      baudRate: config.baudRate,
    });
  }

  startRegistryHeartbeat(activePorts);
  printActivePorts(activePorts, options.registryPath);
}

function resolveSetupcPath() {
  const fromPath = resolveCommand("setupc.exe") ?? resolveCommand("setupc");

  if (fromPath !== undefined) {
    return fromPath;
  }

  const candidates = [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"]].flatMap(
    (root) =>
      root === undefined
        ? []
        : [
            path.join(root, "com0com", "setupc.exe"),
            path.join(root, "com0com", "x64", "setupc.exe"),
            path.join(root, "com0com", "i386", "setupc.exe"),
          ],
  );

  return candidates.find((candidate) => existsSync(candidate));
}

async function startGeneratorWriter(config, serialPath) {
  const generatorModule = await import(pathToFileURL(config.generatorPath).href);

  if (typeof generatorModule.generate !== "function") {
    throw new Error(`Generator ${config.generatorPath} does not export generate().`);
  }

  const serialPort = new SerialPort({
    path: serialPath,
    baudRate: config.baudRate,
    autoOpen: false,
  });
  serialPorts.push(serialPort);

  await openSerialPort(serialPort);

  const abortController = new AbortController();
  abortControllers.push(abortController);
  const context = createGeneratorContext(config, abortController.signal);

  serialPort.on("data", (data) => {
    if (typeof generatorModule.onWrite === "function") {
      void Promise.resolve(generatorModule.onWrite(data, context)).catch((error) => {
        console.error(formatError(error));
      });
    }
  });

  void runGeneratorToSerialPort(generatorModule, context, serialPort).catch((error) => {
    if (!abortController.signal.aborted) {
      console.error(formatError(error));
    }
  });
}

function startRegistryHeartbeat(activePorts) {
  mkdirSync(path.dirname(registryPath), { recursive: true });

  const writeRegistry = () => {
    writeFileSync(registryPath, `${JSON.stringify(buildRegistry(activePorts), null, 2)}\n`);
  };

  writeRegistry();
  registryTimer = setInterval(writeRegistry, 2_000);
}

async function runGeneratorToSerialPort(generatorModule, context, serialPort) {
  for await (const chunk of generatorModule.generate(context)) {
    if (context.signal.aborted) {
      return;
    }

    await writeSerialPort(serialPort, chunk);
  }
}

function createGeneratorContext(config, signal) {
  return {
    portId: config.path,
    label: config.label,
    baudRate: config.baudRate,
    options: config.options,
    signal,
    sleep: (ms) => sleep(ms, signal),
    log: (message) => console.log(`[${config.path}] ${message}`),
  };
}

function loadPortConfigs(configPath) {
  const configDirectory = path.dirname(configPath);
  const config = JSON.parse(readFileSync(configPath, "utf8"));

  return (config.ports ?? []).map((port, index) => {
    const portPath = typeof port.path === "string" ? port.path : `sim://telemetry-${index + 1}`;
    const label = typeof port.label === "string" ? port.label : `Telemetry Simulator ${index + 1}`;
    const baudRate = typeof port.baudRate === "number" ? port.baudRate : 115200;
    const generator =
      typeof port.generator === "string" ? port.generator : "./generators/sample-telemetry.mjs";

    return {
      path: portPath,
      label,
      baudRate,
      generatorPath: path.isAbsolute(generator)
        ? generator
        : path.resolve(configDirectory, generator),
      options:
        typeof port.options === "object" && port.options !== null && !Array.isArray(port.options)
          ? port.options
          : {},
    };
  });
}

function openSerialPort(serialPort) {
  return new Promise((resolve, reject) => {
    serialPort.open((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function writeSerialPort(serialPort, chunk) {
  const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

  return new Promise((resolve, reject) => {
    serialPort.write(data, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function waitForPath(targetPath) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (shuttingDown) {
        clearInterval(timer);
        reject(new Error("Shutting down."));
        return;
      }

      try {
        if (existsSync(targetPath)) {
          clearInterval(timer);
          resolve();
          return;
        }
      } catch {
        // Retry until timeout.
      }

      try {
        if (Date.now() - startedAt > 5_000) {
          clearInterval(timer);
          reject(new Error(`Timed out waiting for ${targetPath}.`));
        }
      } catch {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${targetPath}.`));
      }
    }, 50);
  });
}

async function sleep(ms, signal) {
  if (signal.aborted) {
    return;
  }

  try {
    await sleepTimer(ms, undefined, { signal });
  } catch (error) {
    if (!isAbortError(error)) {
      throw error;
    }
  }
}

function isAbortError(error) {
  return error instanceof Error && error.name === "AbortError";
}

async function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  clearInterval(registryTimer);

  for (const controller of abortControllers) {
    controller.abort();
  }

  await Promise.all(
    serialPorts.map((serialPort) => closeSerialPort(serialPort).catch(() => undefined)),
  );

  for (const child of portProcesses) {
    child.kill();
  }

  for (const createdPair of createdCom0ComPairs) {
    spawnSync(createdPair.setupcPath, buildCom0ComRemoveArgs(createdPair.pairIndex), {
      stdio: "inherit",
    });
  }

  rmSync(registryPath, { force: true });
  process.exit(exitCode);
}

function closeSerialPort(serialPort) {
  return new Promise((resolve) => {
    if (!serialPort.isOpen) {
      resolve();
      return;
    }

    serialPort.close(() => resolve());
  });
}

function printActivePorts(activePorts, activeRegistryPath) {
  console.log("Live Serial Plotter E2E virtual serial ports are running.");
  console.log(`Registry: ${activeRegistryPath}`);

  for (const port of activePorts) {
    console.log(`- ${port.label}: connect VS Code to ${port.path} @ ${port.baudRate}`);
  }

  console.log("Press Ctrl+C to stop and clean up.");
}

function formatError(error) {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
