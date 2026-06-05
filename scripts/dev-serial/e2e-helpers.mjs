import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const registryDirectoryName = "live-serial-plotter-dev-serial";
export const registryFileName = "e2e-ports.json";

export function getDefaultRegistryPath(tempDirectory = tmpdir()) {
  return path.join(tempDirectory, registryDirectoryName, registryFileName);
}

export function parseArgs(argv) {
  const options = {
    create: false,
    configPath: path.join(process.cwd(), "scripts", "dev-serial", "ports.config.json"),
    registryPath: getDefaultRegistryPath(),
    windowsPairs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--create") {
      options.create = true;
      continue;
    }

    if (arg === "--config") {
      options.configPath = requireValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--registry") {
      options.registryPath = requireValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--windows-pairs") {
      options.windowsPairs = parseWindowsPairs(requireValue(argv, index, arg));
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

export function parseWindowsPairs(value) {
  if (value.trim().length === 0) {
    return [];
  }

  return value.split(",").map((pair) => {
    const [device, vscode, extra] = pair.split(":");

    if (
      device === undefined ||
      vscode === undefined ||
      extra !== undefined ||
      !isComPortName(device) ||
      !isComPortName(vscode)
    ) {
      throw new Error(`Invalid Windows COM pair: ${pair}`);
    }

    return { device, vscode };
  });
}

export function getPlatformPlan(platform, options) {
  if (platform === "linux" || platform === "darwin") {
    return { kind: "socat", tool: "socat" };
  }

  if (platform === "win32") {
    return {
      kind: "com0com",
      tool: options.setupcPath ?? "setupc.exe",
      create: options.create,
      windowsPairs: options.windowsPairs,
    };
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

export function buildSocatArgs(devicePath, vscodePath) {
  return ["-d", "-d", `pty,raw,echo=0,link=${devicePath}`, `pty,raw,echo=0,link=${vscodePath}`];
}

export function buildCom0ComInstallArgs(pair) {
  return ["install", `PortName=${pair.device}`, `PortName=${pair.vscode}`];
}

export function buildCom0ComRemoveArgs(pairIndex) {
  return ["remove", String(pairIndex)];
}

export function parseCom0ComInstallOutput(output) {
  const match = /Added\s+CNCA(\d+)\s*&\s*CNCB\1/i.exec(output);
  return match === null ? undefined : Number(match[1]);
}

export function buildRegistry(ports, now = Date.now()) {
  return {
    version: 1,
    updatedAt: now,
    ports: ports.map((port) => ({
      path: port.path,
      label: port.label,
      baudRate: port.baudRate,
      manufacturer: `Live Serial Plotter E2E: ${port.label}`,
      expiresAt: now + 5_000,
    })),
  };
}

export function resolveCommand(command, environmentPath = process.env.PATH ?? "") {
  if (path.isAbsolute(command) && existsSync(command)) {
    return command;
  }

  const pathExt = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT") : "";
  const extensions = process.platform === "win32" ? ["", ...pathExt.split(";")] : [""];

  for (const directory of environmentPath.split(path.delimiter)) {
    if (directory.length === 0) {
      continue;
    }

    for (const extension of extensions) {
      const candidate = path.join(
        directory,
        command.toLowerCase().endsWith(extension.toLowerCase()) ? command : command + extension,
      );

      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

export function assertToolAvailable(command, args = ["--version"]) {
  const result = spawnSync(command, args, { stdio: "ignore" });

  if (result.error !== undefined) {
    throw new Error(getToolMissingMessage(command));
  }
}

export function getToolMissingMessage(command) {
  if (command === "socat") {
    return [
      "找不到 socat，无法创建真实虚拟串口。",
      "Linux: sudo apt install socat / sudo dnf install socat",
      "macOS: brew install socat",
    ].join("\n");
  }

  return [
    `找不到 ${command}，无法使用 com0com 创建或复用 Windows 虚拟串口。`,
    "请安装 com0com，并确保 setupc.exe 在 PATH 中，或使用 --windows-pairs 复用已有端口对。",
  ].join("\n");
}

export function getSafePortFileName(portId) {
  return portId.replace(/^[a-z]+:\/\//i, "").replace(/[^a-z0-9._-]+/gi, "-");
}

function requireValue(argv, index, optionName) {
  const value = argv[index + 1];

  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value.`);
  }

  return value;
}

function isComPortName(value) {
  return /^COM\d+$/i.test(value);
}
