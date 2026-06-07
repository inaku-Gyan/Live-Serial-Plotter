import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import "./styles.css";
import appHtml from "./app.html?raw";
import {
  parserModes,
  type OutputPacket,
  type ParserMode,
  type ProfileConfig,
  type ProfileSummary,
  type SerialPortSummary,
  type TimeSeriesLineOutputConfig,
  type ToExtensionMessage,
  type ToWebviewMessage,
} from "../../src/shared/protocol";
import { defaultProfile } from "../../src/profiles/defaultProfile";

interface VsCodeApi<State> {
  getState(): State | undefined;
  setState(state: State): void;
  postMessage(message: ToExtensionMessage): void;
}

interface PersistedState {
  baudRate: number;
  parserMode: ParserMode;
  profileKey: string;
  selectedPath: string;
}

declare function acquireVsCodeApi<State>(): VsCodeApi<State>;

const vscode = acquireVsCodeApi<PersistedState>();
const persistedState = vscode.getState();
const defaultProfileKey = `builtin:${defaultProfile.id}`;
const initialState: PersistedState = {
  baudRate: persistedState?.baudRate ?? defaultProfile.serialDefaults?.baudRate ?? 115200,
  parserMode: persistedState?.parserMode ?? ("auto" satisfies ParserMode),
  profileKey: persistedState?.profileKey ?? defaultProfileKey,
  selectedPath: persistedState?.selectedPath ?? "",
};

const state: PersistedState & { connected: boolean } = {
  ...initialState,
  connected: false,
};

const app = requireElement(document, "#app");
app.innerHTML = appHtml;

const profileSelect = requireElement<HTMLSelectElement>(document, "#profileSelect");
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
let profiles: ProfileSummary[] = [];
let activeProfile: ProfileConfig = defaultProfile;
let userChangedBaudRate = persistedState?.baudRate !== undefined;

setupControls();
rebuildPlot();
requestProfiles();
requestPorts();

window.addEventListener("message", (event: MessageEvent<ToWebviewMessage>) => {
  const message = event.data;

  if (message.type === "ports") {
    ports = message.ports;
    renderPorts();
    return;
  }

  if (message.type === "profiles") {
    profiles = message.profiles;
    applyProfile(message.activeProfile, message.activeProfileKey);
    renderProfiles();
    return;
  }

  if (message.type === "activeProfile") {
    applyProfile(message.profile, message.profileKey);
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

  if (message.type === "outputPacket") {
    handleOutputPacket(message.packet);
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

  profileSelect.addEventListener("change", () => {
    state.profileKey = profileSelect.value;
    saveState();
    postMessage({ type: "selectProfile", profileKey: state.profileKey });
  });

  refreshPortsButton.addEventListener("click", () => requestPorts());
  connectButton.addEventListener("click", () => toggleConnection());
  clearLogButton.addEventListener("click", () => clearLog());

  baudRateSelect.addEventListener("change", () => {
    state.baudRate = Number(baudRateSelect.value);
    userChangedBaudRate = true;
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

function requestProfiles(): void {
  postMessage({ type: "requestProfiles", profileKey: state.profileKey });
}

function renderProfiles(): void {
  profileSelect.replaceChildren();

  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.key;
    option.textContent = formatProfileSummary(profile);
    profileSelect.append(option);
  }

  profileSelect.value = state.profileKey;
}

function applyProfile(profile: ProfileConfig, profileKey: string): void {
  activeProfile = profile;
  state.profileKey = profileKey;

  if (!userChangedBaudRate && profile.serialDefaults?.baudRate !== undefined) {
    state.baudRate = profile.serialDefaults.baudRate;
    baudRateSelect.value = String(state.baudRate);
  }

  if (profile.parser.kind === "builtin") {
    state.parserMode = profile.parser.mode;
    parserModeSelect.value = state.parserMode;
    parserModeSelect.disabled = state.connected;
  } else {
    parserModeSelect.disabled = true;
  }

  profileSelect.value = state.profileKey;
  saveState();
  clearPlot();
  clearLogView();
  rebuildPlot();
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
      parserMode: activeProfile.parser.kind === "builtin" ? state.parserMode : undefined,
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
  profileSelect.disabled = state.connected;
  parserModeSelect.disabled = state.connected || activeProfile.parser.kind === "script";
  connectButton.disabled = !state.connected && state.selectedPath.length === 0;
  sendInput.disabled = !state.connected;
  sendButton.disabled = !state.connected;
}

function handleOutputPacket(packet: OutputPacket): void {
  if (packet.kind === "terminalAppend") {
    appendTerminalLines(
      packet.lines.map((line) => line.text),
      packet.receivedAt,
    );
    return;
  }

  if (packet.kind === "timeSeriesAppend") {
    appendTimeSeriesSamples(packet.samples);
  }
}

function appendRawLine(line: string, timestamp: number): void {
  appendTerminalLines([line], timestamp);
}

function appendTerminalLines(lines: readonly string[], timestamp: number): void {
  const time = new Date(timestamp).toLocaleTimeString();
  rawLines.push(...lines.map((line) => `[${time}] ${line}`));

  const maxLines = getRawMaxLines();

  if (rawLines.length > maxLines) {
    rawLines.splice(0, rawLines.length - maxLines);
  }

  rawLog.textContent = rawLines.join("\n");
  rawLog.scrollTop = rawLog.scrollHeight;
}

function clearLog(): void {
  clearLogView();
  postMessage({ type: "clearLog" });
}

function clearLogView(): void {
  rawLines.length = 0;
  rawLog.textContent = "";
}

function appendSamples(samples: readonly { t: number; values: Record<string, number> }[]): void {
  appendTimeSeriesSamples(samples.map((sample) => ({ time: sample.t, values: sample.values })));
}

function appendTimeSeriesSamples(
  samples: readonly { time: number; values: Record<string, number> }[],
): void {
  let needsRebuild = false;

  for (const sample of samples) {
    if (firstTimestamp === undefined) {
      firstTimestamp = sample.time;
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

    timeValues.push(sample.time);

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
  const maxPoints = getPlotMaxPoints();

  if (timeValues.length <= maxPoints) {
    return;
  }

  const removeCount = timeValues.length - maxPoints;
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
      label: getSeriesLabel(channelName),
      stroke: getSeriesColor(channelName, index),
      width: getSeriesWidth(channelName),
      show: channelVisibility.get(channelName) ?? getSeriesVisible(channelName),
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

function clearPlot(): void {
  firstTimestamp = undefined;
  timeValues.length = 0;
  channelData.clear();
  channelVisibility.clear();
}

function getRawMaxLines(): number {
  const rawOutput = activeProfile.outputs.find((output) => output.kind === "terminalAppend");
  return rawOutput?.maxLines ?? maxRawLines;
}

function getPlotMaxPoints(): number {
  const plotOutput = getTimeSeriesOutput();
  return plotOutput?.window?.maxPoints ?? maxPlotPoints;
}

function getTimeSeriesOutput(): TimeSeriesLineOutputConfig | undefined {
  return activeProfile.outputs.find((output) => output.kind === "timeSeriesLine");
}

function getSeriesLabel(channelName: string): string {
  const series = getTimeSeriesOutput()?.series[channelName];
  const unit = series?.unit;
  const label = series?.label ?? channelName;
  return unit === undefined ? label : `${label} (${unit})`;
}

function getSeriesColor(channelName: string, index: number): string {
  return (
    getTimeSeriesOutput()?.series[channelName]?.color ?? colors[index % colors.length] ?? colors[0]
  );
}

function getSeriesWidth(channelName: string): number {
  return getTimeSeriesOutput()?.series[channelName]?.line?.width ?? 2;
}

function getSeriesVisible(channelName: string): boolean {
  return getTimeSeriesOutput()?.series[channelName]?.visible ?? true;
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
    swatch.style.backgroundColor = getSeriesColor(channelName, index);

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
    profileKey: state.profileKey,
    selectedPath: state.selectedPath,
  });
}

function formatProfileSummary(profile: ProfileSummary): string {
  if (profile.scope === "workspace") {
    const workspace = profile.workspaceName ?? "workspace";
    return `${profile.name} (${workspace})`;
  }

  return `${profile.name} (${profile.scope})`;
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
