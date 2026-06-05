import { StringDecoder } from 'node:string_decoder';

export class LineDecoder {
  private readonly decoder = new StringDecoder('utf8');
  private bufferedText = '';

  push(chunk: Buffer | Uint8Array): string[] {
    this.bufferedText += this.decoder.write(Buffer.from(chunk));
    return this.takeCompleteLines();
  }

  flush(): string[] {
    this.bufferedText += this.decoder.end();

    if (this.bufferedText.length === 0) {
      return [];
    }

    const line = stripTrailingCarriageReturn(this.bufferedText);
    this.bufferedText = '';
    return [line];
  }

  reset(): void {
    this.bufferedText = '';
  }

  private takeCompleteLines(): string[] {
    const parts = this.bufferedText.split('\n');
    this.bufferedText = parts.pop() ?? '';
    return parts.map(stripTrailingCarriageReturn);
  }
}

function stripTrailingCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}
