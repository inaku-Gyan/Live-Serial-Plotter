import type {
  FramePlot2dPacket,
  OutputPacket,
  TerminalAppendPacket,
  TerminalFramePacket,
  TimeSeriesAppendPacket,
} from "../shared/protocol";

export class OutputPacketBatcher {
  private readonly terminalAppendPackets = new Map<string, TerminalAppendPacket>();
  private readonly timeSeriesPackets = new Map<string, TimeSeriesAppendPacket>();
  private readonly terminalFramePackets = new Map<string, TerminalFramePacket>();
  private readonly framePlot2dPackets = new Map<string, FramePlot2dPacket>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly flushIntervalMs: number,
    private readonly onFlush: (packet: OutputPacket) => void,
  ) {}

  add(packet: OutputPacket): void {
    if (packet.kind === "terminalAppend") {
      this.mergeTerminalAppend(packet);
    } else if (packet.kind === "timeSeriesAppend") {
      this.mergeTimeSeries(packet);
    } else if (packet.kind === "terminalFrame") {
      this.terminalFramePackets.set(packet.outputId, packet);
    } else {
      this.framePlot2dPackets.set(packet.outputId, packet);
    }

    this.scheduleFlush();
  }

  flush(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    for (const packet of this.terminalAppendPackets.values()) {
      this.onFlush(packet);
    }

    for (const packet of this.timeSeriesPackets.values()) {
      this.onFlush(packet);
    }

    for (const packet of this.terminalFramePackets.values()) {
      this.onFlush(packet);
    }

    for (const packet of this.framePlot2dPackets.values()) {
      this.onFlush(packet);
    }

    this.terminalAppendPackets.clear();
    this.timeSeriesPackets.clear();
    this.terminalFramePackets.clear();
    this.framePlot2dPackets.clear();
  }

  dispose(): void {
    this.flush();
  }

  private mergeTerminalAppend(packet: TerminalAppendPacket): void {
    const pending = this.terminalAppendPackets.get(packet.outputId);

    if (pending === undefined) {
      this.terminalAppendPackets.set(packet.outputId, { ...packet, lines: [...packet.lines] });
      return;
    }

    pending.seq = packet.seq;
    pending.receivedAt = packet.receivedAt;
    pending.lines.push(...packet.lines);
  }

  private mergeTimeSeries(packet: TimeSeriesAppendPacket): void {
    const pending = this.timeSeriesPackets.get(packet.outputId);

    if (pending === undefined) {
      this.timeSeriesPackets.set(packet.outputId, {
        ...packet,
        samples: [...packet.samples],
      });
      return;
    }

    pending.seq = packet.seq;
    pending.receivedAt = packet.receivedAt;
    pending.samples.push(...packet.samples);
  }

  private scheduleFlush(): void {
    if (this.timer !== undefined) {
      return;
    }

    this.timer = setTimeout(() => this.flush(), this.flushIntervalMs);
  }
}
