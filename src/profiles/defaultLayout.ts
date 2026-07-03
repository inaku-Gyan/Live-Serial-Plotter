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
      tile: {
        order: 10,
        columnSpan: 1,
        minHeight: 220,
      },
      viewState: {
        kind: "terminalAppend",
        autoScroll: true,
      },
    },
    plot: {
      tile: {
        order: 20,
        columnSpan: 2,
        minHeight: 340,
      },
      viewState: {
        kind: "timeSeriesLine",
        showLegend: true,
        autoFollow: true,
      },
    },
  },
};

export const builtinLayouts: readonly LayoutConfig[] = [defaultLayout];
