import type {
  OutputLayoutConfig,
  OutputPacket,
  TerminalAppendOutputConfig,
  TerminalAppendPacket,
  TerminalViewLayoutConfig,
} from "../../../../../src/shared/protocol";
import { appendPanelHeaderButton, createPanelHeader } from "../panel/chrome";
import type { OutputView, PostMessage } from "../types";

const defaultMaxRawLines = 500;

export class TerminalAppendView implements OutputView {
  readonly outputId: string;
  readonly kind = "terminalAppend" as const;

  private readonly lines: string[] = [];
  private readonly pre: HTMLPreElement;
  private viewLayout: TerminalViewLayoutConfig | undefined;

  constructor(
    parent: HTMLElement,
    private readonly config: TerminalAppendOutputConfig,
    viewLayout: OutputLayoutConfig["view"] | undefined,
    private readonly postMessage: PostMessage,
  ) {
    this.outputId = config.id;
    this.applyViewLayout(viewLayout);

    const header = createPanelHeader(config, "Terminal", () => this.resetView());
    appendPanelHeaderButton(
      header,
      "Clear",
      () => {
        this.clear();
        this.postMessage({ type: "clearLog" });
      },
      "output-clear-button",
    );

    this.pre = document.createElement("pre");
    this.pre.className = "output-terminal output-standby";
    this.pre.textContent = "Waiting for serial text";

    parent.append(header, this.pre);
  }

  appendPacket(packet: OutputPacket): void {
    if (packet.kind !== "terminalAppend") {
      return;
    }

    this.appendLines(packet.lines, packet.receivedAt);
  }

  appendLines(lines: TerminalAppendPacket["lines"], timestamp: number): void {
    const time = new Date(timestamp).toLocaleTimeString();
    this.lines.push(...lines.map((line) => `[${time}] ${line.text}`));

    const maxLines = this.config.maxLines ?? defaultMaxRawLines;

    if (this.lines.length > maxLines) {
      this.lines.splice(0, this.lines.length - maxLines);
    }

    this.pre.classList.remove("output-standby");
    this.pre.textContent = this.lines.join("\n");

    if (this.getAutoScroll()) {
      this.pre.scrollTop = this.pre.scrollHeight;
    }
  }

  applyViewLayout(layout: OutputLayoutConfig["view"] | undefined): void {
    this.viewLayout = layout?.kind === "terminalAppend" ? layout : undefined;
  }

  resetView(): void {
    this.applyViewLayout(undefined);
  }

  captureViewLayout(): OutputLayoutConfig["view"] {
    return {
      kind: "terminalAppend",
      autoScroll: this.getAutoScroll(),
    };
  }

  clear(): void {
    this.lines.length = 0;
    this.pre.classList.add("output-standby");
    this.pre.textContent = "Waiting for serial text";
  }

  dispose(): void {}

  private getAutoScroll(): boolean {
    return this.viewLayout?.autoScroll ?? this.config.autoScroll !== false;
  }
}
