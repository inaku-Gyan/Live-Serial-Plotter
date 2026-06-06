import type {
  FramePlot2dOutputConfig,
  OutputConfig,
  OutputPacket,
  ParsedRecord,
  TerminalAppendOutputConfig,
  TerminalFrameOutputConfig,
  TimeSeriesLineOutputConfig,
} from "../shared/protocol";
import { getFieldValue, getNumberField } from "./fieldPath";
import { TimeAxisResolver } from "./TimeAxisResolver";

export interface OutputMapper {
  map(record: ParsedRecord): OutputPacket[];
  reset(): void;
}

export function createOutputMapper(config: OutputConfig): OutputMapper {
  if (config.kind === "terminalAppend") {
    return new TerminalAppendMapper(config);
  }

  if (config.kind === "terminalFrame") {
    return new TerminalFrameMapper(config);
  }

  if (config.kind === "timeSeriesLine") {
    return new TimeSeriesLineMapper(config);
  }

  return new FramePlot2dMapper(config);
}

class TerminalAppendMapper implements OutputMapper {
  constructor(private readonly config: TerminalAppendOutputConfig) {}

  map(record: ParsedRecord): OutputPacket[] {
    const text =
      this.config.source === "template" && this.config.template !== undefined
        ? formatTemplate(this.config.template, record)
        : record.raw;

    return [
      {
        kind: "terminalAppend",
        outputId: this.config.id,
        seq: record.seq,
        receivedAt: record.receivedAt,
        lines: [{ text }],
      },
    ];
  }

  reset(): void {}
}

class TerminalFrameMapper implements OutputMapper {
  constructor(private readonly config: TerminalFrameOutputConfig) {}

  map(record: ParsedRecord): OutputPacket[] {
    return [
      {
        kind: "terminalFrame",
        outputId: this.config.id,
        seq: record.seq,
        receivedAt: record.receivedAt,
        frameId: getFrameId(this.config.frameId?.field, record),
        text: formatTemplate(this.config.template, record),
      },
    ];
  }

  reset(): void {}
}

class TimeSeriesLineMapper implements OutputMapper {
  private readonly timeAxis: TimeAxisResolver;

  constructor(private readonly config: TimeSeriesLineOutputConfig) {
    this.timeAxis = new TimeAxisResolver(config.time);
  }

  map(record: ParsedRecord): OutputPacket[] {
    const time = this.timeAxis.next(record);

    if (time === null) {
      return [];
    }

    const values: Record<string, number> = {};

    for (const [seriesName, series] of Object.entries(this.config.series)) {
      const value = getNumberField(record.fields, series.field);

      if (value !== null) {
        values[seriesName] = value * (series.scale ?? 1);
      }
    }

    if (Object.keys(values).length === 0) {
      return [];
    }

    return [
      {
        kind: "timeSeriesAppend",
        outputId: this.config.id,
        seq: record.seq,
        receivedAt: record.receivedAt,
        samples: [{ time, values }],
      },
    ];
  }

  reset(): void {
    this.timeAxis.reset();
  }
}

class FramePlot2dMapper implements OutputMapper {
  constructor(private readonly config: FramePlot2dOutputConfig) {}

  map(record: ParsedRecord): OutputPacket[] {
    const rawPoints = getFieldValue(record.fields, this.config.points.field);

    if (!Array.isArray(rawPoints)) {
      return [];
    }

    const points = rawPoints.flatMap((point) => {
      if (!isRecord(point)) {
        return [];
      }

      const x = getNumberField(point, this.config.points.x);
      const y = getNumberField(point, this.config.points.y);

      if (x === null || y === null) {
        return [];
      }

      return [{ x, y }];
    });

    if (points.length === 0) {
      return [];
    }

    return [
      {
        kind: "framePlot2d",
        outputId: this.config.id,
        seq: record.seq,
        receivedAt: record.receivedAt,
        frameId: getFrameId(this.config.frameId?.field, record),
        bounds: this.config.bounds,
        layers: [{ kind: "points", points }],
      },
    ];
  }

  reset(): void {}
}

function formatTemplate(template: string, record: ParsedRecord): string {
  return template.replaceAll(/\{([^}]+)\}/g, (_match, rawPath: string) => {
    const path = rawPath.trim();

    if (path === "raw") {
      return record.raw;
    }

    if (path === "seq") {
      return String(record.seq);
    }

    if (path === "receivedAt") {
      return String(record.receivedAt);
    }

    const value = getFieldValue(record.fields, path);
    return value === undefined ? "" : String(value);
  });
}

function getFrameId(field: string | undefined, record: ParsedRecord): string | number {
  if (field === undefined) {
    return record.seq;
  }

  const value = getFieldValue(record.fields, field);
  return typeof value === "string" || typeof value === "number" ? value : record.seq;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
