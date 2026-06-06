import { BuiltinLineParser, type LineParser } from "../parsers/parseLine";
import type {
  BuiltinParserConfig,
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
  readonly framing: FramingConfig;
  readonly parser: ParserConfig;
  readonly outputs: readonly OutputConfig[];
  readonly scriptParserLoader?: ScriptParserLoader;
  readonly onPacket: (packet: OutputPacket) => void;
  readonly onError?: (message: string) => void;
}

export interface ScriptParserLoader {
  load(config: Exclude<ParserConfig, BuiltinParserConfig>): LineParser;
}

export class PipelineRunner {
  private readonly framer: LineFramer;
  private readonly parser: LineParser;
  private readonly outputMappers: OutputMapper[];

  constructor(private readonly options: PipelineRunnerOptions) {
    this.framer = new LineFramer(options.framing);
    this.parser = createParser(options.parser, options.scriptParserLoader);
    this.outputMappers = options.outputs.map(createOutputMapper);
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

function createParser(
  config: ParserConfig,
  scriptParserLoader: ScriptParserLoader | undefined,
): LineParser {
  if (config.kind === "builtin") {
    return new BuiltinLineParser(config);
  }

  if (scriptParserLoader === undefined) {
    throw new Error("Script parser support is not configured.");
  }

  return scriptParserLoader.load(config);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
