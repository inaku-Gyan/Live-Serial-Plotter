// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, expect, test, vi } from "vitest";
import { defaultLayout } from "../../src/profiles/defaultLayout";
import { builtinProfiles, defaultProfile } from "../../src/profiles/defaultProfile";
import type {
  LayoutConfig,
  OutputConfig,
  OutputPacket,
  ProfileConfig,
  ToExtensionMessage,
} from "../../src/shared/protocol";
import MonitorApp from "../../webview/src/monitor/MonitorApp.vue";
import {
  createMonitorStore,
  type MonitorOutputAdapter,
  type MonitorPersistedState,
  type VsCodeApi,
} from "../../webview/src/monitor/store";

vi.mock("uplot", () => ({ default: vi.fn<() => void>() }));

describe("MonitorApp", () => {
  test("renders disconnected monitor shell and mounts output workspace", async () => {
    const { wrapper, adapter, vscode } = mountMonitor();
    await nextTick();

    expect(wrapper.find(".toolbar").exists()).toBe(true);
    expect(wrapper.find(".workspace").exists()).toBe(true);
    expect(wrapper.find(".send-row").exists()).toBe(true);
    expect(wrapper.find(".status").text()).toBe("Disconnected");
    expect(adapter.renderOutputs).toHaveBeenCalledWith(defaultProfile.outputs, defaultLayout);
    expect(vscode.messages).toContainEqual({
      type: "requestProfiles",
      profileKey: "builtin:default",
    });
    expect(vscode.messages).toContainEqual({ type: "requestPorts" });
  });

  test("renders profile options from host state and rebuilds outputs", async () => {
    const { wrapper, adapter } = mountMonitor();
    const profile = requireBuiltinProfile("jsonl-telemetry");

    dispatchHostMessage({
      type: "profiles",
      profiles: builtinProfiles.map((candidate) => ({
        key: `builtin:${candidate.id}`,
        ref: { scope: "builtin", id: candidate.id },
        id: candidate.id,
        name: candidate.name,
        scope: "builtin",
      })),
      activeProfile: profile,
      activeProfileKey: "builtin:jsonl-telemetry",
      activeLayout: defaultLayout,
      activeLayoutKey: "builtin:default",
      layouts: [createLayoutSummary()],
      layoutTargets: [],
    });
    await nextTick();

    expect(wrapper.find<HTMLSelectElement>(".field select").element.value).toBe(
      "builtin:jsonl-telemetry",
    );
    expect(wrapper.text()).toContain("JSONL Telemetry (builtin)");
    expect(adapter.renderOutputs).toHaveBeenLastCalledWith(profile.outputs, defaultLayout);
  });

  test("profile selection posts selectProfile", async () => {
    const { wrapper, vscode } = mountMonitor();
    const profileSelect = wrapper.find<HTMLSelectElement>(".field select");
    dispatchProfiles(defaultProfile);
    await nextTick();

    await profileSelect.setValue("builtin:jsonl-telemetry");

    expect(vscode.messages).toContainEqual({
      type: "selectProfile",
      profileKey: "builtin:jsonl-telemetry",
    });
  });

  test("connect controls follow port parser and connection state", async () => {
    const { wrapper, vscode } = mountMonitor();
    dispatchProfiles(defaultProfile);
    dispatchHostMessage({
      type: "ports",
      ports: [{ path: "/dev/ttyUSB0", manufacturer: "Acme" }],
    });
    await nextTick();

    const buttons = wrapper.findAll("button");
    const connectButton = buttons.find((button) => button.text() === "Connect");

    if (connectButton === undefined) {
      throw new Error("Missing connect button.");
    }

    expect(connectButton.attributes("disabled")).toBeUndefined();
    await connectButton.trigger("click");
    expect(vscode.messages).toContainEqual({
      type: "connect",
      settings: {
        path: "/dev/ttyUSB0",
        baudRate: 115_200,
        parserMode: "auto",
      },
    });

    dispatchHostMessage({
      type: "connectionState",
      state: { connected: true, path: "/dev/ttyUSB0", baudRate: 115_200 },
    });
    await nextTick();

    expect(wrapper.find(".status").classes()).toContain("status-connected");
    expect(wrapper.find(".status").text()).toBe("Connected to /dev/ttyUSB0");
    expect(
      wrapper.find<HTMLInputElement>(".send-row input").attributes("disabled"),
    ).toBeUndefined();
  });

  test("script profiles disable parser mode select", async () => {
    const { wrapper } = mountMonitor();
    const scriptProfile: ProfileConfig = {
      ...defaultProfile,
      id: "script",
      name: "Script",
      parser: { kind: "script", path: "parser.mjs" },
    };

    dispatchHostMessage({
      type: "activeProfile",
      profile: scriptProfile,
      profileKey: "user:script",
      layout: defaultLayout,
      layoutKey: "builtin:default",
    });
    await nextTick();

    const selects = wrapper.findAll("select");
    const parserSelect = selects.at(2);

    if (parserSelect === undefined) {
      throw new Error("Missing parser select.");
    }

    expect(parserSelect.attributes("disabled")).toBeDefined();
  });

  test("send row posts text and clears after successful send", async () => {
    const { wrapper, vscode } = mountMonitor();
    dispatchHostMessage({
      type: "connectionState",
      state: { connected: true, path: "/dev/ttyUSB0", baudRate: 115_200 },
    });
    await nextTick();

    const sendInput = wrapper.find<HTMLInputElement>(".send-row input");
    await sendInput.setValue("hello");
    await wrapper.find(".send-row").trigger("submit");

    expect(vscode.messages).toContainEqual({ type: "send", text: "hello" });
    expect(sendInput.element.value).toBe("");
  });

  test("host errors show the toast", async () => {
    const { wrapper } = mountMonitor();

    dispatchHostMessage({ type: "error", message: "Port failed" });
    await nextTick();

    const toast = wrapper.find(".error-toast");
    expect(toast.classes()).toContain("error-toast-visible");
    expect(toast.text()).toBe("Port failed");
  });
});

function mountMonitor(): {
  wrapper: ReturnType<typeof mount>;
  vscode: ReturnType<typeof createVscodeApi>;
  adapter: MockOutputAdapter;
} {
  const vscode = createVscodeApi();
  const adapter = createOutputAdapter();
  const store = createMonitorStore(vscode.api, {
    errorToastDelayMs: 50_000,
    createOutputAdapter: () => adapter,
  });
  const wrapper = mount(MonitorApp, {
    props: { store },
    attachTo: document.body,
  });

  return { wrapper, vscode, adapter };
}

function dispatchProfiles(activeProfile: ProfileConfig): void {
  dispatchHostMessage({
    type: "profiles",
    profiles: builtinProfiles.map((profile) => ({
      key: `builtin:${profile.id}`,
      ref: { scope: "builtin", id: profile.id },
      id: profile.id,
      name: profile.name,
      scope: "builtin",
    })),
    activeProfile,
    activeProfileKey: `builtin:${activeProfile.id}`,
    activeLayout: defaultLayout,
    activeLayoutKey: "builtin:default",
    layouts: [createLayoutSummary()],
    layoutTargets: [],
  });
}

function dispatchHostMessage(data: unknown): void {
  window.dispatchEvent(new MessageEvent("message", { data }));
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

function createLayoutSummary() {
  return {
    key: "builtin:default",
    ref: { scope: "builtin" as const, id: "default" },
    id: "default",
    name: "Default Monitor Layout",
    scope: "builtin" as const,
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

function requireBuiltinProfile(profileId: string): ProfileConfig {
  const profile = builtinProfiles.find((candidate) => candidate.id === profileId);

  if (profile === undefined) {
    throw new Error(`Missing builtin profile ${profileId}.`);
  }

  return profile;
}
