import { EventEmitter } from "node:events";
import { SerialPort } from "serialport";
import { PipelineRunner, type AsyncScriptParserLoader } from "../pipeline/PipelineRunner";
import { defaultProfile } from "../profiles/defaultProfile";
import type {
  ConnectionSettings,
  ConnectionState,
  OutputPacket,
  ParserMode,
  PlotSample,
  ProfileConfig,
  SerialPortSummary,
} from "../shared/protocol";

export interface SerialPortLike extends EventEmitter {
  readonly isOpen: boolean;
  open(callback: (error: Error | null | undefined) => void): void;
  close(callback: (error: Error | null | undefined) => void): void;
  write(data: string | Buffer, callback: (error: Error | null | undefined) => void): void;
}

export interface SerialPortFactory {
  list(): Promise<SerialPortSummary[]>;
  create(settings: ConnectionSettings): SerialPortLike;
}

export interface SerialServiceEvents {
  onConnectionState?(state: ConnectionState): void;
  onRawLine?(line: string, t: number): void;
  onSample?(sample: PlotSample): void;
  onOutputPacket?(packet: OutputPacket): void;
  onError?(message: string): void;
}

export interface SerialServiceOptions {
  readonly scriptParserLoader?: AsyncScriptParserLoader;
}

export class NodeSerialPortFactory implements SerialPortFactory {
  async list(): Promise<SerialPortSummary[]> {
    const ports = await SerialPort.list();

    return ports.map((port) => ({
      path: port.path,
      manufacturer: port.manufacturer,
      serialNumber: port.serialNumber,
      vendorId: port.vendorId,
      productId: port.productId,
    }));
  }

  create(settings: ConnectionSettings): SerialPortLike {
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

  constructor(
    private readonly events: SerialServiceEvents = {},
    private readonly factory: SerialPortFactory = new NodeSerialPortFactory(),
    private readonly options: SerialServiceOptions = {},
  ) {}

  async listPorts(): Promise<SerialPortSummary[]> {
    return this.factory.list();
  }

  async connect(settings: ConnectionSettings): Promise<void> {
    await this.disconnect();

    this.parserMode = settings.parserMode ?? "auto";
    this.currentSettings = settings;
    this.pipelineRunner?.dispose();
    this.pipelineRunner = await this.createPipelineRunner(settings);
    this.disconnecting = false;

    const port = this.factory.create(settings);
    this.port = port;

    port.on("data", this.handleData);
    port.on("error", this.handlePortError);
    port.on("close", this.handleClose);

    try {
      await new Promise<void>((resolve, reject) => {
        port.open((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    } catch (error) {
      this.detachPortListeners(port);
      this.port = undefined;
      this.currentSettings = undefined;
      this.disconnecting = false;
      throw error;
    }

    this.events.onConnectionState?.({
      connected: true,
      path: settings.path,
      baudRate: settings.baudRate,
    });
  }

  async disconnect(): Promise<void> {
    const port = this.port;

    if (port === undefined) {
      return;
    }

    this.disconnecting = true;
    this.pipelineRunner?.flush();
    this.pipelineRunner?.dispose();
    this.pipelineRunner = undefined;
    this.detachPortListeners(port);

    if (port.isOpen) {
      await new Promise<void>((resolve, reject) => {
        port.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }

    this.port = undefined;
    this.currentSettings = undefined;
    this.disconnecting = false;
    this.events.onConnectionState?.({ connected: false });
  }

  async send(text: string): Promise<void> {
    const port = this.port;

    if (port === undefined || !port.isOpen) {
      throw new Error("No serial port is connected.");
    }

    await new Promise<void>((resolve, reject) => {
      port.write(text, (error) => {
        if (error) {
          reject(error);
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
      this.events.onError?.(formatError(error));
    });
  }

  private readonly handleData = (chunk: Buffer | Uint8Array): void => {
    this.pipelineRunner?.handleBytes(chunk);
  };

  private readonly handlePortError = (error: Error): void => {
    this.events.onError?.(error.message);
  };

  private readonly handleClose = (): void => {
    if (this.disconnecting) {
      return;
    }

    this.port = undefined;
    this.currentSettings = undefined;
    this.pipelineRunner?.dispose();
    this.pipelineRunner = undefined;
    this.events.onConnectionState?.({ connected: false });
  };

  private detachPortListeners(port: SerialPortLike): void {
    port.off("data", this.handleData);
    port.off("error", this.handlePortError);
    port.off("close", this.handleClose);
  }

  private async createPipelineRunner(settings: ConnectionSettings): Promise<PipelineRunner> {
    const profile = this.createRuntimeProfile(settings);

    return PipelineRunner.create({
      framing: profile.framing,
      parser: profile.parser,
      outputs: profile.outputs,
      scriptParserLoader: this.options.scriptParserLoader,
      onPacket: (packet) => this.handleOutputPacket(packet),
      onError: (message) => this.events.onError?.(message),
    });
  }

  private async recreatePipelineRunner(): Promise<void> {
    if (this.currentSettings === undefined) {
      this.pipelineRunner = undefined;
      return;
    }

    try {
      this.pipelineRunner = await this.createPipelineRunner(this.currentSettings);
    } catch (error) {
      this.pipelineRunner = undefined;
      this.events.onError?.(formatError(error));
    }
  }

  private createRuntimeProfile(settings: ConnectionSettings): ProfileConfig {
    return {
      ...this.activeProfile,
      connection: {
        ...this.activeProfile.connection,
        path: settings.path,
        baudRate: settings.baudRate,
      },
      parser:
        settings.parserMode === undefined
          ? this.activeProfile.parser
          : {
              kind: "builtin",
              mode: settings.parserMode,
            },
    };
  }

  private handleOutputPacket(packet: OutputPacket): void {
    this.events.onOutputPacket?.(packet);

    if (packet.kind === "terminalAppend" && packet.outputId === "raw") {
      for (const line of packet.lines) {
        this.events.onRawLine?.(line.text, line.timestamp ?? packet.receivedAt);
      }
    }

    if (packet.kind === "timeSeriesAppend") {
      for (const sample of packet.samples) {
        this.events.onSample?.({
          t: sample.time,
          values: sample.values,
        });
      }
    }
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
