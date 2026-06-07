import "uplot/dist/uPlot.min.css";
import "./styles.css";
import appHtml from "./app.html?raw";
import { baudRatePresets, isBaudRateInputValid, parseBaudRateInput } from "./baudRate";
import { MonitorOutputController } from "./monitorOutputs";
import {
  isParserMode,
  parserModes,
  type ParserMode,
  type ProfileConfig,
  type ProfileSummary,
  type SerialPortSummary,
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
const initialProfileKey = nonEmptyString(document.body.dataset.initialProfileKey);
const initialState: PersistedState = {
  baudRate: persistedState?.baudRate ?? defaultProfile.serialDefaults?.baudRate ?? 115200,
  parserMode: persistedState?.parserMode ?? ("auto" satisfies ParserMode),
  profileKey: initialProfileKey ?? persistedState?.profileKey ?? defaultProfileKey,
  selectedPath: persistedState?.selectedPath ?? "",
};

const state: PersistedState & { connected: boolean } = {
  ...initialState,
  connected: false,
};

const app = requireElement(document, "#app", HTMLElement);
app.innerHTML = appHtml;

const profileSelect = requireElement(document, "#profileSelect", HTMLSelectElement);
const portSelect = requireElement(document, "#portSelect", HTMLSelectElement);
const refreshPortsButton = requireElement(document, "#refreshPortsButton", HTMLButtonElement);
const baudRateInput = requireElement(document, "#baudRateInput", HTMLInputElement);
const baudRateDatalist = requireElement(document, "#baudRatePresets", HTMLDataListElement);
const parserModeSelect = requireElement(document, "#parserModeSelect", HTMLSelectElement);
const connectButton = requireElement(document, "#connectButton", HTMLButtonElement);
const connectionStatus = requireElement(document, "#connectionStatus", HTMLElement);
const outputWorkspace = requireElement(document, "#outputWorkspace", HTMLElement);
const sendForm = requireElement(document, "#sendForm", HTMLFormElement);
const sendInput = requireElement(document, "#sendInput", HTMLInputElement);
const sendButton = requireElement(document, "#sendButton", HTMLButtonElement);
const errorToast = requireElement(document, "#errorToast", HTMLElement);

let ports: SerialPortSummary[] = [];
let profiles: ProfileSummary[] = [];
let activeProfile: ProfileConfig = defaultProfile;
let userChangedBaudRate = persistedState?.baudRate !== undefined;
const outputController = new MonitorOutputController({
  root: outputWorkspace,
  postMessage,
});

setupControls();
outputController.renderOutputs(defaultProfile.outputs);
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
    outputController.appendLegacyRawLine(message.line, message.t);
    return;
  }

  if (message.type === "seriesAppend") {
    outputController.appendLegacySeries(message.samples);
    return;
  }

  if (message.type === "outputPacket") {
    outputController.appendPacket(message.packet);
    return;
  }

  if (message.type === "error") {
    showError(message.message);
  }
});

function setupControls(): void {
  for (const baudRate of baudRatePresets) {
    const option = document.createElement("option");
    option.value = String(baudRate);
    baudRateDatalist.append(option);
  }

  baudRateInput.value = String(state.baudRate);
  updateBaudRateInputValidity();

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

  baudRateInput.addEventListener("input", handleBaudRateInput);
  baudRateInput.addEventListener("change", handleBaudRateInput);

  parserModeSelect.addEventListener("change", () => {
    const parserMode = parserModeSelect.value;

    if (!isParserMode(parserMode)) {
      showError(`Unsupported parser mode: ${parserMode}`);
      parserModeSelect.value = state.parserMode;
      return;
    }

    state.parserMode = parserMode;
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

function handleBaudRateInput(): void {
  userChangedBaudRate = true;

  try {
    state.baudRate = parseBaudRateInput(baudRateInput.value);
    saveState();
  } catch {
    // Keep the last valid runtime value while the user is editing an invalid input.
  }

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
    baudRateInput.value = String(state.baudRate);
    updateBaudRateInputValidity();
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
  outputController.renderOutputs(profile.outputs);
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

  const baudRate = readBaudRateInput();

  if (baudRate === undefined) {
    showError("Enter a valid positive integer baud rate before connecting.");
    return;
  }

  postMessage({
    type: "connect",
    settings: {
      path: state.selectedPath,
      baudRate,
      parserMode: activeProfile.parser.kind === "builtin" ? state.parserMode : undefined,
    },
  });
}

function readBaudRateInput(): number | undefined {
  try {
    const baudRate = parseBaudRateInput(baudRateInput.value);
    baudRateInput.setAttribute("aria-invalid", "false");
    return baudRate;
  } catch {
    baudRateInput.setAttribute("aria-invalid", "true");
    return undefined;
  }
}

function updateBaudRateInputValidity(): boolean {
  const isValid = isBaudRateInputValid(baudRateInput.value);
  baudRateInput.setAttribute("aria-invalid", isValid ? "false" : "true");
  return isValid;
}

function updateConnectionControls(): void {
  connectButton.textContent = state.connected ? "Disconnect" : "Connect";
  connectButton.classList.toggle("button-danger", state.connected);
  connectionStatus.textContent = state.connected
    ? `Connected to ${state.selectedPath}`
    : "Disconnected";
  connectionStatus.classList.toggle("status-connected", state.connected);
  portSelect.disabled = state.connected || ports.length === 0;
  baudRateInput.disabled = state.connected;
  profileSelect.disabled = state.connected;
  parserModeSelect.disabled = state.connected || activeProfile.parser.kind === "script";
  connectButton.disabled =
    !state.connected && (state.selectedPath.length === 0 || !updateBaudRateInputValidity());
  sendInput.disabled = !state.connected;
  sendButton.disabled = !state.connected;
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

function requireElement<T extends Element>(
  parent: ParentNode,
  selector: string,
  elementType: new (...args: never[]) => T,
): T {
  const element = parent.querySelector(selector);

  if (element === null) {
    throw new Error(`Missing required element: ${selector}`);
  }

  if (!(element instanceof elementType)) {
    throw new Error(`Element ${selector} has unexpected type.`);
  }

  return element;
}

function nonEmptyString(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}
