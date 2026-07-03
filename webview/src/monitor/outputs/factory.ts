import type { OutputConfig, OutputLayoutConfig } from "../../../../src/shared/protocol";
import { FramePlot2dRenderer } from "./frame-plot/renderer";
import { applyTileLayout } from "./tile/layout";
import { TerminalAppendRenderer } from "./terminal/appendRenderer";
import { TerminalFrameRenderer } from "./terminal/frameRenderer";
import { TimeSeriesLineRenderer } from "./time-series/renderer";
import type { OutputRenderer } from "./types";

export function createOutputRenderer(
  root: HTMLElement,
  output: OutputConfig,
  layout: OutputLayoutConfig | undefined,
): OutputRenderer {
  const section = document.createElement("section");
  section.className = `output-tile output-tile-${output.kind}`;
  section.dataset.outputId = output.id;
  section.dataset.outputKind = output.kind;
  applyTileLayout(section, layout);
  root.append(section);

  switch (output.kind) {
    case "terminalAppend":
      return new TerminalAppendRenderer(section, output, layout?.viewState);
    case "terminalFrame":
      return new TerminalFrameRenderer(section, output, layout?.viewState);
    case "timeSeriesLine":
      return new TimeSeriesLineRenderer(section, output, layout?.viewState);
    case "framePlot2d":
      return new FramePlot2dRenderer(section, output, layout?.viewState);
  }

  return assertNever(output);
}

function assertNever(value: never): never {
  throw new Error(`Unsupported output kind: ${String(value)}`);
}
