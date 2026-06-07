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

/**
 * Serial protocol, parser, and output configuration for one Live Serial Plotter profile.
 */
export interface ProfileConfig {
  /**
   * Profile schema version. Version 3 is the only supported profile format.
   * @asType integer
   */
  schemaVersion: 3;
  /**
   * Profile id. It must be unique within its user or workspace namespace.
   * @minLength 1
   */
  id: string;
  /**
   * Human-readable profile name shown in the profile picker and sidebar.
   * @minLength 1
   */
  name: string;
  /**
   * Optional serial defaults suggested when this profile is selected.
   */
  serialDefaults?: SerialDefaultsConfig;
  /**
   * Monitor layout preset used when opening a new monitor page for this profile.
   */
  layout: ProfileLayoutConfig;
  /**
   * Codec used to decode received bytes and encode sent text.
   */
  codec: CodecConfig;
  /**
   * Framing strategy applied before parsing serial data.
   */
  framing: FramingConfig;
  /**
   * Parser used to convert frames into field records.
   */
  parser: ParserConfig;
  /**
   * Output sinks and renderers fed by parsed records.
   * @minItems 1
   */
  outputs: OutputConfig[];
  /**
   * Optional export defaults for future capture/export workflows.
   */
  export?: ExportConfig;
}

export interface ProfileLayoutConfig {
  /**
   * Layout preset key resolved from builtin, user, or workspace layout stores.
   * @minLength 1
   */
  defaultPreset: string;
}

export interface SerialDefaultsConfig {
  /**
   * Default serial baud rate suggested when this profile is selected.
   * @exclusiveMinimum 0
   */
  baudRate?: number;
}

export type LineEnding = "none" | "lf" | "crlf" | "cr";

export type CodecConfig = TextCodecConfig;

export interface TextCodecConfig {
  /**
   * Text codec is the only supported codec kind.
   */
  kind: "text";
  /**
   * UTF-8 is the only supported text encoding.
   */
  encoding: "utf8";
  /**
   * Line ending appended when sending text from the monitor page.
   */
  sendLineEnding?: LineEnding;
}

export interface LineFramingConfig {
  /**
   * Line framing is the only supported framing kind.
   */
  kind: "line";
  /**
   * Delimiter used to split decoded text into frames.
   */
  delimiter: "auto" | "lf" | "crlf" | "cr";
  /**
   * Whether to trim framed text before parsing.
   */
  trim?: boolean;
  /**
   * Maximum buffered frame size in bytes.
   * @exclusiveMinimum 0
   */
  maxFrameBytes?: number;
}

export type FramingConfig = LineFramingConfig;

export type ParserConfig = BuiltinParserConfig | ScriptParserConfig;

export interface BuiltinParserConfig {
  /**
   * Builtin parser selected by mode.
   */
  kind: "builtin";
  /**
   * Builtin parser mode.
   */
  mode: ParserMode;
  /**
   * Parser-specific JSON options.
   */
  options?: JsonObject;
}

export interface ScriptParserConfig {
  /**
   * Workspace script parser.
   */
  kind: "script";
  /**
   * Workspace-relative parser path under .live-serial-plotter/parsers.
   * @minLength 1
   */
  path: string;
  /**
   * Parser-specific JSON options passed to createParser().
   */
  options?: JsonObject;
}

export interface ExportConfig {
  /**
   * Data source exported by default.
   */
  mode: "raw" | "parsed" | "packets";
  /**
   * File format used by default.
   */
  format: "txt" | "csv" | "jsonl";
  /**
   * Whether export output should include metadata fields.
   */
  includeMetadata?: boolean;
}

export type OutputConfig =
  | TerminalAppendOutputConfig
  | TerminalFrameOutputConfig
  | TimeSeriesLineOutputConfig
  | FramePlot2dOutputConfig;

export interface OutputConfigBase {
  /**
   * Output id unique within this profile.
   * @minLength 1
   */
  id: string;
  /**
   * Human-readable output title.
   */
  title?: string;
}

export interface TerminalAppendOutputConfig extends OutputConfigBase {
  /**
   * Appends lines to a terminal-style log.
   */
  kind: "terminalAppend";
  /**
   * Text source for appended terminal lines.
   */
  source?: "raw" | "template";
  /**
   * Template used when source is `template`.
   */
  template?: string;
  /**
   * Maximum terminal lines retained by the Webview.
   * @exclusiveMinimum 0
   */
  maxLines?: number;
  /**
   * Whether the terminal should auto-scroll to new lines.
   */
  autoScroll?: boolean;
  /**
   * Terminal rendering style.
   */
  style?: TerminalStyleConfig;
}

export interface TerminalFrameOutputConfig extends OutputConfigBase {
  /**
   * Replaces a terminal frame by frame id.
   */
  kind: "terminalFrame";
  /**
   * Template rendered for each frame.
   */
  template: string;
  /**
   * Field used as the frame id. Falls back to sequence number.
   */
  frameId?: FieldReferenceConfig;
  /**
   * Terminal rendering style.
   */
  style?: TerminalStyleConfig;
}

export interface TerminalStyleConfig {
  /**
   * Font family source.
   */
  font?: "editor" | "ui";
  /**
   * Whether terminal text wraps.
   */
  wrap?: boolean;
  /**
   * Per-level line styles.
   */
  levels?: Partial<Record<TerminalLineLevel, TerminalLineStyle>>;
}

export type TerminalLineLevel = "info" | "warn" | "error" | "debug";

export interface TerminalLineStyle {
  /**
   * CSS color string.
   */
  color?: string;
}

export interface TimeSeriesLineOutputConfig extends OutputConfigBase {
  /**
   * Streams numeric samples to a time-series line chart.
   */
  kind: "timeSeriesLine";
  /**
   * Time axis configuration.
   */
  time: TimeAxisConfig;
  /**
   * Series map. Leave empty to plot all numeric parser fields automatically.
   */
  series: Record<string, TimeSeriesConfig>;
  /**
   * Rolling chart retention window.
   */
  window?: TimeSeriesWindowConfig;
  style?: {
    /**
     * Whether the chart legend is visible.
     */
    showLegend?: boolean;
  };
}

export type TimeSeriesWindowConfig = PointsTimeSeriesWindowConfig | DurationTimeSeriesWindowConfig;

export interface PointsTimeSeriesWindowConfig {
  /**
   * Retain a maximum number of samples.
   */
  mode: "points";
  /**
   * Maximum samples retained in points mode.
   * @exclusiveMinimum 0
   */
  maxPoints?: number;
}

export interface DurationTimeSeriesWindowConfig {
  /**
   * Retain samples for a rolling duration.
   */
  mode: "duration";
  /**
   * Rolling duration retained in duration mode.
   * @exclusiveMinimum 0
   */
  seconds?: number;
}

export interface TimeSeriesConfig {
  /**
   * Parsed field path used as the series value.
   * @minLength 1
   */
  field: string;
  /**
   * Human-readable series label.
   */
  label?: string;
  /**
   * Unit displayed beside values.
   */
  unit?: string;
  /**
   * Numeric multiplier applied before plotting.
   */
  scale?: number;
  /**
   * CSS color string.
   */
  color?: string;
  /**
   * Initial series visibility.
   */
  visible?: boolean;
  line?: {
    /**
     * Stroke width in pixels.
     * @exclusiveMinimum 0
     */
    width?: number;
    dash?: "solid" | "dash";
  };
  format?: {
    /**
     * Decimal places shown in labels.
     * @minimum 0
     */
    decimals?: number;
  };
}

export type TimeAxisConfig =
  | HostReceivedTimeAxisConfig
  | FieldTimeAxisConfig
  | FixedIntervalTimeAxisConfig
  | SequenceTimeAxisConfig;

export interface HostReceivedTimeAxisConfig {
  /**
   * Use the host receive timestamp as the x-axis value.
   */
  source: "hostReceived";
  /**
   * Unit used for host timestamps.
   */
  unit?: "s" | "ms";
  /**
   * Whether to zero the time axis against the first sample.
   */
  zero?: "none" | "first";
}

export interface FieldTimeAxisConfig {
  /**
   * Use a parsed field as the x-axis value.
   */
  source: "field";
  /**
   * Parsed field path containing the time value.
   * @minLength 1
   */
  field: string;
  /**
   * Unit used by the parsed time field.
   */
  unit: "s" | "ms" | "us";
  /**
   * Whether to zero the time axis against the first sample.
   */
  zero?: "none" | "first";
}

export interface FixedIntervalTimeAxisConfig {
  /**
   * Generate x-axis values from a fixed sample interval.
   */
  source: "fixedInterval";
  /**
   * Interval between samples in milliseconds.
   * @exclusiveMinimum 0
   */
  intervalMs: number;
}

export interface SequenceTimeAxisConfig {
  /**
   * Use the frame sequence number as the x-axis value.
   */
  source: "sequence";
}

export interface FramePlot2dOutputConfig extends OutputConfigBase {
  /**
   * Renders per-frame 2D point layers.
   */
  kind: "framePlot2d";
  /**
   * Field used as the frame id. Falls back to sequence number.
   */
  frameId?: FieldReferenceConfig;
  bounds?: {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
  };
  points: {
    /**
     * Parsed field path containing point objects.
     * @minLength 1
     */
    field: string;
    /**
     * Point object field path used as x coordinate.
     * @minLength 1
     */
    x: string;
    /**
     * Point object field path used as y coordinate.
     * @minLength 1
     */
    y: string;
  };
  /**
   * Per-style-key point styles.
   */
  styles?: Record<string, Plot2dPointStyle>;
}

export interface FieldReferenceConfig {
  /**
   * Field references resolve against parsed fields.
   */
  source: "field";
  /**
   * Parsed field path.
   * @minLength 1
   */
  field: string;
}

export interface Plot2dPointStyle {
  /**
   * CSS color string.
   */
  color?: string;
  /**
   * Point radius in pixels.
   * @exclusiveMinimum 0
   */
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

export interface LayoutSummary {
  key: string;
  ref: LayoutRef;
  id: string;
  name: string;
  scope: ProfileScope;
  workspaceName?: string;
}

export interface LayoutRef {
  scope: ProfileScope;
  id: string;
  workspaceFolderUri?: string;
}

export interface LayoutSourceMetadata {
  key: string;
  ref: LayoutRef;
  scope: ProfileScope;
  filePath?: string;
  workspaceFolderUri?: string;
  workspaceName?: string;
}

/**
 * Reusable monitor page layout preset.
 */
export interface LayoutConfig {
  /**
   * Layout schema version. Version 1 is the only supported layout format.
   * @asType integer
   */
  schemaVersion: 1;
  /**
   * Layout id. It must be unique within its user or workspace namespace.
   * @minLength 1
   */
  id: string;
  /**
   * Human-readable layout name shown in layout controls.
   * @minLength 1
   */
  name: string;
  /**
   * Page-level workspace layout options.
   */
  page: MonitorPageLayoutConfig;
  /**
   * Per-output panel and view defaults, keyed by profile output id.
   */
  outputs: Record<string, OutputLayoutConfig>;
}

export interface MonitorPageLayoutConfig {
  /**
   * Page layout mode.
   */
  mode: "grid";
  /**
   * Responsive column strategy used by the monitor workspace.
   */
  columns?: "auto" | "single" | "two";
  /**
   * Workspace density.
   */
  density?: "compact" | "normal" | "comfortable";
}

export interface OutputLayoutConfig {
  /**
   * Panel placement and sizing defaults.
   */
  panel?: OutputPanelLayoutConfig;
  /**
   * Output renderer view defaults.
   */
  view?: OutputViewLayoutConfig;
}

export interface OutputPanelLayoutConfig {
  /**
   * Sort order within the workspace.
   */
  order?: number;
  /**
   * Number of grid columns occupied by this panel.
   * @minimum 1
   */
  columnSpan?: number;
  /**
   * Minimum panel height in CSS pixels.
   * @minimum 1
   */
  minHeight?: number;
  /**
   * Whether the panel starts collapsed.
   */
  collapsed?: boolean;
  /**
   * Whether the panel starts maximized.
   */
  maximized?: boolean;
}

export type OutputViewLayoutConfig =
  | TimeSeriesViewLayoutConfig
  | TerminalViewLayoutConfig
  | FramePlot2dViewLayoutConfig;

export interface TimeSeriesViewLayoutConfig {
  kind: "timeSeriesLine";
  showLegend?: boolean;
  autoFollow?: boolean;
  zoom?: AxisRangeLayoutConfig;
}

export interface TerminalViewLayoutConfig {
  kind: "terminalAppend" | "terminalFrame";
  autoScroll?: boolean;
}

export interface FramePlot2dViewLayoutConfig {
  kind: "framePlot2d";
  bounds?: {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
  };
}

export interface AxisRangeLayoutConfig {
  x?: { min: number; max: number };
  y?: Record<string, { min: number; max: number }>;
}

export interface SaveLayoutRequest {
  layout: LayoutConfig;
  layoutKey: string;
}

export interface SaveLayoutAsRequest {
  layout: LayoutConfig;
  layoutId: string;
  target: LayoutSaveTarget;
  profileKey: string;
}

export interface LayoutSaveTarget {
  label: string;
  scope: "user" | "workspace";
  workspaceFolderUri?: string;
  workspaceName?: string;
}

export type ToExtensionMessage =
  | { type: "requestPorts" }
  | { type: "requestProfiles"; profileKey?: string }
  | { type: "selectProfile"; profileKey: string }
  | { type: "connect"; settings: ConnectionSettings }
  | { type: "disconnect" }
  | { type: "send"; text: string }
  | { type: "setParserMode"; parserMode: ParserMode }
  | { type: "clearLog" }
  | { type: "saveLayout"; request: SaveLayoutRequest }
  | { type: "saveLayoutAs"; request: SaveLayoutAsRequest };

export type ToWebviewMessage =
  | { type: "ports"; ports: SerialPortSummary[] }
  | {
      type: "profiles";
      profiles: ProfileSummary[];
      activeProfile: ProfileConfig;
      activeProfileKey: string;
      activeLayout: LayoutConfig;
      activeLayoutKey: string;
      layouts: LayoutSummary[];
      layoutTargets: LayoutSaveTarget[];
    }
  | {
      type: "activeProfile";
      profile: ProfileConfig;
      profileKey: string;
      layout: LayoutConfig;
      layoutKey: string;
    }
  | { type: "layoutSaved"; layout: LayoutConfig; layoutKey: string }
  | { type: "layoutSavedAs"; layout: LayoutConfig; layoutKey: string; profile: ProfileConfig }
  | { type: "outputPacket"; packet: OutputPacket }
  | { type: "connectionState"; state: ConnectionState }
  | { type: "rawLine"; line: string; t: number }
  | { type: "seriesAppend"; samples: PlotSample[] }
  | { type: "error"; message: string };

export type ToProfileEditorMessage =
  | { type: "requestProfileEditorState"; profileKey?: string }
  | { type: "selectProfileForEdit"; profileKey: string }
  | { type: "setProfileEditorView"; view: "home" | "editor" }
  | { type: "openMonitorForProfile"; profileKey: string }
  | { type: "autoSaveProfile"; profile: ProfileConfig }
  | { type: "copyProfileByKey"; profileKey: string }
  | { type: "openProfileJson"; profileKey?: string };

export type ToProfileEditorWebviewMessage =
  | { type: "profileEditorState"; state: ProfileEditorState }
  | { type: "profileAutoSaved"; profileKey: string; filePath: string }
  | { type: "profileCopied"; profileKey: string; filePath: string }
  | { type: "error"; message: string };

export function isParserMode(value: string): value is ParserMode {
  return parserModes.some((mode) => mode === value);
}
