import type {
  JsonObject,
  LineEnding,
  ParserMode,
  ProfileConfig,
  TerminalAppendOutputConfig,
  TimeAxisConfig,
  TimeSeriesLineOutputConfig,
} from "../../src/shared/protocol";

export interface ProfileEditorPatch {
  id: string;
  name: string;
  serialDefaults: {
    baudRate: string;
  };
  codec: {
    sendLineEnding: LineEnding;
  };
  framing: {
    delimiter: "auto" | "lf" | "crlf" | "cr";
    trim: boolean;
    maxFrameBytes: string;
  };
  builtinParser:
    | {
        mode: ParserMode;
        optionsJson: string;
      }
    | undefined;
  terminalAppendOutputs: TerminalAppendOutputPatch[];
  timeSeriesOutputs: TimeSeriesOutputPatch[];
}

export interface TerminalAppendOutputPatch {
  originalId: string;
  id: string;
  title: string;
  source: "raw" | "template";
  template: string;
  maxLines: string;
  autoScroll: boolean;
}

export interface TimeSeriesOutputPatch {
  originalId: string;
  id: string;
  title: string;
  time: TimeAxisPatch;
  maxPoints: string;
  series: TimeSeriesPatch[];
}

export interface TimeAxisPatch {
  source: "hostReceived" | "field" | "fixedInterval" | "sequence";
  field: string;
  unit: "s" | "ms" | "us";
  zero: "none" | "first";
  intervalMs: string;
}

export interface TimeSeriesPatch {
  key: string;
  field: string;
  label: string;
  unit: string;
  color: string;
  visible: boolean;
  scale: string;
  lineWidth: string;
  decimals: string;
}

export function createProfileEditorPatch(profile: ProfileConfig): ProfileEditorPatch {
  return {
    id: profile.id,
    name: profile.name,
    serialDefaults: {
      baudRate:
        profile.serialDefaults?.baudRate === undefined
          ? ""
          : String(profile.serialDefaults.baudRate),
    },
    codec: {
      sendLineEnding: profile.codec.sendLineEnding ?? "none",
    },
    framing: {
      delimiter: profile.framing.delimiter,
      trim: profile.framing.trim === true,
      maxFrameBytes:
        profile.framing.maxFrameBytes === undefined ? "" : String(profile.framing.maxFrameBytes),
    },
    builtinParser:
      profile.parser.kind === "builtin"
        ? {
            mode: profile.parser.mode,
            optionsJson:
              profile.parser.options === undefined
                ? ""
                : JSON.stringify(profile.parser.options, null, 2),
          }
        : undefined,
    terminalAppendOutputs: profile.outputs.flatMap((output) =>
      output.kind === "terminalAppend"
        ? [
            {
              originalId: output.id,
              id: output.id,
              title: output.title ?? "",
              source: output.source ?? "raw",
              template: output.template ?? "",
              maxLines: output.maxLines === undefined ? "" : String(output.maxLines),
              autoScroll: output.autoScroll !== false,
            },
          ]
        : [],
    ),
    timeSeriesOutputs: profile.outputs.flatMap((output) =>
      output.kind === "timeSeriesLine"
        ? [
            {
              originalId: output.id,
              id: output.id,
              title: output.title ?? "",
              time: createTimeAxisPatch(output.time),
              maxPoints:
                output.window?.maxPoints === undefined ? "" : String(output.window.maxPoints),
              series: Object.entries(output.series).map(([key, series]) => ({
                key,
                field: series.field,
                label: series.label ?? "",
                unit: series.unit ?? "",
                color: series.color ?? "",
                visible: series.visible !== false,
                scale: series.scale === undefined ? "" : String(series.scale),
                lineWidth: series.line?.width === undefined ? "" : String(series.line.width),
                decimals:
                  series.format?.decimals === undefined ? "" : String(series.format.decimals),
              })),
            },
          ]
        : [],
    ),
  };
}

export function applyProfileEditorPatch(
  profile: ProfileConfig,
  patch: ProfileEditorPatch,
): ProfileConfig {
  return {
    ...profile,
    id: nonEmptyOr(patch.id, profile.id),
    name: nonEmptyOr(patch.name, profile.name),
    serialDefaults: createSerialDefaults(patch),
    codec: {
      ...profile.codec,
      sendLineEnding: patch.codec.sendLineEnding,
    },
    framing: {
      ...profile.framing,
      delimiter: patch.framing.delimiter,
      trim: patch.framing.trim,
      maxFrameBytes: parseOptionalNumber(patch.framing.maxFrameBytes),
    },
    parser:
      profile.parser.kind === "builtin" && patch.builtinParser !== undefined
        ? {
            ...profile.parser,
            mode: patch.builtinParser.mode,
            options: parseJsonObjectOrUndefined(patch.builtinParser.optionsJson),
          }
        : profile.parser,
    outputs: profile.outputs.map((output) => {
      if (output.kind === "terminalAppend") {
        return applyTerminalAppendPatch(output, patch.terminalAppendOutputs);
      }

      if (output.kind === "timeSeriesLine") {
        return applyTimeSeriesPatch(output, patch.timeSeriesOutputs);
      }

      return output;
    }),
  };
}

function applyTerminalAppendPatch(
  output: TerminalAppendOutputConfig,
  patches: readonly TerminalAppendOutputPatch[],
): TerminalAppendOutputConfig {
  const patch = patches.find((candidate) => candidate.originalId === output.id);

  if (patch === undefined) {
    return output;
  }

  return {
    ...output,
    id: nonEmptyOr(patch.id, output.id),
    title: emptyToUndefined(patch.title),
    source: patch.source,
    template: patch.source === "template" ? patch.template : undefined,
    maxLines: parseOptionalNumber(patch.maxLines),
    autoScroll: patch.autoScroll,
  };
}

function createSerialDefaults(patch: ProfileEditorPatch): ProfileConfig["serialDefaults"] {
  const baudRate = parseOptionalNumber(patch.serialDefaults.baudRate);

  return baudRate === undefined ? undefined : { baudRate };
}

function applyTimeSeriesPatch(
  output: TimeSeriesLineOutputConfig,
  patches: readonly TimeSeriesOutputPatch[],
): TimeSeriesLineOutputConfig {
  const patch = patches.find((candidate) => candidate.originalId === output.id);

  if (patch === undefined) {
    return output;
  }

  return {
    ...output,
    id: nonEmptyOr(patch.id, output.id),
    title: emptyToUndefined(patch.title),
    time: createTimeAxisConfig(patch.time, output.time),
    window: {
      ...output.window,
      mode: output.window?.mode ?? "points",
      maxPoints: parseOptionalNumber(patch.maxPoints),
    },
    series: Object.fromEntries(
      patch.series
        .filter((series) => series.key.trim().length > 0 && series.field.trim().length > 0)
        .map((series) => {
          const key = series.key.trim();
          const existingSeries = output.series[key];

          return [
            key,
            {
              ...existingSeries,
              field: series.field.trim(),
              label: emptyToUndefined(series.label),
              unit: emptyToUndefined(series.unit),
              color: emptyToUndefined(series.color),
              visible: series.visible,
              scale: parseOptionalNumber(series.scale),
              line: {
                ...existingSeries?.line,
                width: parseOptionalNumber(series.lineWidth),
              },
              format: {
                ...existingSeries?.format,
                decimals: parseOptionalNumber(series.decimals),
              },
            },
          ];
        }),
    ),
  };
}

function createTimeAxisConfig(patch: TimeAxisPatch, fallback: TimeAxisConfig): TimeAxisConfig {
  if (patch.source === "hostReceived") {
    return {
      source: "hostReceived",
      unit: patch.unit === "us" ? "s" : patch.unit,
      zero: patch.zero,
    };
  }

  if (patch.source === "field") {
    return {
      source: "field",
      field: nonEmptyOr(patch.field, fallback.source === "field" ? fallback.field : "time"),
      unit: patch.unit,
      zero: patch.zero,
    };
  }

  if (patch.source === "fixedInterval") {
    return {
      source: "fixedInterval",
      intervalMs: parseNumberOr(
        patch.intervalMs,
        fallback.source === "fixedInterval" ? fallback.intervalMs : 10,
      ),
    };
  }

  return { source: "sequence" };
}

function createTimeAxisPatch(time: TimeAxisConfig): TimeAxisPatch {
  if (time.source === "hostReceived") {
    return {
      source: "hostReceived",
      field: "",
      unit: time.unit ?? "s",
      zero: time.zero ?? "first",
      intervalMs: "",
    };
  }

  if (time.source === "field") {
    return {
      source: "field",
      field: time.field,
      unit: time.unit,
      zero: time.zero ?? "first",
      intervalMs: "",
    };
  }

  if (time.source === "fixedInterval") {
    return {
      source: "fixedInterval",
      field: "",
      unit: "ms",
      zero: "none",
      intervalMs: String(time.intervalMs),
    };
  }

  return {
    source: "sequence",
    field: "",
    unit: "ms",
    zero: "none",
    intervalMs: "",
  };
}

function parseJsonObjectOrUndefined(text: string): JsonObject | undefined {
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  const parsed = JSON.parse(trimmed) as unknown;

  if (!isJsonObject(parsed)) {
    throw new Error("Parser options must be a JSON object.");
  }

  return parsed;
}

function nonEmptyOr(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed.length === 0 ? fallback : trimmed;
}

function isJsonObject(value: unknown): value is JsonObject {
  return isPlainObject(value) && Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonObject[keyof JsonObject] {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  return isJsonObject(value);
}

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseNumberOr(value: string, fallback: number): number {
  return parseOptionalNumber(value) ?? fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
