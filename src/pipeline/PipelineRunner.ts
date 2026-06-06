import { BuiltinLineParser, type LineParser } from "../parsers/parseLine";
import type {
  BuiltinParserConfig,
  CodecConfig,
  Frame,
  FramingConfig,
  OutputConfig,
  OutputPacket,
  ParsedRecord,
  ParserConfig,
} from "../shared/protocol";
import { LineFramer } from "./LineFramer";
import { createOutputMapper, type OutputMapper } from "./OutputMapper";

export interface PipelineRunnerOptions {
  readonly codec: CodecConfig;
  readonly framing: FramingConfig;
  readonly parser: ParserConfig;
  readonly outputs: readonly OutputConfig[];
  readonly scriptParserLoader?: AsyncScriptParserLoader;
  readonly onPacket: (packet: OutputPacket) => void;
  readonly onError?: (message: string) => void;
  readonly parserInstance?: LineParser;
}

export interface AsyncScriptParserLoader {
  load(config: Exclude<ParserConfig, BuiltinParserConfig>): Promise<LineParser>;
}

export class PipelineRunner {
  private readonly framer: LineFramer;
  private readonly parser: LineParser;
  private readonly outputMappers: OutputMapper[];

  constructor(private readonly options: PipelineRunnerOptions) {
    this.framer = new LineFramer(options.framing, options.codec);
    this.parser = options.parserInstance ?? createBuiltinParser(options.parser);
    this.outputMappers = options.outputs.map(createOutputMapper);
  }

  static async create(options: PipelineRunnerOptions): Promise<PipelineRunner> {
    if (options.parser.kind === "builtin") {
      return new PipelineRunner(options);
    }

    if (options.scriptParserLoader === undefined) {
      throw new Error("Script parser support is not configured.");
    }

    return new PipelineRunner({
      ...options,
      parserInstance: await options.scriptParserLoader.load(options.parser),
    });
  }

  handleBytes(chunk: Buffer | Uint8Array, receivedAt = Date.now()): void {
    const frames = this.framer.push(chunk, receivedAt);

    for (const frame of frames) {
      this.handleFrame(frame);
    }
  }

  flush(receivedAt = Date.now()): void {
    const frames = this.framer.flush(receivedAt);

    for (const frame of frames) {
      this.handleFrame(frame);
    }
  }

  reset(): void {
    this.framer.reset();
    this.parser.reset();

    for (const outputMapper of this.outputMappers) {
      outputMapper.reset();
    }
  }

  dispose(): void {
    this.parser.dispose?.();
  }

  private handleFrame(frame: Frame): void {
    try {
      const parsedRecords = this.parser.parseFrame(frame);

      for (const parsedRecord of parsedRecords) {
        this.dispatchRecord({
          seq: frame.seq,
          receivedAt: frame.receivedAt,
          raw: frame.raw,
          fields: parsedRecord.fields,
        });
      }
    } catch (error) {
      this.options.onError?.(formatError(error));
    }
  }

  private dispatchRecord(record: ParsedRecord): void {
    for (const outputMapper of this.outputMappers) {
      for (const packet of outputMapper.map(record)) {
        this.options.onPacket(packet);
      }
    }
  }
}

function createBuiltinParser(config: ParserConfig): LineParser {
  if (config.kind !== "builtin") {
    throw new Error("Script parser support requires PipelineRunner.create().");
  }

  return new BuiltinLineParser(config);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
