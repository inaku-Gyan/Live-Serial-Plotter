import type { OutputConfig, OutputLayoutConfig } from "../../../src/shared/protocol";
import { FramePlot2dView } from "./framePlot2dView";
import { applyPanelLayout } from "./panelLayout";
import { TerminalAppendView } from "./terminalAppendView";
import { TerminalFrameView } from "./terminalFrameView";
import { TimeSeriesLineView } from "./timeSeriesLineView";
import type { OutputView, PostMessage } from "./types";

export function createOutputView(
  root: HTMLElement,
  output: OutputConfig,
  layout: OutputLayoutConfig | undefined,
  postMessage: PostMessage,
): OutputView {
  const section = document.createElement("section");
  section.className = `output-panel output-panel-${output.kind}`;
  section.dataset.outputId = output.id;
  section.dataset.outputKind = output.kind;
  applyPanelLayout(section, layout);
  root.append(section);

  switch (output.kind) {
    case "terminalAppend":
      return new TerminalAppendView(section, output, layout?.view, postMessage);
    case "terminalFrame":
      return new TerminalFrameView(section, output, layout?.view);
    case "timeSeriesLine":
      return new TimeSeriesLineView(section, output, layout?.view);
    case "framePlot2d":
      return new FramePlot2dView(section, output, layout?.view);
  }

  return assertNever(output);
}

function assertNever(value: never): never {
  throw new Error(`Unsupported output kind: ${String(value)}`);
}
