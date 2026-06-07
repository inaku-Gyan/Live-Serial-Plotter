import type { LayoutConfig } from "../shared/protocol";

export const defaultLayout: LayoutConfig = {
  schemaVersion: 1,
  id: "default",
  name: "Default Monitor Layout",
  page: {
    mode: "grid",
    columns: "auto",
    density: "normal",
  },
  outputs: {
    raw: {
      panel: {
        order: 10,
        columnSpan: 1,
        minHeight: 220,
      },
      view: {
        kind: "terminalAppend",
        autoScroll: true,
      },
    },
    plot: {
      panel: {
        order: 20,
        columnSpan: 2,
        minHeight: 340,
      },
      view: {
        kind: "timeSeriesLine",
        showLegend: true,
        autoFollow: true,
      },
    },
  },
};

export const builtinLayouts: readonly LayoutConfig[] = [defaultLayout];
