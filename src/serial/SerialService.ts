import type { EventEmitter } from "node:events";
import type { SerialPort } from "serialport";
import {
  PipelineRunner,
  type AsyncScriptParserLoader,
  type PipelineRunnerOptions,
} from "../pipeline/PipelineRunner";
import { defaultProfile } from "../profiles/defaultProfile";
import { formatError } from "../shared/formatError";
import type {
  ConnectionErrorKind,
  ConnectionErrorRecovery,
  ConnectionPhase,
  ConnectionSettings,
  ConnectionState,
  LineEnding,
  OutputPacket,
  ParserMode,
  ProfileConfig,
  SerialPortSummary,
} from "../shared/protocol";

type SerialPortModule = { SerialPort: typeof SerialPort };
type SerialPortModuleLoader = () => Promise<SerialPortModule>;

export interface SerialPortLike extends EventEmitter {
  readonly isOpen: boolean;
  open(callback: (error: Error | null | undefined) => void): void;
  close(callback: (error: Error | null | undefined) => void): void;
  write(data: string | Buffer, callback: (error: Error | null | undefined) => void): void;
}

export interface SerialPortFactory {
  list(): Promise<SerialPortSummary[]>;
  create(settings: ConnectionSettings): SerialPortLike | Promise<SerialPortLike>;
}

export interface SerialServiceEvents {
  onConnectionState?(state: ConnectionState): void;
  onOutputPacket?(packet: OutputPacket): void;
  onError?(error: SerialConnectionError): void;
}

export interface SerialServiceOptions {
  readonly scriptParserLoader?: AsyncScriptParserLoader;
}

export class SerialConnectionError extends Error {
  readonly name = "SerialConnectionError";

  constructor(
    readonly kind: ConnectionErrorKind,
    message: string,
    readonly path?: string,
    readonly recovery: ConnectionErrorRecovery = "retry",
  ) {
    super(message);
  }
}

export class NodeSerialPortFactory implements SerialPortFactory {
  constructor(private readonly loadModule: SerialPortModuleLoader = loadSerialPortModule) {}

  async list(): Promise<SerialPortSummary[]> {
    const { SerialPort } = await this.loadModule();
    const ports = await SerialPort.list();

    return ports.map((port) => ({
      path: port.path,
      manufacturer: port.manufacturer,
      serialNumber: port.serialNumber,
      vendorId: port.vendorId,
      productId: port.productId,
    }));
  }

  async create(settings: ConnectionSettings): Promise<SerialPortLike> {
    const { SerialPort } = await this.loadModule();

    return new SerialPort({
      path: settings.path,
      baudRate: settings.baudRate,
      autoOpen: false,
    }) as SerialPortLike;
  }
}

export class SerialService {
  private port: SerialPortLike | undefined;
  private parserMode: ParserMode = "auto";
  private activeProfile: ProfileConfig = defaultProfile;
  private pipelineRunner: PipelineRunner | undefined;
  private currentSettings: ConnectionSettings | undefined;
  private disconnecting = false;
  private connectionPhase: ConnectionPhase = "disconnected";
  private operationQueue: Promise<void> = Promise.resolve();
  private portErrorKind: ConnectionErrorKind | undefined;

  constructor(
    private readonly events: SerialServiceEvents = {},
    private readonly factory: SerialPortFactory = new NodeSerialPortFactory(),
    private readonly options: SerialServiceOptions = {},
  ) {}

  async listPorts(): Promise<SerialPortSummary[]> {
    try {
      return await this.factory.list();
    } catch (error) {
      throw classifySerialError(error);
    }
  }

  async connect(settings: ConnectionSettings): Promise<void> {
    return this.enqueue(() => this.connectInternal(settings));
  }

  async disconnect(): Promise<void> {
    return this.enqueue(() => this.disconnectInternal());
  }

  private async connectInternal(settings: ConnectionSettings): Promise<void> {
    await this.disconnectInternal();

    this.parserMode = settings.parserMode ?? "auto";
    this.currentSettings = settings;
    this.pipelineRunner?.dispose();
    this.pipelineRunner = undefined;
    this.setConnectionState({
      phase: "connecting",
      path: settings.path,
      baudRate: settings.baudRate,
    });

    let port: SerialPortLike | undefined;

    try {
      this.pipelineRunner = await this.createPipelineRunner(settings);

      try {
        port = await this.factory.create(settings);
      } catch (error) {
        throw classifySerialError(error, settings.path);
      }

      this.port = port;
      this.portErrorKind = undefined;
      port.on("data", this.handleData);
      port.on("error", this.handlePortError);
      port.on("close", this.handleClose);

      await new Promise<void>((resolve, reject) => {
        port?.open((error) => {
          if (error) {
            reject(classifySerialError(error, settings.path));
            return;
          }

          resolve();
        });
      });

      if (this.port !== port) {
        throw new SerialConnectionError(
          "device-disconnected",
          createConnectionErrorMessage(
            "device-disconnected",
            "The device disconnected while opening.",
            settings.path,
          ),
          settings.path,
          "refresh-ports",
        );
      }
    } catch (error) {
      await this.cleanupFailedConnection(port);
      this.setConnectionState({ phase: "disconnected" });
      throw toConnectionError(error, settings.path);
    }

    this.setConnectionState({
      phase: "connected",
      path: settings.path,
      baudRate: settings.baudRate,
    });
  }

  private async disconnectInternal(): Promise<void> {
    const port = this.port;

    if (port === undefined) {
      this.pipelineRunner?.dispose();
      this.pipelineRunner = undefined;
      this.currentSettings = undefined;
      this.disconnecting = false;
      this.setConnectionState({ phase: "disconnected" });
      return;
    }

    this.disconnecting = true;
    const settings = this.currentSettings;
    this.setConnectionState(createConnectionState("disconnecting", settings));
    this.pipelineRunner?.flush();
    this.pipelineRunner?.dispose();
    this.pipelineRunner = undefined;
    this.detachPortListeners(port);

    try {
      if (port.isOpen) {
        await new Promise<void>((resolve, reject) => {
          port.close((error) => {
            if (error) {
              reject(classifySerialError(error, settings?.path));
              return;
            }

            resolve();
          });
        });
      }
    } catch (error) {
      this.port = undefined;
      this.currentSettings = undefined;
      this.disconnecting = false;
      this.setConnectionState({ phase: "disconnected" });
      throw toConnectionError(error, settings?.path);
    }

    this.port = undefined;
    this.currentSettings = undefined;
    this.disconnecting = false;
    this.portErrorKind = undefined;
    this.setConnectionState({ phase: "disconnected" });
  }

  async send(text: string): Promise<void> {
    const port = this.port;
    const path = this.currentSettings?.path;

    if (port === undefined || !port.isOpen) {
      throw new Error("No serial port is connected.");
    }

    await new Promise<void>((resolve, reject) => {
      port.write(this.encodeTextForSend(text), (error) => {
        if (error) {
          reject(classifySerialError(error, path, true));
          return;
        }

        resolve();
      });
    });
  }

  setParserMode(parserMode: ParserMode): void {
    this.parserMode = parserMode;
    this.activeProfile = {
      ...this.activeProfile,
      parser: {
        kind: "builtin",
        mode: parserMode,
      },
    };

    if (this.currentSettings !== undefined) {
      this.currentSettings = {
        ...this.currentSettings,
        parserMode,
      };
    }

    this.pipelineRunner?.dispose();
    void this.recreatePipelineRunner();
  }

  setProfile(profile: ProfileConfig): void {
    this.activeProfile = profile;
    this.parserMode = profile.parser.kind === "builtin" ? profile.parser.mode : "raw";

    if (this.currentSettings === undefined) {
      return;
    }

    this.pipelineRunner?.dispose();
    void this.recreatePipelineRunner();
  }

  dispose(): void {
    void this.disconnect().catch((error: unknown) => {
      this.events.onError?.(toConnectionError(error, this.currentSettings?.path));
    });
  }

  private readonly handleData = (chunk: Buffer | Uint8Array): void => {
    this.pipelineRunner?.handleBytes(chunk);
  };

  private readonly handlePortError = (error: Error): void => {
    const classified = classifySerialError(error, this.currentSettings?.path, true);
    this.portErrorKind = classified.kind;
    this.events.onError?.(classified);
  };

  private readonly handleClose = (): void => {
    if (this.disconnecting) {
      return;
    }

    const port = this.port;
    const hadDeviceDisconnectError = this.portErrorKind === "device-disconnected";

    if (port !== undefined) {
      this.detachPortListeners(port);
    }

    this.port = undefined;
    const path = this.currentSettings?.path;
    this.currentSettings = undefined;
    this.pipelineRunner?.flush();
    this.pipelineRunner?.dispose();
    this.pipelineRunner = undefined;
    this.disconnecting = false;
    this.portErrorKind = undefined;
    this.setConnectionState({ phase: "disconnected" });

    if (!hadDeviceDisconnectError) {
      this.events.onError?.(
        new SerialConnectionError(
          "device-disconnected",
          createConnectionErrorMessage(
            "device-disconnected",
            "The device was unplugged or stopped responding.",
            path,
          ),
          path,
          "refresh-ports",
        ),
      );
    }
  };

  private detachPortListeners(port: SerialPortLike): void {
    port.off("data", this.handleData);
    port.off("error", this.handlePortError);
    port.off("close", this.handleClose);
  }

  private async createPipelineRunner(settings: ConnectionSettings): Promise<PipelineRunner> {
    const profile = this.createRuntimeProfile(settings);
    const baseOptions: Omit<PipelineRunnerOptions, "scriptParserLoader"> = {
      codec: profile.codec,
      framing: profile.framing,
      parser: profile.parser,
      outputs: profile.outputs,
      onPacket: (packet) => this.handleOutputPacket(packet),
      onError: (message) =>
        this.events.onError?.(
          new SerialConnectionError("unknown", message, this.currentSettings?.path, "retry"),
        ),
    };
    const options: PipelineRunnerOptions =
      this.options.scriptParserLoader === undefined
        ? baseOptions
        : {
            ...baseOptions,
            scriptParserLoader: this.options.scriptParserLoader,
          };

    return PipelineRunner.create(options);
  }

  private async recreatePipelineRunner(): Promise<void> {
    const settings = this.currentSettings;

    if (settings === undefined || this.connectionPhase !== "connected") {
      return;
    }

    try {
      const runner = await this.createPipelineRunner(settings);

      if (this.currentSettings !== settings || this.port === undefined) {
        runner.dispose();
        return;
      }

      this.pipelineRunner = runner;
    } catch (error) {
      this.pipelineRunner = undefined;
      this.events.onError?.(toConnectionError(error, settings.path));
    }
  }

  private createRuntimeProfile(settings: ConnectionSettings): ProfileConfig {
    return {
      ...this.activeProfile,
      parser:
        settings.parserMode === undefined
          ? this.activeProfile.parser
          : {
              kind: "builtin",
              mode: settings.parserMode,
            },
    };
  }

  private encodeTextForSend(text: string): Buffer {
    const lineEnding = getLineEndingText(this.activeProfile.codec.sendLineEnding ?? "none");

    return Buffer.from(`${text}${lineEnding}`, this.activeProfile.codec.encoding);
  }

  private handleOutputPacket(packet: OutputPacket): void {
    this.events.onOutputPacket?.(packet);
  }

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionPhase === state.phase) {
      return;
    }

    this.connectionPhase = state.phase;
    this.events.onConnectionState?.(state);
  }

  private async cleanupFailedConnection(port: SerialPortLike | undefined): Promise<void> {
    if (port !== undefined) {
      this.detachPortListeners(port);

      if (port.isOpen) {
        await new Promise<void>((resolve) => {
          port.close(() => resolve());
        });
      }
    }

    this.port = undefined;
    this.currentSettings = undefined;
    this.pipelineRunner?.dispose();
    this.pipelineRunner = undefined;
    this.disconnecting = false;
    this.portErrorKind = undefined;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.operationQueue.then(operation, operation);
    this.operationQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

function createConnectionState(
  phase: ConnectionPhase,
  settings: ConnectionSettings | undefined,
): ConnectionState {
  if (settings === undefined) {
    return { phase };
  }

  return {
    phase,
    path: settings.path,
    baudRate: settings.baudRate,
  };
}

function toConnectionError(error: unknown, path: string | undefined): SerialConnectionError {
  if (error instanceof SerialConnectionError) {
    return error;
  }

  return new SerialConnectionError("unknown", formatError(error), path, "retry");
}

function classifySerialError(
  error: unknown,
  path?: string,
  runtime = false,
): SerialConnectionError {
  if (error instanceof SerialConnectionError) {
    return error;
  }

  const message = formatError(error);
  const code = getErrorCode(error);
  let kind: ConnectionErrorKind = "unknown";

  if (runtime && isDeviceDisconnectedError(code, message)) {
    kind = "device-disconnected";
  } else if (isNativeBindingError(code, message)) {
    kind = "native-binding";
  } else if (isPortNotFoundError(code, message)) {
    kind = "port-not-found";
  } else if (isPermissionError(code, message)) {
    kind = "permission-denied";
  } else if (isBusyError(code, message)) {
    kind = "port-busy";
  }

  return new SerialConnectionError(
    kind,
    createConnectionErrorMessage(kind, message, path),
    path,
    getRecovery(kind),
  );
}

function createConnectionErrorMessage(
  kind: ConnectionErrorKind,
  message: string,
  path: string | undefined,
): string {
  if (kind === "unknown") {
    return message;
  }

  const target = path === undefined ? "" : ` (${path})`;

  if (kind === "port-not-found") {
    return `Port not found${target}: ${message}`;
  }

  if (kind === "permission-denied") {
    return `Permission denied${target}: ${message}`;
  }

  if (kind === "port-busy") {
    return `Port is busy${target}: ${message}`;
  }

  if (kind === "native-binding") {
    return `Serial native binding is unavailable: ${message}`;
  }

  return `Serial device disconnected${target}. Refresh ports and reconnect. ${message}`;
}

function getRecovery(kind: ConnectionErrorKind): ConnectionErrorRecovery {
  if (kind === "port-not-found" || kind === "device-disconnected") {
    return "refresh-ports";
  }

  if (kind === "permission-denied") {
    return "check-permissions";
  }

  return "retry";
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = error.code;
  return typeof code === "string" ? code : undefined;
}

function isNativeBindingError(code: string | undefined, message: string): boolean {
  return (
    code === "ERR_DLOPEN_FAILED" ||
    code === "MODULE_NOT_FOUND" ||
    code === "ERR_MODULE_NOT_FOUND" ||
    /native binding|bindings file|dlopen|node-gyp|compiled against|no native build was found/i.test(
      message,
    )
  );
}

let serialPortModulePromise: Promise<SerialPortModule> | undefined;

function loadSerialPortModule(): Promise<SerialPortModule> {
  serialPortModulePromise ??= import("serialport") as Promise<SerialPortModule>;
  return serialPortModulePromise;
}

function isPortNotFoundError(code: string | undefined, message: string): boolean {
  return (
    code === "ENOENT" ||
    /no such file|port(?:\s+path)?\s+not found|cannot find (?:the )?(?:serial )?(?:port|device)/i.test(
      message,
    )
  );
}

function isPermissionError(code: string | undefined, message: string): boolean {
  return (
    code === "EACCES" ||
    code === "EPERM" ||
    /permission denied|access denied|operation not permitted/i.test(message)
  );
}

function isBusyError(code: string | undefined, message: string): boolean {
  return code === "EBUSY" || /resource busy|port is already open|already open/i.test(message);
}

function isDeviceDisconnectedError(code: string | undefined, message: string): boolean {
  return (
    code === "ENODEV" ||
    code === "EIO" ||
    code === "EBADF" ||
    /device (?:was )?(?:disconnected|removed)|no such device|device is not present/i.test(message)
  );
}

function getLineEndingText(lineEnding: LineEnding): string {
  if (lineEnding === "lf") {
    return "\n";
  }

  if (lineEnding === "crlf") {
    return "\r\n";
  }

  if (lineEnding === "cr") {
    return "\r";
  }

  return "";
}
