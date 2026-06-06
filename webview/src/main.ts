import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import "./styles.css";
import appHtml from "./app.html?raw";
import {
  parserModes,
  type ParserMode,
  type SerialPortSummary,
  type ToExtensionMessage,
  type ToWebviewMessage,
} from "../../src/shared/protocol";

interface VsCodeApi<State> {
  getState(): State | undefined;
  setState(state: State): void;
  postMessage(message: ToExtensionMessage): void;
}

interface PersistedState {
  baudRate: number;
  parserMode: ParserMode;
  selectedPath: string;
}

declare function acquireVsCodeApi<State>(): VsCodeApi<State>;

const vscode = acquireVsCodeApi<PersistedState>();
const initialState = vscode.getState() ?? {
  baudRate: 115200,
  parserMode: "auto" satisfies ParserMode,
  selectedPath: "",
};

const state: PersistedState & { connected: boolean } = {
  ...initialState,
  connected: false,
};

const app = requireElement(document, "#app");
app.innerHTML = appHtml;

const portSelect = requireElement<HTMLSelectElement>(document, "#portSelect");
const refreshPortsButton = requireElement<HTMLButtonElement>(document, "#refreshPortsButton");
const baudRateSelect = requireElement<HTMLSelectElement>(document, "#baudRateSelect");
const parserModeSelect = requireElement<HTMLSelectElement>(document, "#parserModeSelect");
const connectButton = requireElement<HTMLButtonElement>(document, "#connectButton");
const connectionStatus = requireElement(document, "#connectionStatus");
const chartElement = requireElement(document, "#chart");
const legendElement = requireElement(document, "#legend");
const clearLogButton = requireElement<HTMLButtonElement>(document, "#clearLogButton");
const rawLog = requireElement<HTMLPreElement>(document, "#rawLog");
const sendForm = requireElement<HTMLFormElement>(document, "#sendForm");
const sendInput = requireElement<HTMLInputElement>(document, "#sendInput");
const sendButton = requireElement<HTMLButtonElement>(document, "#sendButton");
const errorToast = requireElement(document, "#errorToast");

const baudRates = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];
const rawLines: string[] = [];
const timeValues: number[] = [];
const channelData = new Map<string, Array<number | null>>();
const channelVisibility = new Map<string, boolean>();
const maxRawLines = 500;
const maxPlotPoints = 3000;
const colors = ["#4cc9f0", "#f72585", "#ffd166", "#06d6a0", "#c77dff", "#f77f00", "#90be6d"];

let firstTimestamp: number | undefined;
let plot: uPlot | undefined;
let ports: SerialPortSummary[] = [];

setupControls();
rebuildPlot();
requestPorts();

window.addEventListener("message", (event: MessageEvent<ToWebviewMessage>) => {
  const message = event.data;

  if (message.type === "ports") {
    ports = message.ports;
    renderPorts();
    return;
  }

  if (message.type === "connectionState") {
    state.connected = message.state.connected;
    updateConnectionControls();
    return;
  }

  if (message.type === "rawLine") {
    appendRawLine(message.line, message.t);
    return;
  }

  if (message.type === "seriesAppend") {
    appendSamples(message.samples);
    return;
  }

  if (message.type === "error") {
    showError(message.message);
  }
});

new ResizeObserver(() => {
  if (plot === undefined) {
    return;
  }

  plot.setSize(getChartSize());
}).observe(chartElement);

function setupControls(): void {
  for (const baudRate of baudRates) {
    const option = document.createElement("option");
    option.value = String(baudRate);
    option.textContent = String(baudRate);
    baudRateSelect.append(option);
  }

  baudRateSelect.value = String(state.baudRate);

  for (const parserMode of parserModes) {
    const option = document.createElement("option");
    option.value = parserMode;
    option.textContent = formatParserMode(parserMode);
    parserModeSelect.append(option);
  }

  parserModeSelect.value = state.parserMode;

  refreshPortsButton.addEventListener("click", () => requestPorts());
  connectButton.addEventListener("click", () => toggleConnection());
  clearLogButton.addEventListener("click", () => clearLog());

  baudRateSelect.addEventListener("change", () => {
    state.baudRate = Number(baudRateSelect.value);
    saveState();
  });

  parserModeSelect.addEventListener("change", () => {
    state.parserMode = parserModeSelect.value as ParserMode;
    saveState();
    postMessage({ type: "setParserMode", parserMode: state.parserMode });
  });

  portSelect.addEventListener("change", () => {
    state.selectedPath = portSelect.value;
    saveState();
  });

  sendForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const text = sendInput.value;

    if (text.length === 0 || !state.connected) {
      return;
    }

    postMessage({ type: "send", text });
    sendInput.value = "";
  });

  updateConnectionControls();
}

function requestPorts(): void {
  postMessage({ type: "requestPorts" });
}

function renderPorts(): void {
  portSelect.replaceChildren();

  if (ports.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No ports found";
    portSelect.append(option);
    updateConnectionControls();
    return;
  }

  for (const port of ports) {
    const option = document.createElement("option");
    option.value = port.path;
    option.textContent =
      port.manufacturer === undefined ? port.path : `${port.path} (${port.manufacturer})`;
    portSelect.append(option);
  }

  const selectedPortStillExists = ports.some((port) => port.path === state.selectedPath);
  state.selectedPath = selectedPortStillExists ? state.selectedPath : (ports[0]?.path ?? "");
  portSelect.value = state.selectedPath;
  saveState();
  updateConnectionControls();
}

function toggleConnection(): void {
  if (state.connected) {
    postMessage({ type: "disconnect" });
    return;
  }

  if (state.selectedPath.length === 0) {
    showError("Select a serial port before connecting.");
    return;
  }

  postMessage({
    type: "connect",
    settings: {
      path: state.selectedPath,
      baudRate: Number(baudRateSelect.value),
      parserMode: state.parserMode,
    },
  });
}

function updateConnectionControls(): void {
  connectButton.textContent = state.connected ? "Disconnect" : "Connect";
  connectButton.classList.toggle("button-danger", state.connected);
  connectionStatus.textContent = state.connected
    ? `Connected to ${state.selectedPath}`
    : "Disconnected";
  connectionStatus.classList.toggle("status-connected", state.connected);
  portSelect.disabled = state.connected || ports.length === 0;
  baudRateSelect.disabled = state.connected;
  connectButton.disabled = !state.connected && state.selectedPath.length === 0;
  sendInput.disabled = !state.connected;
  sendButton.disabled = !state.connected;
}

function appendRawLine(line: string, timestamp: number): void {
  const time = new Date(timestamp).toLocaleTimeString();
  rawLines.push(`[${time}] ${line}`);

  if (rawLines.length > maxRawLines) {
    rawLines.splice(0, rawLines.length - maxRawLines);
  }

  rawLog.textContent = rawLines.join("\n");
  rawLog.scrollTop = rawLog.scrollHeight;
}

function clearLog(): void {
  rawLines.length = 0;
  rawLog.textContent = "";
  postMessage({ type: "clearLog" });
}

function appendSamples(samples: readonly { t: number; values: Record<string, number> }[]): void {
  let needsRebuild = false;

  for (const sample of samples) {
    if (firstTimestamp === undefined) {
      firstTimestamp = sample.t;
    }

    for (const channelName of Object.keys(sample.values)) {
      if (!channelData.has(channelName)) {
        channelData.set(
          channelName,
          Array.from({ length: timeValues.length }, () => null),
        );
        channelVisibility.set(channelName, true);
        needsRebuild = true;
      }
    }

    timeValues.push((sample.t - firstTimestamp) / 1000);

    for (const [channelName, values] of channelData.entries()) {
      const value = sample.values[channelName];
      values.push(typeof value === "number" && Number.isFinite(value) ? value : null);
    }
  }

  trimPlotData();

  if (needsRebuild) {
    rebuildPlot();
    return;
  }

  updatePlotData();
}

function trimPlotData(): void {
  if (timeValues.length <= maxPlotPoints) {
    return;
  }

  const removeCount = timeValues.length - maxPlotPoints;
  timeValues.splice(0, removeCount);

  for (const values of channelData.values()) {
    values.splice(0, removeCount);
  }
}

function rebuildPlot(): void {
  plot?.destroy();

  const channelNames = [...channelData.keys()];
  const series: uPlot.Series[] = [
    {},
    ...channelNames.map((channelName, index) => ({
      label: channelName,
      stroke: colors[index % colors.length],
      width: 2,
      show: channelVisibility.get(channelName) ?? true,
    })),
  ];

  plot = new uPlot(
    {
      ...getChartSize(),
      scales: {
        x: {
          time: false,
        },
      },
      axes: [
        {
          label: "Seconds",
          stroke: "var(--vscode-foreground)",
          grid: {
            stroke: "var(--vscode-panel-border)",
          },
        },
        {
          label: "Value",
          stroke: "var(--vscode-foreground)",
          grid: {
            stroke: "var(--vscode-panel-border)",
          },
        },
      ],
      series,
    },
    getPlotData(),
    chartElement,
  );

  renderLegend(channelNames);
}

function updatePlotData(): void {
  if (plot === undefined) {
    return;
  }

  plot.setData(getPlotData());
}

function getPlotData(): uPlot.AlignedData {
  const data: Array<number[] | Array<number | null>> = [timeValues];
  const values = [...channelData.values()];

  if (values.length === 0) {
    data.push([]);
  } else {
    data.push(...values);
  }

  return data as uPlot.AlignedData;
}

function renderLegend(channelNames: string[]): void {
  legendElement.replaceChildren();

  if (channelNames.length === 0) {
    const empty = document.createElement("span");
    empty.className = "legend-empty";
    empty.textContent = "Waiting for numeric data";
    legendElement.append(empty);
    return;
  }

  for (const [index, channelName] of channelNames.entries()) {
    const label = document.createElement("label");
    label.className = "legend-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = channelVisibility.get(channelName) ?? true;
    checkbox.addEventListener("change", () => {
      channelVisibility.set(channelName, checkbox.checked);
      plot?.setSeries(index + 1, { show: checkbox.checked });
    });

    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.backgroundColor = colors[index % colors.length] ?? colors[0];

    const text = document.createElement("span");
    text.textContent = channelName;

    label.append(checkbox, swatch, text);
    legendElement.append(label);
  }
}

function getChartSize(): { width: number; height: number } {
  const rect = chartElement.getBoundingClientRect();
  return {
    width: Math.max(320, Math.floor(rect.width)),
    height: Math.max(260, Math.floor(rect.height)),
  };
}

function showError(message: string): void {
  errorToast.textContent = message;
  errorToast.classList.add("error-toast-visible");
  window.setTimeout(() => {
    errorToast.classList.remove("error-toast-visible");
  }, 3500);
}

function saveState(): void {
  vscode.setState({
    baudRate: state.baudRate,
    parserMode: state.parserMode,
    selectedPath: state.selectedPath,
  });
}

function postMessage(message: ToExtensionMessage): void {
  vscode.postMessage(message);
}

function formatParserMode(parserMode: ParserMode): string {
  if (parserMode === "jsonl") {
    return "JSON Lines";
  }

  if (parserMode === "keyValue") {
    return "Key=Value";
  }

  return parserMode.toUpperCase();
}

function requireElement<T extends Element = HTMLElement>(parent: ParentNode, selector: string): T {
  const element = parent.querySelector<T>(selector);

  if (element === null) {
    throw new Error(`Missing required element: ${selector}`);
  }

  return element;
}
