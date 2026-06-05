import { EventEmitter } from "node:events";
import { SerialPort } from "serialport";
import { toPlotSample } from "../parsers/parseLine";
import { LineDecoder } from "./LineDecoder";
import type {
  ConnectionSettings,
  ConnectionState,
  ParserMode,
  PlotSample,
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
  onError?(message: string): void;
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
  private readonly decoder = new LineDecoder();
  private port: SerialPortLike | undefined;
  private parserMode: ParserMode = "auto";
  private currentSettings: ConnectionSettings | undefined;
  private disconnecting = false;

  constructor(
    private readonly events: SerialServiceEvents = {},
    private readonly factory: SerialPortFactory = new NodeSerialPortFactory(),
  ) {}

  async listPorts(): Promise<SerialPortSummary[]> {
    return this.factory.list();
  }

  async connect(settings: ConnectionSettings): Promise<void> {
    await this.disconnect();

    this.parserMode = settings.parserMode;
    this.currentSettings = settings;
    this.decoder.reset();
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
    this.decoder.flush();
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

    if (this.currentSettings !== undefined) {
      this.currentSettings = {
        ...this.currentSettings,
        parserMode,
      };
    }
  }

  dispose(): void {
    void this.disconnect().catch((error: unknown) => {
      this.events.onError?.(formatError(error));
    });
  }

  private readonly handleData = (chunk: Buffer | Uint8Array): void => {
    const lines = this.decoder.push(chunk);

    for (const line of lines) {
      const timestamp = Date.now();
      this.events.onRawLine?.(line, timestamp);

      const sample = toPlotSample(line, this.parserMode, timestamp);

      if (sample !== null) {
        this.events.onSample?.(sample);
      }
    }
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
    this.events.onConnectionState?.({ connected: false });
  };

  private detachPortListeners(port: SerialPortLike): void {
    port.off("data", this.handleData);
    port.off("error", this.handlePortError);
    port.off("close", this.handleClose);
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
