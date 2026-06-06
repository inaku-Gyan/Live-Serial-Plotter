import type { ProfileConfig } from "../shared/protocol";

export const defaultProfile: ProfileConfig = {
  schemaVersion: 1,
  id: "default",
  name: "Default Auto Plot",
  connection: {
    baudRate: 115200,
    lineEnding: "none",
  },
  framing: {
    kind: "line",
    encoding: "utf8",
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
