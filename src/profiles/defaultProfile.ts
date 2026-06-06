import type { ProfileConfig } from "../shared/protocol";

export const defaultProfile: ProfileConfig = {
  schemaVersion: 2,
  id: "default",
  name: "Default Auto Plot",
  serialDefaults: {
    baudRate: 115200,
  },
  codec: {
    kind: "text",
    encoding: "utf8",
    sendLineEnding: "none",
  },
  framing: {
    kind: "line",
    delimiter: "auto",
  },
  parser: {
    kind: "builtin",
    mode: "auto",
  },
  outputs: [
    {
      id: "raw",
      kind: "terminalAppend",
      title: "Raw Monitor",
      source: "raw",
      maxLines: 500,
      autoScroll: true,
    },
    {
      id: "plot",
      kind: "timeSeriesLine",
      title: "Live Plot",
      time: {
        source: "hostReceived",
        unit: "s",
        zero: "first",
      },
      series: {},
      window: {
        mode: "points",
        maxPoints: 3000,
      },
      style: {
        showLegend: true,
      },
    },
  ],
};

export const builtinProfiles: readonly ProfileConfig[] = [
  defaultProfile,
  {
    schemaVersion: 2,
    id: "jsonl-telemetry",
    name: "JSONL Telemetry",
    serialDefaults: {
      baudRate: 115200,
    },
    codec: {
      kind: "text",
      encoding: "utf8",
      sendLineEnding: "lf",
    },
    framing: {
      kind: "line",
      delimiter: "lf",
      trim: true,
    },
    parser: {
      kind: "builtin",
      mode: "jsonl",
      options: {
        flatten: true,
      },
    },
    outputs: [
      {
        id: "raw",
        kind: "terminalAppend",
        title: "JSONL Stream",
        source: "raw",
        maxLines: 300,
        autoScroll: true,
      },
      {
        id: "telemetry",
        kind: "timeSeriesLine",
        title: "Telemetry",
        time: {
          source: "field",
          field: "t",
          unit: "ms",
          zero: "first",
        },
        series: {
          temperature: {
            field: "sensor.temperature",
            label: "Temperature",
            unit: "degC",
            color: "#d97706",
            line: {
              width: 2,
            },
            format: {
              decimals: 1,
            },
          },
          humidity: {
            field: "sensor.humidity",
            label: "Humidity",
            unit: "%",
            color: "#0284c7",
            line: {
              width: 2,
            },
            format: {
              decimals: 1,
            },
          },
          pressure: {
            field: "sensor.pressure",
            label: "Pressure",
            unit: "kPa",
            color: "#16a34a",
            format: {
              decimals: 2,
            },
          },
        },
        window: {
          mode: "points",
          maxPoints: 2000,
        },
        style: {
          showLegend: true,
        },
      },
    ],
    export: {
      mode: "parsed",
      format: "jsonl",
      includeMetadata: true,
    },
  },
  {
    schemaVersion: 2,
    id: "csv-four-channel",
    name: "CSV Four Channel",
    serialDefaults: {
      baudRate: 230400,
    },
    codec: {
      kind: "text",
      encoding: "utf8",
      sendLineEnding: "none",
    },
    framing: {
      kind: "line",
      delimiter: "auto",
      trim: true,
    },
    parser: {
      kind: "builtin",
      mode: "csv",
      options: {
        header: ["voltage", "current", "temperature", "rpm"],
      },
    },
    outputs: [
      {
        id: "raw",
        kind: "terminalAppend",
        title: "CSV Lines",
        source: "raw",
        maxLines: 200,
        autoScroll: true,
      },
      {
        id: "channels",
        kind: "timeSeriesLine",
        title: "Channels",
        time: {
          source: "fixedInterval",
          intervalMs: 20,
        },
        series: {
          voltage: {
            field: "voltage",
            label: "Voltage",
            unit: "V",
            color: "#2563eb",
            format: {
              decimals: 3,
            },
          },
          current: {
            field: "current",
            label: "Current",
            unit: "A",
            color: "#dc2626",
            format: {
              decimals: 3,
            },
          },
          temperature: {
            field: "temperature",
            label: "Temperature",
            unit: "degC",
            color: "#ea580c",
            line: {
              width: 2,
            },
            format: {
              decimals: 1,
            },
          },
          rpm: {
            field: "rpm",
            label: "RPM",
            unit: "rpm",
            color: "#7c3aed",
            visible: false,
          },
        },
        window: {
          mode: "points",
          maxPoints: 1000,
        },
      },
    ],
    export: {
      mode: "parsed",
      format: "csv",
    },
  },
  {
    schemaVersion: 2,
    id: "key-value-status",
    name: "Key-Value Status",
    serialDefaults: {
      baudRate: 57600,
    },
    codec: {
      kind: "text",
      encoding: "utf8",
      sendLineEnding: "crlf",
    },
    framing: {
      kind: "line",
      delimiter: "auto",
      trim: true,
      maxFrameBytes: 4096,
    },
    parser: {
      kind: "builtin",
      mode: "keyValue",
      options: {
        carryForward: true,
      },
    },
    outputs: [
      {
        id: "events",
        kind: "terminalAppend",
        title: "Status Events",
        source: "template",
        template: "#{seq} temp={temp}C rpm={rpm} vin={vin}V",
        maxLines: 500,
        autoScroll: true,
      },
      {
        id: "status-frame",
        kind: "terminalFrame",
        title: "Latest Status",
        template: "TEMP {temp} C\nRPM  {rpm}\nVIN  {vin} V\nERR  {err}",
      },
      {
        id: "status-trend",
        kind: "timeSeriesLine",
        title: "Status Trend",
        time: {
          source: "sequence",
        },
        series: {
          temp: {
            field: "temp",
            label: "Temperature",
            unit: "degC",
            color: "#ea580c",
          },
          rpm: {
            field: "rpm",
            label: "RPM",
            unit: "rpm",
            color: "#7c3aed",
            scale: 0.01,
          },
          vin: {
            field: "vin",
            label: "Input Voltage",
            unit: "V",
            color: "#2563eb",
          },
        },
        window: {
          mode: "points",
          maxPoints: 800,
        },
      },
    ],
  },
  {
    schemaVersion: 2,
    id: "frame-plot-2d",
    name: "2D Frame Plot",
    serialDefaults: {
      baudRate: 921600,
    },
    codec: {
      kind: "text",
      encoding: "utf8",
      sendLineEnding: "lf",
    },
    framing: {
      kind: "line",
      delimiter: "lf",
      trim: true,
      maxFrameBytes: 65536,
    },
    parser: {
      kind: "builtin",
      mode: "jsonl",
      options: {
        flatten: false,
      },
    },
    outputs: [
      {
        id: "raw",
        kind: "terminalAppend",
        title: "Frame Source",
        source: "raw",
        maxLines: 100,
        autoScroll: false,
      },
      {
        id: "scatter",
        kind: "framePlot2d",
        title: "Scatter Frame",
        frameId: {
          source: "field",
          field: "frame",
        },
        bounds: {
          xMin: -100,
          xMax: 100,
          yMin: -100,
          yMax: 100,
        },
        points: {
          field: "points",
          x: "x",
          y: "y",
        },
        styles: {
          target: {
            color: "#dc2626",
            size: 4,
          },
          background: {
            color: "#64748b",
            size: 2,
          },
        },
      },
    ],
  },
];
