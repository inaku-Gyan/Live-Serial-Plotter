import type { ParserMode, PlotSample } from '../shared/protocol';

export interface ParsedLine {
  values: Record<string, number>;
}

export function parseLine(line: string, parserMode: ParserMode): ParsedLine {
  const trimmed = line.trim();

  if (trimmed.length === 0 || parserMode === 'raw') {
    return { values: {} };
  }

  if (parserMode === 'auto') {
    return parseAuto(trimmed);
  }

  if (parserMode === 'csv') {
    return parseCsv(trimmed);
  }

  if (parserMode === 'jsonl') {
    return parseJsonLine(trimmed);
  }

  return parseKeyValue(trimmed);
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

function parseAuto(line: string): ParsedLine {
  const jsonLine = parseJsonLine(line);

  if (hasValues(jsonLine)) {
    return jsonLine;
  }

  const keyValue = parseKeyValue(line);

  if (hasValues(keyValue)) {
    return keyValue;
  }

  return parseCsv(line);
}

function parseCsv(line: string): ParsedLine {
  const parts = line.split(',').map((part) => part.trim());
  const values: Record<string, number> = {};

  for (const [index, part] of parts.entries()) {
    const value = Number(part);

    if (!Number.isFinite(value)) {
      return { values: {} };
    }

    values[`channel${index + 1}`] = value;
  }

  return { values };
}

function parseJsonLine(line: string): ParsedLine {
  try {
    const parsed = JSON.parse(line) as unknown;

    if (!isPlainObject(parsed)) {
      return { values: {} };
    }

    const values: Record<string, number> = {};

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        values[key] = value;
      }
    }

    return { values };
  } catch {
    return { values: {} };
  }
}

function parseKeyValue(line: string): ParsedLine {
  const values: Record<string, number> = {};
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

  return { values };
}

function hasValues(parsedLine: ParsedLine): boolean {
  return Object.keys(parsedLine.values).length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
