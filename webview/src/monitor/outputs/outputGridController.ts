import { defaultLayout } from "../../../../src/profiles/defaultLayout";
import type {
  LayoutConfig,
  OutputConfig,
  OutputLayoutConfig,
  OutputPacket,
} from "../../../../src/shared/protocol";
import { createOutputRenderer } from "./factory";
import { applyTileLayout, cssEscape, sortOutputsByLayout } from "./tile/layout";
import type { OutputGridController, OutputGridControllerOptions, OutputRenderer } from "./types";

export class DomOutputGridController implements OutputGridController {
  private readonly renderers = new Map<string, OutputRenderer>();
  private currentLayout: LayoutConfig = defaultLayout;

  constructor(private readonly options: OutputGridControllerOptions) {}

  renderOutputs(outputs: readonly OutputConfig[], layout: LayoutConfig = defaultLayout): void {
    this.disposeRenderers();
    this.currentLayout = layout;
    this.applyPageLayout(layout);
    this.options.root.replaceChildren();

    for (const output of sortOutputsByLayout(outputs, layout)) {
      const renderer = createOutputRenderer(this.options.root, output, layout.outputs[output.id]);
      this.renderers.set(output.id, renderer);
    }
  }

  appendPacket(packet: OutputPacket): void {
    this.renderers.get(packet.outputId)?.updateData(packet);
  }

  resetOutputViewState(outputId: string): void {
    this.renderers.get(outputId)?.resetViewState();
  }

  resetPageLayout(): void {
    this.applyPageLayout(this.currentLayout);

    for (const renderer of this.renderers.values()) {
      renderer.resetViewState();
      const tile = this.options.root.querySelector<HTMLElement>(
        `[data-output-id="${cssEscape(renderer.outputId)}"]`,
      );
      applyTileLayout(tile, this.currentLayout.outputs[renderer.outputId]);
    }
  }

  captureLayout(): LayoutConfig {
    const baseLayout = this.currentLayout;
    const outputs: Record<string, OutputLayoutConfig> = {};

    for (const [outputId, renderer] of this.renderers.entries()) {
      const outputLayout: OutputLayoutConfig = {
        ...baseLayout.outputs[outputId],
      };
      const viewState = renderer.captureViewState();

      if (viewState !== undefined) {
        outputLayout.viewState = viewState;
      } else {
        delete outputLayout.viewState;
      }

      outputs[outputId] = outputLayout;
    }

    return {
      ...baseLayout,
      outputs: {
        ...baseLayout.outputs,
        ...outputs,
      },
    };
  }

  dispose(): void {
    this.disposeRenderers();
  }

  private disposeRenderers(): void {
    for (const renderer of this.renderers.values()) {
      renderer.dispose();
    }

    this.renderers.clear();
  }

  private applyPageLayout(layout: LayoutConfig): void {
    this.options.root.dataset.layoutColumns = layout.page.columns ?? "auto";
    this.options.root.dataset.layoutDensity = layout.page.density ?? "normal";
  }
}
