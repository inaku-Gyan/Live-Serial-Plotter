import { StringDecoder } from "node:string_decoder";
import type { Frame, LineFramingConfig } from "../shared/protocol";

const defaultMaxFrameBytes = 65_536;

interface DelimiterMatch {
  readonly index: number;
  readonly nextIndex: number;
}

export class LineFramer {
  private readonly decoder = new StringDecoder("utf8");
  private bufferedText = "";
  private droppingOversizedFrame = false;
  private nextSeq = 1;

  constructor(private readonly config: LineFramingConfig = getDefaultLineFramingConfig()) {}

  push(chunk: Buffer | Uint8Array, receivedAt = Date.now()): Frame[] {
    this.bufferedText += this.decoder.write(Buffer.from(chunk));
    return this.takeCompleteFrames(receivedAt);
  }

  flush(receivedAt = Date.now()): Frame[] {
    this.bufferedText += this.decoder.end();

    if (this.droppingOversizedFrame) {
      this.bufferedText = "";
      this.droppingOversizedFrame = false;
      return [];
    }

    if (this.bufferedText.length === 0) {
      return [];
    }

    const raw = this.formatLine(this.bufferedText);
    this.bufferedText = "";

    if (this.exceedsMaxFrameBytes(raw)) {
      return [];
    }

    return [this.createFrame(raw, receivedAt)];
  }

  reset(): void {
    this.decoder.end();
    this.bufferedText = "";
    this.droppingOversizedFrame = false;
    this.nextSeq = 1;
  }

  private takeCompleteFrames(receivedAt: number): Frame[] {
    const frames: Frame[] = [];

    for (;;) {
      if (this.droppingOversizedFrame) {
        const delimiter = this.findDelimiter();

        if (delimiter === null) {
          this.bufferedText = "";
          return frames;
        }

        this.bufferedText = this.bufferedText.slice(delimiter.nextIndex);
        this.droppingOversizedFrame = false;
        continue;
      }

      const delimiter = this.findDelimiter();

      if (delimiter === null) {
        if (this.exceedsMaxFrameBytes(this.bufferedText)) {
          this.bufferedText = "";
          this.droppingOversizedFrame = true;
        }

        return frames;
      }

      const raw = this.formatLine(this.bufferedText.slice(0, delimiter.index));
      this.bufferedText = this.bufferedText.slice(delimiter.nextIndex);

      if (!this.exceedsMaxFrameBytes(raw)) {
        frames.push(this.createFrame(raw, receivedAt));
      }
    }
  }

  private findDelimiter(): DelimiterMatch | null {
    if (this.config.delimiter === "lf") {
      return findStringDelimiter(this.bufferedText, "\n");
    }

    if (this.config.delimiter === "crlf") {
      return findStringDelimiter(this.bufferedText, "\r\n");
    }

    if (this.config.delimiter === "cr") {
      return findStringDelimiter(this.bufferedText, "\r");
    }

    return findAutoDelimiter(this.bufferedText);
  }

  private formatLine(line: string): string {
    const normalized =
      this.config.delimiter === "lf" || this.config.delimiter === "auto"
        ? stripTrailingCarriageReturn(line)
        : line;

    return this.config.trim === true ? normalized.trim() : normalized;
  }

  private exceedsMaxFrameBytes(text: string): boolean {
    return Buffer.byteLength(text, this.config.encoding) > this.maxFrameBytes;
  }

  private get maxFrameBytes(): number {
    return this.config.maxFrameBytes ?? defaultMaxFrameBytes;
  }

  private createFrame(raw: string, receivedAt: number): Frame {
    const frame = {
      seq: this.nextSeq,
      receivedAt,
      raw,
    };
    this.nextSeq += 1;
    return frame;
  }
}

export function getDefaultLineFramingConfig(): LineFramingConfig {
  return {
    kind: "line",
    encoding: "utf8",
    delimiter: "auto",
  };
}

function findStringDelimiter(text: string, delimiter: string): DelimiterMatch | null {
  const index = text.indexOf(delimiter);

  if (index === -1) {
    return null;
  }

  return {
    index,
    nextIndex: index + delimiter.length,
  };
}

function findAutoDelimiter(text: string): DelimiterMatch | null {
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);

    if (char === "\n") {
      const lineEnd = index > 0 && text.charAt(index - 1) === "\r" ? index - 1 : index;
      return { index: lineEnd, nextIndex: index + 1 };
    }

    if (char === "\r") {
      const next = text.charAt(index + 1);

      if (next === "\n") {
        return { index, nextIndex: index + 2 };
      }

      if (index === text.length - 1) {
        return null;
      }

      return { index, nextIndex: index + 1 };
    }
  }

  return null;
}

function stripTrailingCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}
