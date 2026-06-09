import type {
  LayoutConfig,
  OutputConfig,
  OutputLayoutConfig,
} from "../../../../../src/shared/protocol";

export function sortOutputsByLayout(
  outputs: readonly OutputConfig[],
  layout: LayoutConfig,
): readonly OutputConfig[] {
  const sorted: OutputConfig[] = [];

  for (const output of outputs) {
    const insertIndex = sorted.findIndex(
      (candidate) => compareOutputLayoutOrder(output, candidate, outputs, layout) < 0,
    );

    if (insertIndex === -1) {
      sorted.push(output);
    } else {
      sorted.splice(insertIndex, 0, output);
    }
  }

  return sorted;
}

function compareOutputLayoutOrder(
  left: OutputConfig,
  right: OutputConfig,
  outputs: readonly OutputConfig[],
  layout: LayoutConfig,
): number {
  const leftOrder = layout.outputs[left.id]?.panel?.order;
  const rightOrder = layout.outputs[right.id]?.panel?.order;
  const leftIndex = outputs.findIndex((output) => output.id === left.id);
  const rightIndex = outputs.findIndex((output) => output.id === right.id);

  return (leftOrder ?? 10_000 + leftIndex) - (rightOrder ?? 10_000 + rightIndex);
}

export function applyPanelLayout(
  panel: HTMLElement | null,
  layout: OutputLayoutConfig | undefined,
): void {
  if (panel === null) {
    return;
  }

  const panelLayout = layout?.panel;
  panel.style.order = panelLayout?.order === undefined ? "" : String(panelLayout.order);
  panel.style.gridColumn =
    panelLayout?.columnSpan === undefined ? "" : `span ${panelLayout.columnSpan}`;
  panel.style.minHeight = panelLayout?.minHeight === undefined ? "" : `${panelLayout.minHeight}px`;
  panel.dataset.collapsed = panelLayout?.collapsed === true ? "true" : "false";
  panel.dataset.maximized = panelLayout?.maximized === true ? "true" : "false";
}

export function cssEscape(value: string): string {
  return typeof CSS === "undefined" || CSS.escape === undefined
    ? value.replaceAll('"', '\\"')
    : CSS.escape(value);
}
