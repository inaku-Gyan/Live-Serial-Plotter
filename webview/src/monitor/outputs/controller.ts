import { defaultLayout } from "../../../../src/profiles/defaultLayout";
import type {
  LayoutConfig,
  OutputConfig,
  OutputLayoutConfig,
  OutputPacket,
} from "../../../../src/shared/protocol";
import { createOutputView } from "./factory";
import { applyPanelLayout, cssEscape, sortOutputsByLayout } from "./panel/layout";
import type { MonitorOutputControllerOptions, OutputView } from "./types";

export class MonitorOutputController {
  private readonly views = new Map<string, OutputView>();
  private currentLayout: LayoutConfig | undefined;

  constructor(private readonly options: MonitorOutputControllerOptions) {}

  renderOutputs(outputs: readonly OutputConfig[], layout: LayoutConfig = defaultLayout): void {
    this.disposeViews();
    this.currentLayout = layout;
    this.applyPageLayout(layout);
    this.options.root.replaceChildren();

    for (const output of sortOutputsByLayout(outputs, layout)) {
      const view = createOutputView(this.options.root, output, layout.outputs[output.id]);
      this.views.set(output.id, view);
    }
  }

  appendPacket(packet: OutputPacket): void {
    this.views.get(packet.outputId)?.updateData(packet);
  }

  resetOutputView(outputId: string): void {
    this.views.get(outputId)?.resetView();
  }

  resetPageLayout(): void {
    if (this.currentLayout === undefined) {
      return;
    }

    this.applyPageLayout(this.currentLayout);

    for (const view of this.views.values()) {
      view.resetView();
      const panel = this.options.root.querySelector<HTMLElement>(
        `[data-output-id="${cssEscape(view.outputId)}"]`,
      );
      applyPanelLayout(panel, this.currentLayout.outputs[view.outputId]);
    }
  }

  captureSavableViewState(): LayoutConfig {
    const baseLayout = this.currentLayout;

    if (baseLayout === undefined) {
      return {
        schemaVersion: 1,
        id: "unsaved",
        name: "Unsaved Layout",
        page: { mode: "grid", columns: "auto", density: "normal" },
        outputs: {},
      };
    }

    const outputs: Record<string, OutputLayoutConfig> = {};

    for (const [outputId, view] of this.views.entries()) {
      const outputLayout: OutputLayoutConfig = {
        ...baseLayout.outputs[outputId],
      };
      const viewLayout = view.captureViewLayout();

      if (viewLayout !== undefined) {
        outputLayout.viewState = viewLayout;
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
    this.disposeViews();
  }

  private disposeViews(): void {
    for (const view of this.views.values()) {
      view.dispose();
    }

    this.views.clear();
  }

  private applyPageLayout(layout: LayoutConfig): void {
    this.options.root.dataset.layoutColumns = layout.page.columns ?? "auto";
    this.options.root.dataset.layoutDensity = layout.page.density ?? "normal";
  }
}
