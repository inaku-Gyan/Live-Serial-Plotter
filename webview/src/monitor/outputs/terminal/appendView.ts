import type {
  OutputLayoutConfig,
  OutputPacket,
  TerminalAppendOutputConfig,
  TerminalAppendPacket,
  TerminalViewStateConfig,
} from "../../../../../src/shared/protocol";
import { appendPanelHeaderButton, createPanelHeader } from "../panel/chrome";
import type { OutputView } from "../types";

const defaultMaxRawLines = 500;
const standbyText = "Waiting for serial text";

export class TerminalAppendView implements OutputView {
  readonly outputId: string;
  readonly kind = "terminalAppend" as const;

  private readonly pre: HTMLPreElement;
  private lineCount = 0;
  private viewLayout: TerminalViewStateConfig | undefined;

  constructor(
    parent: HTMLElement,
    private readonly config: TerminalAppendOutputConfig,
    viewLayout: OutputLayoutConfig["viewState"] | undefined,
  ) {
    this.outputId = config.id;
    this.applyViewLayout(viewLayout);

    const header = createPanelHeader(config, "Terminal", () => this.resetView());
    appendPanelHeaderButton(header, "Clear", () => this.clearData(), "output-clear-button");

    this.pre = document.createElement("pre");
    this.pre.className = "output-terminal output-standby";
    this.pre.textContent = standbyText;

    parent.append(header, this.pre);
  }

  updateData(packet: OutputPacket): void {
    if (packet.kind !== "terminalAppend") {
      return;
    }

    this.appendLines(packet.lines, packet.receivedAt);
  }

  appendLines(lines: TerminalAppendPacket["lines"], timestamp: number): void {
    if (lines.length === 0) {
      return;
    }

    if (this.lineCount === 0) {
      this.pre.classList.remove("output-standby");
      this.pre.textContent = "";
    }

    const time = new Date(timestamp).toLocaleTimeString();
    const fragment = document.createDocumentFragment();

    for (const line of lines) {
      fragment.append(document.createTextNode(`[${time}] ${line.text}\n`));
    }

    this.pre.append(fragment);
    this.lineCount += lines.length;

    const maxLines = this.config.maxLines ?? defaultMaxRawLines;

    while (this.lineCount > maxLines && this.pre.firstChild !== null) {
      this.pre.firstChild.remove();
      this.lineCount -= 1;
    }

    if (this.getAutoScroll()) {
      this.pre.scrollTop = this.pre.scrollHeight;
    }
  }

  applyViewLayout(layout: OutputLayoutConfig["viewState"] | undefined): void {
    this.viewLayout = layout?.kind === "terminalAppend" ? layout : undefined;
  }

  resetView(): void {
    this.applyViewLayout(undefined);
  }

  captureViewLayout(): OutputLayoutConfig["viewState"] {
    return {
      kind: "terminalAppend",
      autoScroll: this.getAutoScroll(),
    };
  }

  clearData(): void {
    this.lineCount = 0;
    this.pre.classList.add("output-standby");
    this.pre.textContent = standbyText;
  }

  dispose(): void {}

  private getAutoScroll(): boolean {
    return this.viewLayout?.autoScroll ?? this.config.autoScroll !== false;
  }
}
