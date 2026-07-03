import type {
  FramePlot2dOutputConfig,
  FramePlot2dPacket,
  FramePlot2dViewStateConfig,
  OutputLayoutConfig,
  OutputPacket,
} from "../../../../../src/shared/protocol";
import { createPanelHeader } from "../panel/chrome";
import {
  drawCenterAxes,
  getCanvasContext,
  getCanvasSize,
  inferBounds,
  readCssColor,
  scaleLinear,
} from "./canvas";
import type { OutputView } from "../types";

interface ThemeColors {
  foreground: string;
  muted: string;
  grid: string;
}

export class FramePlot2dView implements OutputView {
  readonly outputId: string;
  readonly kind = "framePlot2d" as const;

  private readonly canvas: HTMLCanvasElement;
  private readonly resizeObserver: ResizeObserver | undefined;
  private readonly themeObserver: MutationObserver | undefined;
  private latestPacket: FramePlot2dPacket | undefined;
  private viewLayout: FramePlot2dViewStateConfig | undefined;
  private themeColors: ThemeColors | undefined;

  constructor(
    parent: HTMLElement,
    private readonly config: FramePlot2dOutputConfig,
    viewLayout: OutputLayoutConfig["viewState"] | undefined,
  ) {
    this.outputId = config.id;
    this.applyViewLayout(viewLayout);
    this.canvas = document.createElement("canvas");
    this.canvas.className = "output-frame-canvas";
    this.canvas.setAttribute("aria-label", "Frame plot");

    parent.append(
      createPanelHeader(config, "Frame Plot", () => this.resetView()),
      this.canvas,
    );
    this.draw();

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.draw());
      this.resizeObserver.observe(this.canvas);
    }

    if (typeof MutationObserver !== "undefined") {
      this.themeObserver = new MutationObserver(() => {
        this.themeColors = undefined;
        this.draw();
      });
      this.themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    }
  }

  updateData(packet: OutputPacket): void {
    if (packet.kind !== "framePlot2d") {
      return;
    }

    this.latestPacket = packet;
    this.draw();
  }

  clearData(): void {
    this.latestPacket = undefined;
    this.draw();
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.themeObserver?.disconnect();
  }

  applyViewLayout(layout: OutputLayoutConfig["viewState"] | undefined): void {
    this.viewLayout = layout?.kind === "framePlot2d" ? layout : undefined;
  }

  resetView(): void {
    this.applyViewLayout(this.viewLayout);
    this.draw();
  }

  captureViewLayout(): OutputLayoutConfig["viewState"] {
    const layout: FramePlot2dViewStateConfig = {
      kind: "framePlot2d",
    };

    if (this.viewLayout?.bounds !== undefined) {
      layout.bounds = this.viewLayout.bounds;
    }

    return layout;
  }

  private readColors(): ThemeColors {
    if (this.themeColors === undefined) {
      const style = getComputedStyle(this.canvas);
      this.themeColors = {
        foreground: readCssColor(style, "--vscode-foreground", "#cccccc"),
        muted: readCssColor(style, "--vscode-descriptionForeground", "#8f8f8f"),
        grid: readCssColor(style, "--vscode-panel-border", "#3c3c3c"),
      };
    }

    return this.themeColors;
  }

  private draw(): void {
    const context = getCanvasContext(this.canvas);

    if (context === undefined) {
      return;
    }

    const size = getCanvasSize(this.canvas);
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(size.width * ratio));
    this.canvas.height = Math.max(1, Math.floor(size.height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);

    const { foreground, muted, grid } = this.readColors();
    const bounds =
      this.viewLayout?.bounds ??
      this.latestPacket?.bounds ??
      this.config.bounds ??
      inferBounds(this.latestPacket);
    const plotBounds = bounds ?? { xMin: -1, xMax: 1, yMin: -1, yMax: 1 };
    const area = {
      left: 42,
      top: 16,
      right: size.width - 14,
      bottom: size.height - 28,
    };

    context.strokeStyle = grid;
    context.lineWidth = 1;
    context.strokeRect(area.left, area.top, area.right - area.left, area.bottom - area.top);
    drawCenterAxes(context, plotBounds, area, grid);

    context.fillStyle = muted;
    context.font = "11px sans-serif";
    context.fillText(String(plotBounds.yMax), 6, area.top + 4);
    context.fillText(String(plotBounds.yMin), 6, area.bottom);
    context.fillText(String(plotBounds.xMin), area.left, size.height - 8);
    context.fillText(
      String(plotBounds.xMax),
      Math.max(area.left, area.right - 42),
      size.height - 8,
    );

    const layers = this.latestPacket?.layers ?? [];

    if (layers.length === 0) {
      context.fillStyle = muted;
      context.textAlign = "center";
      context.fillText("Waiting for frame points", size.width / 2, size.height / 2);
      context.textAlign = "start";
      return;
    }

    for (const layer of layers) {
      for (const point of layer.points) {
        const x = scaleLinear(point.x, plotBounds.xMin, plotBounds.xMax, area.left, area.right);
        const y = scaleLinear(point.y, plotBounds.yMin, plotBounds.yMax, area.bottom, area.top);
        const pointStyle =
          point.styleKey === undefined ? undefined : this.config.styles?.[point.styleKey];
        context.fillStyle = point.color ?? pointStyle?.color ?? foreground;
        context.beginPath();
        context.arc(x, y, point.size ?? pointStyle?.size ?? 3, 0, Math.PI * 2);
        context.fill();
      }
    }
  }
}
