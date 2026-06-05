export const parserModes = ["auto", "raw", "csv", "jsonl", "keyValue"] as const;

export type ParserMode = (typeof parserModes)[number];

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
  parserMode: ParserMode;
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

export type ToExtensionMessage =
  | { type: "requestPorts" }
  | { type: "connect"; settings: ConnectionSettings }
  | { type: "disconnect" }
  | { type: "send"; text: string }
  | { type: "setParserMode"; parserMode: ParserMode }
  | { type: "clearLog" };

export type ToWebviewMessage =
  | { type: "ports"; ports: SerialPortSummary[] }
  | { type: "connectionState"; state: ConnectionState }
  | { type: "rawLine"; line: string; t: number }
  | { type: "seriesAppend"; samples: PlotSample[] }
  | { type: "error"; message: string };

export function isParserMode(value: string): value is ParserMode {
  return parserModes.includes(value as ParserMode);
}
