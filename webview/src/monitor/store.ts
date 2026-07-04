import { computed, inject, reactive, type InjectionKey } from "vue";
import { defaultLayout } from "../../../src/profiles/defaultLayout";
import { defaultProfile } from "../../../src/profiles/defaultProfile";
import {
  isParserMode,
  type ConnectionSettings,
  type LayoutConfig,
  type LayoutSaveTarget,
  type LayoutSummary,
  type ParserMode,
  type ProfileConfig,
  type ProfileSummary,
  type SerialPortSummary,
  type ToExtensionMessage,
  type ToWebviewMessage,
} from "../../../src/shared/protocol";
import type { VsCodeApi } from "../../../src/shared/vscodeApi";
import { isBaudRateInputValid, parseBaudRateInput } from "../baudRate";
import { DomOutputGridController } from "./outputs/outputGridController";
import type { OutputGridController } from "./outputs/types";

export type { OutputGridController };

export type PageVsCodeApi = VsCodeApi<PagePersistedState, ToExtensionMessage>;

export interface PagePersistedState {
  baudRate?: number;
  layoutKey?: string;
  parserMode?: ParserMode;
  profileKey?: string;
  selectedPath?: string;
}

export interface PageStoreOptions {
  initialProfileKey?: string;
  errorToastDelayMs?: number;
  createOutputGrid?: (root: HTMLElement) => OutputGridController;
}

interface PageState {
  profiles: ProfileSummary[];
  layouts: LayoutSummary[];
  layoutTargets: LayoutSaveTarget[];
  ports: SerialPortSummary[];
  activeProfile: ProfileConfig;
  activeLayout: LayoutConfig;
  profileKey: string;
  layoutKey: string;
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

export function createPageStore(vscode: PageVsCodeApi, options: PageStoreOptions = {}) {
  const persistedState = vscode.getState();
  const initialBaudRate =
    persistedState?.baudRate ?? defaultProfile.serialDefaults?.baudRate ?? 115200;
  const errorToastDelayMs = options.errorToastDelayMs ?? 3500;
  const createOutputGrid =
    options.createOutputGrid ?? ((root: HTMLElement) => new DomOutputGridController({ root }));

  let outputGrid: OutputGridController | undefined;
  let errorTimer: ReturnType<typeof setTimeout> | undefined;

  const state = reactive<PageState>({
    profiles: [],
    layouts: [],
    layoutTargets: [],
    ports: [],
    activeProfile: defaultProfile,
    activeLayout: defaultLayout,
    profileKey: options.initialProfileKey ?? persistedState?.profileKey ?? defaultProfileKey,
    layoutKey: persistedState?.layoutKey ?? defaultProfile.layout.defaultPreset,
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

  function mountOutputGrid(root: HTMLElement): void {
    outputGrid?.dispose();
    outputGrid = createOutputGrid(root);
    outputGrid.renderOutputs(state.activeProfile.outputs, state.activeLayout);
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

    const settings: ConnectionSettings = {
      path: state.selectedPath,
      baudRate: state.baudRate,
    };

    if (state.activeProfile.parser.kind === "builtin") {
      settings.parserMode = state.parserMode;
    }

    postMessage({ type: "connect", settings });
  }

  function sendText(text: string): boolean {
    if (text.length === 0 || !state.connected) {
      return false;
    }

    postMessage({ type: "send", text });
    return true;
  }

  function handleHostMessage(message: ToWebviewMessage): void {
    switch (message.type) {
      case "ports":
        applyPorts(message.ports);
        return;
      case "profiles":
        state.profiles = [...message.profiles];
        state.layouts = [...message.layouts];
        state.layoutTargets = [...message.layoutTargets];
        applyProfile(
          message.activeProfile,
          message.activeProfileKey,
          message.activeLayout,
          message.activeLayoutKey,
        );
        return;
      case "activeProfile":
        applyProfile(message.profile, message.profileKey, message.layout, message.layoutKey);
        return;
      case "layoutSaved":
        state.activeLayout = message.layout;
        state.layoutKey = message.layoutKey;
        persistState();
        outputGrid?.renderOutputs(state.activeProfile.outputs, state.activeLayout);
        return;
      case "layoutSavedAs":
        state.activeProfile = message.profile;
        state.activeLayout = message.layout;
        state.layoutKey = message.layoutKey;
        persistState();
        outputGrid?.renderOutputs(state.activeProfile.outputs, state.activeLayout);
        return;
      case "connectionState":
        state.connected = message.state.connected;
        return;
      case "outputPacket":
        outputGrid?.appendPacket(message.packet);
        return;
      case "error":
        showError(message.message);
        return;
      default:
        assertNever(message);
    }
  }

  function dispose(): void {
    if (errorTimer !== undefined) {
      clearTimeout(errorTimer);
      errorTimer = undefined;
    }

    outputGrid?.dispose();
    outputGrid = undefined;
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

  function resetOutputViewState(outputId: string): void {
    outputGrid?.resetOutputViewState(outputId);
  }

  function resetPageLayout(): void {
    outputGrid?.resetPageLayout();
  }

  function saveLayout(): void {
    const layout = outputGrid?.captureLayout() ?? state.activeLayout;
    postMessage({ type: "saveLayout", request: { layout, layoutKey: state.layoutKey } });
  }

  function saveLayoutAs(layoutId: string, target: LayoutSaveTarget): void {
    const layout = outputGrid?.captureLayout() ?? state.activeLayout;
    postMessage({
      type: "saveLayoutAs",
      request: {
        layout,
        layoutId,
        target: { ...target },
        profileKey: state.profileKey,
      },
    });
  }

  function applyProfile(
    profile: ProfileConfig,
    profileKey: string,
    layout: LayoutConfig,
    layoutKey: string,
  ): void {
    state.activeProfile = profile;
    state.profileKey = profileKey;
    state.activeLayout = layout;
    state.layoutKey = layoutKey;

    if (!userChangedBaudRate && profile.serialDefaults?.baudRate !== undefined) {
      state.baudRate = profile.serialDefaults.baudRate;
      state.baudRateInput = String(profile.serialDefaults.baudRate);
    }

    if (profile.parser.kind === "builtin") {
      state.parserMode = profile.parser.mode;
    }

    persistState();
    outputGrid?.renderOutputs(profile.outputs, layout);
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
      layoutKey: state.layoutKey,
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
    mountOutputGrid,
    requestPorts,
    requestProfiles,
    selectProfile,
    setSelectedPath,
    setBaudRateInput,
    setParserMode,
    toggleConnection,
    sendText,
    handleHostMessage,
    resetOutputViewState,
    resetPageLayout,
    saveLayout,
    saveLayoutAs,
    showError,
    dispose,
  };
}

export type PageStore = ReturnType<typeof createPageStore>;

export const PageStoreKey: InjectionKey<PageStore> = Symbol("PageStore");

export function usePageStore(): PageStore {
  const store = inject(PageStoreKey);

  if (store === undefined) {
    throw new Error("PageStore was not provided.");
  }

  return store;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled host message: ${JSON.stringify(value)}`);
}
