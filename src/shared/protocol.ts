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

export type ProfileScope = "builtin" | "user" | "workspace";

export interface ProfileRef {
  scope: ProfileScope;
  id: string;
  workspaceFolderUri?: string;
}

export interface ProfileSummary {
  key: string;
  ref: ProfileRef;
  id: string;
  name: string;
  scope: ProfileScope;
  workspaceName?: string;
}

export interface ProfileSourceMetadata {
  key: string;
  ref: ProfileRef;
  scope: ProfileScope;
  filePath?: string;
  workspaceFolderUri?: string;
  workspaceName?: string;
}

export interface ProfileEditorState {
  profiles: ProfileSummary[];
  selectedProfile: ProfileConfig;
  selectedProfileKey: string;
  selectedSource: ProfileSourceMetadata;
  errors: string[];
}

export interface ProfileConfig {
  schemaVersion: 2;
  id: string;
  name: string;
  serialDefaults?: SerialDefaultsConfig;
  codec: CodecConfig;
  framing: FramingConfig;
  parser: ParserConfig;
  outputs: OutputConfig[];
  export?: ExportConfig;
}

export interface SerialDefaultsConfig {
  baudRate?: number;
}

export type LineEnding = "none" | "lf" | "crlf" | "cr";

export type CodecConfig = TextCodecConfig;

export interface TextCodecConfig {
  kind: "text";
  encoding: "utf8";
  sendLineEnding?: LineEnding;
}

export interface LineFramingConfig {
  kind: "line";
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
  | { type: "requestProfiles"; profileKey?: string }
  | { type: "selectProfile"; profileKey: string }
  | { type: "connect"; settings: ConnectionSettings }
  | { type: "disconnect" }
  | { type: "send"; text: string }
  | { type: "setParserMode"; parserMode: ParserMode }
  | { type: "clearLog" };

export type ToWebviewMessage =
  | { type: "ports"; ports: SerialPortSummary[] }
  | {
      type: "profiles";
      profiles: ProfileSummary[];
      activeProfile: ProfileConfig;
      activeProfileKey: string;
    }
  | { type: "activeProfile"; profile: ProfileConfig; profileKey: string }
  | { type: "outputPacket"; packet: OutputPacket }
  | { type: "connectionState"; state: ConnectionState }
  | { type: "rawLine"; line: string; t: number }
  | { type: "seriesAppend"; samples: PlotSample[] }
  | { type: "error"; message: string };

export type ToProfileEditorMessage =
  | { type: "requestProfileEditorState"; profileKey?: string }
  | { type: "selectProfileForEdit"; profileKey: string }
  | { type: "autoSaveProfile"; profile: ProfileConfig }
  | { type: "copyProfile"; profile: ProfileConfig }
  | { type: "openProfileJson" };

export type ToProfileEditorWebviewMessage =
  | { type: "profileEditorState"; state: ProfileEditorState }
  | { type: "requestCopyProfile" }
  | { type: "profileAutoSaved"; profileKey: string; filePath: string }
  | { type: "profileCopied"; profileKey: string; filePath: string }
  | { type: "error"; message: string };

export function isParserMode(value: string): value is ParserMode {
  return parserModes.includes(value as ParserMode);
}
