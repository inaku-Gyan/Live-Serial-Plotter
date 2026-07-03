import type {
  OutputLayoutConfig,
  OutputPacket,
  TerminalFrameOutputConfig,
  TerminalFramePacket,
  TerminalViewStateConfig,
} from "../../../../../src/shared/protocol";
import { createPanelHeader } from "../panel/chrome";
import type { OutputView } from "../types";

const maxFrames = 200;
const standbyText = "Waiting for frame data";

export class TerminalFrameView implements OutputView {
  readonly outputId: string;
  readonly kind = "terminalFrame" as const;

  private readonly frames = new Map<string | number, string>();
  private readonly pre: HTMLPreElement;
  private viewLayout: TerminalViewStateConfig | undefined;

  constructor(
    parent: HTMLElement,
    config: TerminalFrameOutputConfig,
    viewLayout: OutputLayoutConfig["viewState"] | undefined,
  ) {
    this.outputId = config.id;
    this.applyViewLayout(viewLayout);
    this.pre = document.createElement("pre");
    this.pre.className = "output-terminal output-frame-terminal output-standby";
    this.pre.textContent = standbyText;

    parent.append(
      createPanelHeader(config, "Frame Terminal", () => this.resetView()),
      this.pre,
    );
  }

  updateData(packet: OutputPacket): void {
    if (packet.kind !== "terminalFrame") {
      return;
    }

    this.appendFrame(packet);
  }

  appendFrame(packet: TerminalFramePacket): void {
    this.frames.set(packet.frameId, packet.text);

    while (this.frames.size > maxFrames) {
      const oldest = this.frames.keys().next().value;

      if (oldest === undefined) {
        break;
      }

      this.frames.delete(oldest);
    }

    this.pre.classList.remove("output-standby");
    this.pre.textContent = [...this.frames.entries()]
      .map(([frameId, text]) => `#${String(frameId)}\n${text}`)
      .join("\n\n");
  }

  applyViewLayout(layout: OutputLayoutConfig["viewState"] | undefined): void {
    this.viewLayout = layout?.kind === "terminalFrame" ? layout : undefined;
  }

  resetView(): void {
    this.applyViewLayout(undefined);
  }

  captureViewLayout(): OutputLayoutConfig["viewState"] {
    const layout: TerminalViewStateConfig = {
      kind: "terminalFrame",
    };

    if (this.viewLayout?.autoScroll !== undefined) {
      layout.autoScroll = this.viewLayout.autoScroll;
    }

    return layout;
  }

  clearData(): void {
    this.frames.clear();
    this.pre.classList.add("output-standby");
    this.pre.textContent = standbyText;
  }

  dispose(): void {}
}
