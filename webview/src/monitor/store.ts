import { computed, reactive } from "vue";
import { defaultProfile } from "../../../src/profiles/defaultProfile";
import {
  isParserMode,
  type OutputConfig,
  type OutputPacket,
  type ParserMode,
  type ProfileConfig,
  type ProfileSummary,
  type SerialPortSummary,
  type ToExtensionMessage,
  type ToWebviewMessage,
} from "../../../src/shared/protocol";
import { isBaudRateInputValid, parseBaudRateInput } from "../baudRate";
import { MonitorOutputController } from "../monitorOutputs";

export interface VsCodeApi<State> {
  getState(): State | undefined;
  setState(state: State): void;
  postMessage(message: ToExtensionMessage): void;
}

export interface MonitorPersistedState {
  baudRate?: number;
  parserMode?: ParserMode;
  profileKey?: string;
  selectedPath?: string;
}

export interface MonitorOutputAdapter {
  renderOutputs(outputs: readonly OutputConfig[]): void;
  appendPacket(packet: OutputPacket): void;
  appendLegacyRawLine(line: string, timestamp: number): void;
  appendLegacySeries(samples: readonly { t: number; values: Record<string, number> }[]): void;
  dispose(): void;
}

export interface MonitorStoreOptions {
  initialProfileKey?: string;
  errorToastDelayMs?: number;
  createOutputAdapter?: (
    root: HTMLElement,
    postMessage: (message: ToExtensionMessage) => void,
  ) => MonitorOutputAdapter;
}

interface MonitorUiState {
  profiles: ProfileSummary[];
  ports: SerialPortSummary[];
  activeProfile: ProfileConfig;
  profileKey: string;
  selectedPath: string;
  baudRate: number;
  baudRateInput: string;
  parserMode: ParserMode;
  connected: boolean;
  errorMessage: string;
  errorVisible: boolean;
}

const defaultProfileKey = `builtin:${defaultProfile.id}`;
const defaultParserMode: ParserMode =
  defaultProfile.parser.kind === "builtin" ? defaultProfile.parser.mode : "auto";

export function createMonitorStore(
  vscode: VsCodeApi<MonitorPersistedState>,
  options: MonitorStoreOptions = {},
) {
  const persistedState = vscode.getState();
  const initialBaudRate =
    persistedState?.baudRate ?? defaultProfile.serialDefaults?.baudRate ?? 115200;
  const errorToastDelayMs = options.errorToastDelayMs ?? 3500;
  const createOutputAdapter =
    options.createOutputAdapter ??
    ((root: HTMLElement, postToExtension: (message: ToExtensionMessage) => void) =>
      new MonitorOutputController({ root, postMessage: postToExtension }));

  let outputAdapter: MonitorOutputAdapter | undefined;
  let errorTimer: ReturnType<typeof setTimeout> | undefined;

  const state = reactive<MonitorUiState>({
    profiles: [],
    ports: [],
    activeProfile: defaultProfile,
    profileKey: options.initialProfileKey ?? persistedState?.profileKey ?? defaultProfileKey,
    selectedPath: persistedState?.selectedPath ?? "",
    baudRate: initialBaudRate,
    baudRateInput: String(initialBaudRate),
    parserMode: persistedState?.parserMode ?? defaultParserMode,
    connected: false,
    errorMessage: "",
    errorVisible: false,
  });

  let userChangedBaudRate = persistedState?.baudRate !== undefined;

  const baudRateValid = computed(() => isBaudRateInputValid(state.baudRateInput));
  const connectionStatusText = computed(() =>
    state.connected ? `Connected to ${state.selectedPath}` : "Disconnected",
  );
  const portSelectDisabled = computed(() => state.connected || state.ports.length === 0);
  const parserModeSelectDisabled = computed(
    () => state.connected || state.activeProfile.parser.kind === "script",
  );
  const connectDisabled = computed(
    () => !state.connected && (state.selectedPath.length === 0 || !baudRateValid.value),
  );
  const sendDisabled = computed(() => !state.connected);

  function mountOutputs(root: HTMLElement): void {
    outputAdapter?.dispose();
    outputAdapter = createOutputAdapter(root, postMessage);
    outputAdapter.renderOutputs(state.activeProfile.outputs);
  }

  function requestPorts(): void {
    postMessage({ type: "requestPorts" });
  }

  function requestProfiles(profileKey = state.profileKey): void {
    postMessage({ type: "requestProfiles", profileKey });
  }

  function selectProfile(profileKey: string): void {
    state.profileKey = profileKey;
    persistState();
    postMessage({ type: "selectProfile", profileKey });
  }

  function setSelectedPath(path: string): void {
    state.selectedPath = path;
    persistState();
  }

  function setBaudRateInput(value: string): void {
    userChangedBaudRate = true;
    state.baudRateInput = value;

    try {
      state.baudRate = parseBaudRateInput(value);
      persistState();
    } catch {
      // Keep the last valid runtime baud rate while the user edits an invalid input.
    }
  }

  function setParserMode(value: string): void {
    if (!isParserMode(value)) {
      showError(`Unsupported parser mode: ${value}`);
      return;
    }

    state.parserMode = value;
    persistState();
    postMessage({ type: "setParserMode", parserMode: state.parserMode });
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

    if (!baudRateValid.value) {
      showError("Enter a valid positive integer baud rate before connecting.");
      return;
    }

    postMessage({
      type: "connect",
      settings: {
        path: state.selectedPath,
        baudRate: state.baudRate,
        parserMode: state.activeProfile.parser.kind === "builtin" ? state.parserMode : undefined,
      },
    });
  }

  function sendText(text: string): boolean {
    if (text.length === 0 || !state.connected) {
      return false;
    }

    postMessage({ type: "send", text });
    return true;
  }

  function handleHostMessage(message: ToWebviewMessage): void {
    if (message.type === "ports") {
      applyPorts(message.ports);
      return;
    }

    if (message.type === "profiles") {
      state.profiles = [...message.profiles];
      applyProfile(message.activeProfile, message.activeProfileKey);
      return;
    }

    if (message.type === "activeProfile") {
      applyProfile(message.profile, message.profileKey);
      return;
    }

    if (message.type === "connectionState") {
      state.connected = message.state.connected;
      return;
    }

    if (message.type === "rawLine") {
      outputAdapter?.appendLegacyRawLine(message.line, message.t);
      return;
    }

    if (message.type === "seriesAppend") {
      outputAdapter?.appendLegacySeries(message.samples);
      return;
    }

    if (message.type === "outputPacket") {
      outputAdapter?.appendPacket(message.packet);
      return;
    }

    showError(message.message);
  }

  function dispose(): void {
    if (errorTimer !== undefined) {
      clearTimeout(errorTimer);
      errorTimer = undefined;
    }

    outputAdapter?.dispose();
    outputAdapter = undefined;
  }

  function applyPorts(ports: readonly SerialPortSummary[]): void {
    state.ports = [...ports];

    if (state.ports.length === 0) {
      state.selectedPath = "";
      persistState();
      return;
    }

    const selectedPortStillExists = state.ports.some((port) => port.path === state.selectedPath);
    state.selectedPath = selectedPortStillExists
      ? state.selectedPath
      : (state.ports[0]?.path ?? "");
    persistState();
  }

  function applyProfile(profile: ProfileConfig, profileKey: string): void {
    state.activeProfile = profile;
    state.profileKey = profileKey;

    if (!userChangedBaudRate && profile.serialDefaults?.baudRate !== undefined) {
      state.baudRate = profile.serialDefaults.baudRate;
      state.baudRateInput = String(profile.serialDefaults.baudRate);
    }

    if (profile.parser.kind === "builtin") {
      state.parserMode = profile.parser.mode;
    }

    persistState();
    outputAdapter?.renderOutputs(profile.outputs);
  }

  function showError(message: string): void {
    state.errorMessage = message;
    state.errorVisible = true;

    if (errorTimer !== undefined) {
      clearTimeout(errorTimer);
    }

    errorTimer = setTimeout(() => {
      state.errorVisible = false;
      errorTimer = undefined;
    }, errorToastDelayMs);
  }

  function persistState(): void {
    vscode.setState({
      baudRate: state.baudRate,
      parserMode: state.parserMode,
      profileKey: state.profileKey,
      selectedPath: state.selectedPath,
    });
  }

  function postMessage(message: ToExtensionMessage): void {
    vscode.postMessage(message);
  }

  return {
    state,
    baudRateValid,
    connectionStatusText,
    portSelectDisabled,
    parserModeSelectDisabled,
    connectDisabled,
    sendDisabled,
    mountOutputs,
    requestPorts,
    requestProfiles,
    selectProfile,
    setSelectedPath,
    setBaudRateInput,
    setParserMode,
    toggleConnection,
    sendText,
    handleHostMessage,
    dispose,
  };
}

export type MonitorStore = ReturnType<typeof createMonitorStore>;
