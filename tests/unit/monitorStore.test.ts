// @vitest-environment jsdom

import { describe, expect, test, vi } from "vitest";
import { defaultLayout } from "../../src/profiles/defaultLayout";
import { defaultProfile } from "../../src/profiles/defaultProfile";
import type {
  LayoutConfig,
  OutputConfig,
  OutputPacket,
  ParserMode,
  ProfileConfig,
  ToExtensionMessage,
} from "../../src/shared/protocol";
import {
  createMonitorStore,
  type MonitorOutputAdapter,
  type MonitorPersistedState,
  type VsCodeApi,
} from "../../webview/src/monitor/store";

vi.mock("uplot", () => ({ default: vi.fn<() => void>() }));

describe("monitor store", () => {
  test("initializes from persisted state and requests host data", () => {
    const vscode = createVscodeApi({
      baudRate: 57_600,
      parserMode: "csv",
      profileKey: "user:custom",
      selectedPath: "/dev/ttyUSB0",
    });
    const { store } = createStore(vscode.api);

    expect(store.state.baudRate).toBe(57_600);
    expect(store.state.baudRateInput).toBe("57600");
    expect(store.state.parserMode).toBe("csv");
    expect(store.state.profileKey).toBe("user:custom");
    expect(store.state.selectedPath).toBe("/dev/ttyUSB0");

    store.requestProfiles();
    store.requestPorts();

    expect(vscode.messages).toContainEqual({
      type: "requestProfiles",
      profileKey: "user:custom",
    });
    expect(vscode.messages).toContainEqual({ type: "requestPorts" });
  });

  test("applies host profiles and renders active profile outputs", () => {
    const vscode = createVscodeApi();
    const { store, adapter } = createStore(vscode.api);
    const root = document.createElement("section");
    store.mountOutputs(root);
    const profile = createProfile({
      id: "telemetry",
      name: "Telemetry",
      serialDefaults: { baudRate: 230_400 },
      parser: { kind: "builtin", mode: "jsonl" },
      outputs: [{ id: "plot", kind: "timeSeriesLine", time: { source: "sequence" }, series: {} }],
    });

    store.handleHostMessage({
      type: "profiles",
      profiles: [
        {
          key: "user:telemetry",
          ref: { scope: "user", id: "telemetry" },
          id: "telemetry",
          name: "Telemetry",
          scope: "user",
        },
      ],
      activeProfile: profile,
      activeProfileKey: "user:telemetry",
      activeLayout: defaultLayout,
      activeLayoutKey: "builtin:default",
      layouts: [
        {
          key: "builtin:default",
          ref: { scope: "builtin", id: "default" },
          id: "default",
          name: "Default Monitor Layout",
          scope: "builtin",
        },
      ],
      layoutTargets: [],
    });

    expect(store.state.profileKey).toBe("user:telemetry");
    expect(store.state.baudRate).toBe(230_400);
    expect(store.state.parserMode).toBe("jsonl");
    expect(adapter.renderOutputs).toHaveBeenLastCalledWith(profile.outputs, defaultLayout);
  });

  test("keeps user-edited baud rate when profiles change", () => {
    const vscode = createVscodeApi();
    const { store } = createStore(vscode.api);
    store.setBaudRateInput("9600");

    store.handleHostMessage({
      type: "activeProfile",
      profile: createProfile({
        id: "next",
        name: "Next",
        serialDefaults: { baudRate: 115_200 },
      }),
      profileKey: "user:next",
      layout: defaultLayout,
      layoutKey: "builtin:default",
    });

    expect(store.state.baudRate).toBe(9_600);
    expect(store.state.baudRateInput).toBe("9600");
  });

  test("derives connection controls and sends connect disconnect send messages", () => {
    const vscode = createVscodeApi();
    const { store } = createStore(vscode.api);

    store.handleHostMessage({
      type: "ports",
      ports: [{ path: "/dev/ttyUSB0", manufacturer: "Acme" }],
    });

    expect(store.portSelectDisabled.value).toBe(false);
    expect(store.connectDisabled.value).toBe(false);

    store.toggleConnection();
    expect(vscode.messages).toContainEqual({
      type: "connect",
      settings: {
        path: "/dev/ttyUSB0",
        baudRate: 115_200,
        parserMode: "auto",
      },
    });

    store.handleHostMessage({
      type: "connectionState",
      state: { connected: true, path: "/dev/ttyUSB0", baudRate: 115_200 },
    });
    expect(store.portSelectDisabled.value).toBe(true);
    expect(store.sendText("ping")).toBe(true);
    store.toggleConnection();

    expect(vscode.messages).toContainEqual({ type: "send", text: "ping" });
    expect(vscode.messages).toContainEqual({ type: "disconnect" });
  });

  test("forwards output packets directly to the imperative adapter", () => {
    const vscode = createVscodeApi();
    const { store, adapter } = createStore(vscode.api);
    const packet: OutputPacket = {
      kind: "terminalAppend",
      outputId: "raw",
      seq: 1,
      receivedAt: 1_000,
      lines: [{ text: "line" }],
    };

    store.mountOutputs(document.createElement("section"));
    store.handleHostMessage({ type: "outputPacket", packet });
    store.handleHostMessage({ type: "rawLine", line: "legacy", t: 1_100 });
    store.handleHostMessage({
      type: "seriesAppend",
      samples: [{ t: 1, values: { temp: 24 } }],
    });

    expect(adapter.appendPacket).toHaveBeenCalledWith(packet);
    expect(adapter.appendLegacyRawLine).toHaveBeenCalledWith("legacy", 1_100);
    expect(adapter.appendLegacySeries).toHaveBeenCalledWith([{ t: 1, values: { temp: 24 } }]);
  });

  test("sends layout reset and save actions through the adapter and host protocol", () => {
    const vscode = createVscodeApi();
    const { store, adapter } = createStore(vscode.api);
    store.mountOutputs(document.createElement("section"));

    store.resetOutputView("plot");
    store.resetPageLayout();
    store.saveLayout();
    store.saveLayoutAs("saved-layout", { label: "User", scope: "user" });

    expect(adapter.resetOutputView).toHaveBeenCalledWith("plot");
    expect(adapter.resetPageLayout).toHaveBeenCalled();
    expect(vscode.messages).toContainEqual({
      type: "saveLayout",
      request: { layout: defaultLayout, layoutKey: "builtin:default" },
    });
    expect(vscode.messages).toContainEqual({
      type: "saveLayoutAs",
      request: {
        layout: defaultLayout,
        layoutId: "saved-layout",
        target: { label: "User", scope: "user" },
        profileKey: "builtin:default",
      },
    });
  });

  test("disables parser mode for script profiles", () => {
    const vscode = createVscodeApi();
    const { store } = createStore(vscode.api);

    store.handleHostMessage({
      type: "activeProfile",
      profile: createProfile({
        id: "script",
        name: "Script",
        parser: { kind: "script", path: "parser.mjs" },
      }),
      profileKey: "user:script",
      layout: defaultLayout,
      layoutKey: "builtin:default",
    });

    expect(store.parserModeSelectDisabled.value).toBe(true);
  });
});

function createStore(vscode: VsCodeApi<MonitorPersistedState>): {
  store: ReturnType<typeof createMonitorStore>;
  adapter: MockOutputAdapter;
} {
  const adapter = createOutputAdapter();
  const store = createMonitorStore(vscode, {
    createOutputAdapter: () => adapter,
  });

  return { store, adapter };
}

interface MockOutputAdapter extends MonitorOutputAdapter {
  renderOutputs: ReturnType<
    typeof vi.fn<(outputs: readonly OutputConfig[], layout: LayoutConfig) => void>
  >;
  appendPacket: ReturnType<typeof vi.fn<(packet: OutputPacket) => void>>;
  appendLegacyRawLine: ReturnType<typeof vi.fn<(line: string, timestamp: number) => void>>;
  appendLegacySeries: ReturnType<
    typeof vi.fn<(samples: readonly { t: number; values: Record<string, number> }[]) => void>
  >;
  resetOutputView: ReturnType<typeof vi.fn<(outputId: string) => void>>;
  resetPageLayout: ReturnType<typeof vi.fn<() => void>>;
  captureSavableViewState: ReturnType<typeof vi.fn<() => LayoutConfig>>;
  dispose: ReturnType<typeof vi.fn<() => void>>;
}

function createOutputAdapter(): MockOutputAdapter {
  return {
    renderOutputs: vi.fn<(outputs: readonly OutputConfig[], layout: LayoutConfig) => void>(),
    appendPacket: vi.fn<(packet: OutputPacket) => void>(),
    appendLegacyRawLine: vi.fn<(line: string, timestamp: number) => void>(),
    appendLegacySeries:
      vi.fn<(samples: readonly { t: number; values: Record<string, number> }[]) => void>(),
    resetOutputView: vi.fn<(outputId: string) => void>(),
    resetPageLayout: vi.fn<() => void>(),
    captureSavableViewState: vi.fn<() => LayoutConfig>(() => defaultLayout),
    dispose: vi.fn<() => void>(),
  };
}

function createVscodeApi(initialState?: MonitorPersistedState): {
  api: VsCodeApi<MonitorPersistedState>;
  messages: ToExtensionMessage[];
  persistedState: MonitorPersistedState | undefined;
} {
  const messages: ToExtensionMessage[] = [];
  let persistedState = initialState;

  return {
    api: {
      getState: () => persistedState,
      setState: (nextState) => {
        persistedState = nextState;
      },
      postMessage: (message) => messages.push(structuredClone(message)),
    },
    messages,
    get persistedState() {
      return persistedState;
    },
  };
}

function createProfile(
  overrides: Partial<ProfileConfig> & { parserMode?: ParserMode },
): ProfileConfig {
  const parser =
    overrides.parser ??
    (overrides.parserMode === undefined
      ? defaultProfile.parser
      : { kind: "builtin" as const, mode: overrides.parserMode });

  return {
    ...defaultProfile,
    ...overrides,
    parser,
    outputs: overrides.outputs ?? defaultProfile.outputs,
  };
}
