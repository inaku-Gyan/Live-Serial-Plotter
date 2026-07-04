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
  const leftOrder = layout.outputs[left.id]?.tile?.order;
  const rightOrder = layout.outputs[right.id]?.tile?.order;
  const leftIndex = outputs.findIndex((output) => output.id === left.id);
  const rightIndex = outputs.findIndex((output) => output.id === right.id);

  return (leftOrder ?? 10_000 + leftIndex) - (rightOrder ?? 10_000 + rightIndex);
}

export function applyTileLayout(
  tile: HTMLElement | null,
  layout: OutputLayoutConfig | undefined,
): void {
  if (tile === null) {
    return;
  }

  const tileLayout = layout?.tile;
  tile.style.order = tileLayout?.order === undefined ? "" : String(tileLayout.order);
  tile.style.gridColumn =
    tileLayout?.columnSpan === undefined ? "" : `span ${tileLayout.columnSpan}`;
  tile.style.minHeight = tileLayout?.minHeight === undefined ? "" : `${tileLayout.minHeight}px`;
  tile.dataset.collapsed = tileLayout?.collapsed === true ? "true" : "false";
  tile.dataset.maximized = tileLayout?.maximized === true ? "true" : "false";
}

export function cssEscape(value: string): string {
  return typeof CSS === "undefined" || CSS.escape === undefined
    ? value.replaceAll('"', '\\"')
    : CSS.escape(value);
}
