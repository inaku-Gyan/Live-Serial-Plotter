interface RenderTimeSeriesLegendOptions {
  legendElement: HTMLElement;
  channelNames: string[];
  showLegend: boolean;
  getChecked: (channelName: string) => boolean;
  getColor: (channelName: string, index: number) => string;
  getLabel: (channelName: string) => string;
  onVisibilityChange: (channelName: string, index: number, visible: boolean) => void;
}

export function renderTimeSeriesLegend(options: RenderTimeSeriesLegendOptions): void {
  options.legendElement.replaceChildren();
  options.legendElement.hidden = !options.showLegend;

  if (options.channelNames.length === 0) {
    const empty = document.createElement("span");
    empty.className = "legend-empty";
    empty.textContent = "Waiting for numeric data";
    options.legendElement.append(empty);
    return;
  }

  for (const [index, channelName] of options.channelNames.entries()) {
    const label = document.createElement("label");
    label.className = "legend-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = options.getChecked(channelName);
    checkbox.addEventListener("change", () => {
      options.onVisibilityChange(channelName, index, checkbox.checked);
    });

    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.backgroundColor = options.getColor(channelName, index);

    const text = document.createElement("span");
    text.textContent = options.getLabel(channelName);

    label.append(checkbox, swatch, text);
    options.legendElement.append(label);
  }
}
