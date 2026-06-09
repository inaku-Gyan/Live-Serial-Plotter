import type {
  OutputLayoutConfig,
  OutputPacket,
  TerminalFrameOutputConfig,
  TerminalFramePacket,
  TerminalViewLayoutConfig,
} from "../../../../../src/shared/protocol";
import { createPanelHeader } from "../panel/chrome";
import type { OutputView } from "../types";

export class TerminalFrameView implements OutputView {
  readonly outputId: string;
  readonly kind = "terminalFrame" as const;

  private readonly frames = new Map<string | number, string>();
  private readonly pre: HTMLPreElement;
  private viewLayout: TerminalViewLayoutConfig | undefined;

  constructor(
    parent: HTMLElement,
    config: TerminalFrameOutputConfig,
    viewLayout: OutputLayoutConfig["view"] | undefined,
  ) {
    this.outputId = config.id;
    this.applyViewLayout(viewLayout);
    this.pre = document.createElement("pre");
    this.pre.className = "output-terminal output-frame-terminal output-standby";
    this.pre.textContent = "Waiting for frame data";

    parent.append(
      createPanelHeader(config, "Frame Terminal", () => this.resetView()),
      this.pre,
    );
  }

  appendPacket(packet: OutputPacket): void {
    if (packet.kind !== "terminalFrame") {
      return;
    }

    this.appendFrame(packet);
  }

  appendFrame(packet: TerminalFramePacket): void {
    this.frames.set(packet.frameId, packet.text);
    this.pre.classList.remove("output-standby");
    this.pre.textContent = [...this.frames.entries()]
      .map(([frameId, text]) => `#${String(frameId)}\n${text}`)
      .join("\n\n");
  }

  applyViewLayout(layout: OutputLayoutConfig["view"] | undefined): void {
    this.viewLayout = layout?.kind === "terminalFrame" ? layout : undefined;
  }

  resetView(): void {
    this.applyViewLayout(undefined);
  }

  captureViewLayout(): OutputLayoutConfig["view"] {
    return {
      kind: "terminalFrame",
      autoScroll: this.viewLayout?.autoScroll,
    };
  }

  clear(): void {
    this.frames.clear();
    this.pre.classList.add("output-standby");
    this.pre.textContent = "Waiting for frame data";
  }

  dispose(): void {}
}
