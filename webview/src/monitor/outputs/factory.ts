import type { OutputConfig, OutputLayoutConfig } from "../../../../src/shared/protocol";
import { FramePlot2dView } from "./frame-plot/view";
import { applyPanelLayout } from "./panel/layout";
import { TerminalAppendView } from "./terminal/appendView";
import { TerminalFrameView } from "./terminal/frameView";
import { TimeSeriesLineView } from "./time-series/view";
import type { OutputView } from "./types";

export function createOutputView(
  root: HTMLElement,
  output: OutputConfig,
  layout: OutputLayoutConfig | undefined,
): OutputView {
  const section = document.createElement("section");
  section.className = `output-panel output-panel-${output.kind}`;
  section.dataset.outputId = output.id;
  section.dataset.outputKind = output.kind;
  applyPanelLayout(section, layout);
  root.append(section);

  switch (output.kind) {
    case "terminalAppend":
      return new TerminalAppendView(section, output, layout?.viewState);
    case "terminalFrame":
      return new TerminalFrameView(section, output, layout?.viewState);
    case "timeSeriesLine":
      return new TimeSeriesLineView(section, output, layout?.viewState);
    case "framePlot2d":
      return new FramePlot2dView(section, output, layout?.viewState);
  }

  return assertNever(output);
}

function assertNever(value: never): never {
  throw new Error(`Unsupported output kind: ${String(value)}`);
}
