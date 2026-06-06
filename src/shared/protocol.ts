export const parserModes = ["auto", "raw", "csv", "jsonl", "keyValue"] as const;

export type ParserMode = (typeof parserModes)[number];

export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface SerialPortSummary {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
}

export interface ConnectionSettings {
  path: string;
  baudRate: number;
  parserMode?: ParserMode;
  profileId?: string;
}

export interface PlotSample {
  t: number;
  values: Record<string, number>;
}

export interface ConnectionState {
  connected: boolean;
  path?: string;
  baudRate?: number;
}

export interface ProfileSummary {
  id: string;
  name: string;
  scope: "builtin" | "user" | "workspace";
}

export interface ProfileConfig {
  schemaVersion: 1;
  id: string;
  name: string;
  connection: ConnectionConfig;
  framing: FramingConfig;
  parser: ParserConfig;
  outputs: OutputConfig[];
  export?: ExportConfig;
}

export interface ConnectionConfig {
  baudRate: number;
  path?: string;
  lineEnding?: "none" | "lf" | "crlf" | "cr";
}

export interface LineFramingConfig {
  kind: "line";
  encoding: "utf8";
  delimiter: "auto" | "lf" | "crlf" | "cr";
  trim?: boolean;
  maxFrameBytes?: number;
}

export type FramingConfig = LineFramingConfig;

export type ParserConfig = BuiltinParserConfig | ScriptParserConfig;

export interface BuiltinParserConfig {
  kind: "builtin";
  mode: ParserMode;
  options?: JsonObject;
}

export interface ScriptParserConfig {
  kind: "script";
  path: string;
  options?: JsonObject;
}

export interface ExportConfig {
  mode: "raw" | "parsed" | "packets";
  format: "txt" | "csv" | "jsonl";
  includeMetadata?: boolean;
}

export type OutputConfig =
  | TerminalAppendOutputConfig
  | TerminalFrameOutputConfig
  | TimeSeriesLineOutputConfig
  | FramePlot2dOutputConfig;

export interface OutputConfigBase {
  id: string;
  title?: string;
}

export interface TerminalAppendOutputConfig extends OutputConfigBase {
  kind: "terminalAppend";
  source?: "raw" | "template";
  template?: string;
  maxLines?: number;
  autoScroll?: boolean;
  style?: TerminalStyleConfig;
}

export interface TerminalFrameOutputConfig extends OutputConfigBase {
  kind: "terminalFrame";
  template: string;
  frameId?: FieldReferenceConfig;
  style?: TerminalStyleConfig;
}

export interface TerminalStyleConfig {
  font?: "editor" | "ui";
  wrap?: boolean;
  levels?: Partial<Record<TerminalLineLevel, TerminalLineStyle>>;
}

export type TerminalLineLevel = "info" | "warn" | "error" | "debug";

export interface TerminalLineStyle {
  color?: string;
}

export interface TimeSeriesLineOutputConfig extends OutputConfigBase {
  kind: "timeSeriesLine";
  time: TimeAxisConfig;
  series: Record<string, TimeSeriesConfig>;
  window?: {
    mode: "points" | "duration";
    maxPoints?: number;
    seconds?: number;
  };
  style?: {
    showLegend?: boolean;
  };
}

export interface TimeSeriesConfig {
  field: string;
  label?: string;
  unit?: string;
  scale?: number;
  color?: string;
  visible?: boolean;
  line?: {
    width?: number;
    dash?: "solid" | "dash";
  };
  format?: {
    decimals?: number;
  };
}

export type TimeAxisConfig =
  | { source: "hostReceived"; unit?: "s" | "ms"; zero?: "none" | "first" }
  | { source: "field"; field: string; unit: "s" | "ms" | "us"; zero?: "none" | "first" }
  | { source: "fixedInterval"; intervalMs: number }
  | { source: "sequence" };

export interface FramePlot2dOutputConfig extends OutputConfigBase {
  kind: "framePlot2d";
  frameId?: FieldReferenceConfig;
  bounds?: {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
  };
  points: {
    field: string;
    x: string;
    y: string;
  };
  styles?: Record<string, Plot2dPointStyle>;
}

export interface FieldReferenceConfig {
  source: "field";
  field: string;
}

export interface Plot2dPointStyle {
  color?: string;
  size?: number;
}

export interface Frame {
  seq: number;
  receivedAt: number;
  raw: string;
}

export interface ParsedRecord {
  seq: number;
  receivedAt: number;
  raw: string;
  fields: Record<string, unknown>;
}

export type OutputPacket =
  | TerminalAppendPacket
  | TerminalFramePacket
  | TimeSeriesAppendPacket
  | FramePlot2dPacket;

export interface OutputPacketBase {
  outputId: string;
  seq: number;
  receivedAt: number;
}

export interface TerminalAppendPacket extends OutputPacketBase {
  kind: "terminalAppend";
  lines: TerminalLine[];
}

export interface TerminalLine {
  text: string;
  level?: TerminalLineLevel;
  timestamp?: number;
}

export interface TerminalFramePacket extends OutputPacketBase {
  kind: "terminalFrame";
  frameId: string | number;
  text: string;
}

export interface TimeSeriesAppendPacket extends OutputPacketBase {
  kind: "timeSeriesAppend";
  samples: TimeSeriesSample[];
}

export interface TimeSeriesSample {
  time: number;
  values: Record<string, number>;
}

export interface FramePlot2dPacket extends OutputPacketBase {
  kind: "framePlot2d";
  frameId: string | number;
  bounds?: {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
  };
  layers: Plot2dLayer[];
}

export interface Plot2dLayer {
  kind: "points";
  points: Plot2dPoint[];
}

export interface Plot2dPoint {
  x: number;
  y: number;
  styleKey?: string;
  color?: string;
  size?: number;
}

export type ToExtensionMessage =
  | { type: "requestPorts" }
  | { type: "requestProfiles" }
  | { type: "selectProfile"; profileId: string }
  | { type: "connect"; settings: ConnectionSettings }
  | { type: "disconnect" }
  | { type: "send"; text: string }
  | { type: "setParserMode"; parserMode: ParserMode }
  | { type: "clearLog" };

export type ToWebviewMessage =
  | { type: "ports"; ports: SerialPortSummary[] }
  | { type: "profiles"; profiles: ProfileSummary[]; activeProfile: ProfileConfig }
  | { type: "activeProfile"; profile: ProfileConfig }
  | { type: "outputPacket"; packet: OutputPacket }
  | { type: "connectionState"; state: ConnectionState }
  | { type: "rawLine"; line: string; t: number }
  | { type: "seriesAppend"; samples: PlotSample[] }
  | { type: "error"; message: string };

export function isParserMode(value: string): value is ParserMode {
  return parserModes.includes(value as ParserMode);
}
