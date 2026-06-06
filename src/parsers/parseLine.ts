import type {
  BuiltinParserConfig,
  Frame,
  JsonObject,
  ParserMode,
  PlotSample,
} from "../shared/protocol";

export interface ParsedLine {
  values: Record<string, number>;
}

export interface LineParser {
  parseFrame(frame: Frame): ParsedRecordInput[];
  reset(): void;
  dispose?(): void;
}

export interface ParsedRecordInput {
  fields: Record<string, unknown>;
}

export class BuiltinLineParser implements LineParser {
  private csvHeaders: string[] | undefined;
  private lastFields: Record<string, unknown> = {};

  constructor(private readonly config: BuiltinParserConfig) {}

  parseFrame(frame: Frame): ParsedRecordInput[] {
    const fields = this.parseRawLine(frame.raw);

    if (fields === null) {
      return [];
    }

    return [{ fields }];
  }

  reset(): void {
    this.csvHeaders = undefined;
    this.lastFields = {};
  }

  private parseRawLine(line: string): Record<string, unknown> | null {
    const trimmed = line.trim();

    if (trimmed.length === 0 || this.config.mode === "raw") {
      return {};
    }

    const fields =
      this.config.mode === "auto"
        ? this.parseAuto(trimmed)
        : this.parseByMode(trimmed, this.config.mode);

    if (fields === null) {
      return null;
    }

    return this.applyCarryForward(fields);
  }

  private parseAuto(line: string): Record<string, unknown> {
    const jsonLine = this.parseJsonLine(line);

    if (hasFields(jsonLine)) {
      return jsonLine;
    }

    const keyValue = this.parseKeyValue(line);

    if (hasFields(keyValue)) {
      return keyValue;
    }

    return this.parseCsv(line) ?? {};
  }

  private parseByMode(line: string, parserMode: ParserMode): Record<string, unknown> | null {
    if (parserMode === "csv") {
      return this.parseCsv(line);
    }

    if (parserMode === "jsonl") {
      return this.parseJsonLine(line);
    }

    if (parserMode === "keyValue") {
      return this.parseKeyValue(line);
    }

    return {};
  }

  private parseCsv(line: string): Record<string, unknown> | null {
    const delimiter = getStringOption(this.config.options, "delimiter") ?? ",";
    const parts = line.split(delimiter).map((part) => part.trim());
    const headerOption = this.config.options?.header;

    if (Array.isArray(headerOption)) {
      return parseCsvValues(parts, headerOption.map(String));
    }

    if (headerOption === true || headerOption === "firstLine") {
      if (this.csvHeaders === undefined) {
        this.csvHeaders = parts;
        return {};
      }

      return parseCsvValues(parts, this.csvHeaders);
    }

    return parseCsvValues(
      parts,
      parts.map((_, index) => `channel${index + 1}`),
    );
  }

  private parseJsonLine(line: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(line) as unknown;

      if (!isPlainObject(parsed)) {
        return {};
      }

      if (this.config.options?.flatten === true) {
        return flattenObject(parsed);
      }

      return parsed;
    } catch {
      return {};
    }
  }

  private parseKeyValue(line: string): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    const matches = line.matchAll(
      /([A-Za-z_][\w.-]*)\s*[:=]\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/gi,
    );

    for (const match of matches) {
      const key = match[1];
      const rawValue = match[2];

      if (key === undefined || rawValue === undefined) {
        continue;
      }

      const value = Number(rawValue);

      if (Number.isFinite(value)) {
        values[key] = value;
      }
    }

    return values;
  }

  private applyCarryForward(fields: Record<string, unknown>): Record<string, unknown> {
    if (this.config.options?.carryForward !== true || !hasFields(fields)) {
      return fields;
    }

    this.lastFields = {
      ...this.lastFields,
      ...fields,
    };

    return { ...this.lastFields };
  }
}

export function parseLine(line: string, parserMode: ParserMode): ParsedLine {
  const parser = new BuiltinLineParser({ kind: "builtin", mode: parserMode });
  const records = parser.parseFrame({ seq: 1, receivedAt: Date.now(), raw: line });
  const fields = records[0]?.fields ?? {};

  return {
    values: getNumericFields(fields),
  };
}

export function toPlotSample(
  line: string,
  parserMode: ParserMode,
  t = Date.now(),
): PlotSample | null {
  const parsed = parseLine(line, parserMode);

  if (Object.keys(parsed.values).length === 0) {
    return null;
  }

  return {
    t,
    values: parsed.values,
  };
}

function parseCsvValues(
  parts: readonly string[],
  channelNames: readonly string[],
): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  for (const [index, part] of parts.entries()) {
    const value = Number(part);

    if (!Number.isFinite(value)) {
      return {};
    }

    values[channelNames[index] ?? `channel${index + 1}`] = value;
  }

  return values;
}

function flattenObject(value: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const fields: Record<string, unknown> = {};

  for (const [key, fieldValue] of Object.entries(value)) {
    const path = prefix.length === 0 ? key : `${prefix}.${key}`;

    if (isPlainObject(fieldValue)) {
      Object.assign(fields, flattenObject(fieldValue, path));
      continue;
    }

    fields[path] = fieldValue;
  }

  return fields;
}

function getNumericFields(fields: Record<string, unknown>): Record<string, number> {
  const values: Record<string, number> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      values[key] = value;
    }
  }

  return values;
}

function getStringOption(options: JsonObject | undefined, key: string): string | undefined {
  const value = options?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function hasFields(fields: Record<string, unknown>): boolean {
  return Object.keys(fields).length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
