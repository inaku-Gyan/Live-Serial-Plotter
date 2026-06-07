import { EventEmitter } from "node:events";
import { setTimeout as sleepTimer } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import type { SerialPortLike } from "../SerialService";

export interface ScriptedSerialPortDefinition {
  readonly path: string;
  readonly label: string;
  readonly baudRate: number;
  readonly generatorPath: string;
  readonly options: Record<string, unknown>;
}

export interface ScriptedGeneratorContext {
  readonly portId: string;
  readonly label: string;
  readonly baudRate: number;
  readonly options: Record<string, unknown>;
  readonly signal: AbortSignal;
  sleep(ms: number): Promise<void>;
  log(message: string): void;
}

export interface ScriptedGeneratorModule {
  generate(
    context: ScriptedGeneratorContext,
  ): AsyncIterable<string | Buffer> | Iterable<string | Buffer>;
  onWrite?(data: Buffer, context: ScriptedGeneratorContext): void | Promise<void>;
}

export type ScriptedGeneratorLoader = (generatorPath: string) => Promise<ScriptedGeneratorModule>;

export interface ScriptedSerialPortOptions {
  readonly loadGenerator?: ScriptedGeneratorLoader;
  readonly log?: (message: string) => void;
}

export class ScriptedSerialPort extends EventEmitter implements SerialPortLike {
  private openState = false;
  private abortController: AbortController | undefined;
  private generatorModule: ScriptedGeneratorModule | undefined;
  private context: ScriptedGeneratorContext | undefined;

  constructor(
    private readonly definition: ScriptedSerialPortDefinition,
    private readonly requestedBaudRate: number,
    private readonly options: ScriptedSerialPortOptions = {},
  ) {
    super();
  }

  get isOpen(): boolean {
    return this.openState;
  }

  open(callback: (error: Error | null | undefined) => void): void {
    if (this.openState) {
      queueMicrotask(() => callback(new Error(`${this.definition.path} is already open.`)));
      return;
    }

    void this.openAsync(callback);
  }

  close(callback: (error: Error | null | undefined) => void): void {
    this.stop();
    queueMicrotask(() => callback(null));
  }

  write(data: string | Buffer, callback: (error: Error | null | undefined) => void): void {
    const generatorModule = this.generatorModule;
    const context = this.context;

    if (!this.openState || generatorModule?.onWrite === undefined || context === undefined) {
      queueMicrotask(() => callback(null));
      return;
    }

    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    void this.writeAsync(generatorModule, buffer, context, callback);
  }

  private async openAsync(callback: (error: Error | null | undefined) => void): Promise<void> {
    try {
      await this.start();
      callback(null);
    } catch (error) {
      this.stop();
      callback(toError(error));
    }
  }

  private async writeAsync(
    generatorModule: ScriptedGeneratorModule,
    buffer: Buffer,
    context: ScriptedGeneratorContext,
    callback: (error: Error | null | undefined) => void,
  ): Promise<void> {
    try {
      await generatorModule.onWrite?.(buffer, context);
      callback(null);
    } catch (error) {
      const formattedError = toError(error);
      this.emit("error", formattedError);
      callback(formattedError);
    }
  }

  private async start(): Promise<void> {
    this.openState = true;
    this.abortController = new AbortController();
    this.context = this.createContext(this.abortController.signal);
    this.generatorModule = await this.loadGenerator();
    void this.runGenerator(this.generatorModule, this.context);
  }

  private stop(): void {
    this.abortController?.abort();
    this.abortController = undefined;
    this.generatorModule = undefined;
    this.context = undefined;
    this.openState = false;
  }

  private async loadGenerator(): Promise<ScriptedGeneratorModule> {
    const loadGenerator = this.options.loadGenerator ?? loadScriptedGenerator;
    const generatorModule = await loadGenerator(this.definition.generatorPath);

    if (typeof generatorModule.generate !== "function") {
      throw new Error(`Generator ${this.definition.generatorPath} does not export generate().`);
    }

    return generatorModule;
  }

  private createContext(signal: AbortSignal): ScriptedGeneratorContext {
    return {
      portId: this.definition.path,
      label: this.definition.label,
      baudRate: this.requestedBaudRate,
      options: this.definition.options,
      signal,
      sleep: (ms) => sleep(ms, signal),
      log: (message) => {
        const log = this.options.log ?? (() => undefined);
        log(`[${this.definition.path}] ${message}`);
      },
    };
  }

  private async runGenerator(
    generatorModule: ScriptedGeneratorModule,
    context: ScriptedGeneratorContext,
  ): Promise<void> {
    try {
      for await (const chunk of generatorModule.generate(context)) {
        if (context.signal.aborted || !this.openState) {
          return;
        }

        this.emit("data", Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
    } catch (error) {
      if (!context.signal.aborted) {
        this.emit("error", toError(error));
      }
    }
  }
}

export async function loadScriptedGenerator(
  generatorPath: string,
): Promise<ScriptedGeneratorModule> {
  const module: unknown = await import(pathToFileURL(generatorPath).href);

  if (!isScriptedGeneratorModule(module)) {
    throw new Error(`Generator ${generatorPath} does not export generate().`);
  }

  return module;
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
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

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isScriptedGeneratorModule(value: unknown): value is ScriptedGeneratorModule {
  return (
    typeof value === "object" &&
    value !== null &&
    "generate" in value &&
    typeof value.generate === "function" &&
    (!("onWrite" in value) || value.onWrite === undefined || typeof value.onWrite === "function")
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
