import { afterEach, describe, expect, test, vi } from "vitest";
import { defaultProfile } from "../../src/profiles/defaultProfile";
import type { ProfileEditorState, ToProfileEditorMessage } from "../../src/shared/protocol";
import {
  createProfileEditorStore,
  type ProfileEditorPersistedState,
  type VsCodeApi,
} from "../../webview/src/profile-editor/store";

describe("profileEditorStore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("requests and stores profile editor state", () => {
    const vscode = createVscodeApi({ selectedProfileKey: "builtin:jsonl-telemetry" });
    const store = createProfileEditorStore(vscode.api);

    store.requestProfileEditorState();
    store.handleHostMessage({ type: "profileEditorState", state: createEditorState() });

    expect(vscode.messages[0]).toEqual({
      type: "requestProfileEditorState",
      profileKey: "builtin:jsonl-telemetry",
    });
    expect(store.state.selectedProfile?.id).toBe("default");
    expect(store.state.draft?.name).toBe("Default Auto Plot");
    expect(vscode.persistedState).toEqual({
      selectedProfileKey: "builtin:default",
      view: "home",
    });
  });

  test("sends keyed profile menu actions", () => {
    const vscode = createVscodeApi();
    const store = createProfileEditorStore(vscode.api);

    store.toggleProfileMenu("builtin:default");
    store.copyProfile("builtin:default");
    store.openProfileJson("user:custom");

    expect(store.state.openMenuProfileKey).toBeUndefined();
    expect(vscode.messages).toEqual([
      { type: "copyProfileByKey", profileKey: "builtin:default" },
      { type: "openProfileJson", profileKey: "user:custom" },
    ]);
  });

  test("opens editor after a profile is copied", () => {
    const vscode = createVscodeApi();
    const store = createProfileEditorStore(vscode.api);

    store.handleHostMessage({
      type: "profileCopied",
      profileKey: "workspace:file:///root:saved",
      filePath: "/root/.live-serial-plotter/profiles/saved.jsonc",
    });

    expect(store.state.view).toBe("editor");
    expect(store.state.selectedProfileKey).toBe("workspace:file:///root:saved");
    expect(store.state.statusText).toContain("saved.jsonc");
  });

  test("autosaves editable profiles after debounce", () => {
    vi.useFakeTimers();
    const vscode = createVscodeApi();
    const store = createProfileEditorStore(vscode.api);
    store.handleHostMessage({
      type: "profileEditorState",
      state: createEditorState({
        sourceScope: "workspace",
        profile: { ...defaultProfile, id: "editable", name: "Editable" },
      }),
    });

    store.state.draft!.name = "Edited";
    store.scheduleAutoSave();
    vi.advanceTimersByTime(350);

    expect(vscode.messages).toContainEqual({
      type: "autoSaveProfile",
      profile: expect.objectContaining({ id: "editable", name: "Edited" }),
    });
  });

  test("does not autosave invalid parser options JSON", () => {
    vi.useFakeTimers();
    const vscode = createVscodeApi();
    const store = createProfileEditorStore(vscode.api);
    store.handleHostMessage({
      type: "profileEditorState",
      state: createEditorState({
        sourceScope: "workspace",
        profile: { ...defaultProfile, id: "editable", name: "Editable" },
      }),
    });

    store.state.draft!.builtinParser!.optionsJson = "{";
    store.scheduleAutoSave();
    vi.advanceTimersByTime(350);

    expect(vscode.messages).not.toContainEqual(
      expect.objectContaining({ type: "autoSaveProfile" }),
    );
    expect(store.state.statusText).toContain("Expected");
  });
});

function createVscodeApi(initialState?: ProfileEditorPersistedState): {
  api: VsCodeApi<ProfileEditorPersistedState>;
  messages: ToProfileEditorMessage[];
  persistedState: ProfileEditorPersistedState | undefined;
} {
  const messages: ToProfileEditorMessage[] = [];
  let persistedState = initialState;

  return {
    api: {
      getState: () => persistedState,
      setState: (nextState) => {
        persistedState = nextState;
      },
      postMessage: (message) => messages.push(message),
    },
    messages,
    get persistedState() {
      return persistedState;
    },
  };
}

function createEditorState(
  options: {
    profile?: typeof defaultProfile;
    sourceScope?: "builtin" | "workspace" | "user";
  } = {},
): ProfileEditorState {
  const profile = options.profile ?? defaultProfile;
  const sourceScope = options.sourceScope ?? "builtin";
  const key = `${sourceScope}:${profile.id}`;

  return {
    profiles: [
      {
        key,
        ref: { scope: sourceScope, id: profile.id },
        id: profile.id,
        name: profile.name,
        scope: sourceScope,
      },
    ],
    selectedProfile: profile,
    selectedProfileKey: key,
    selectedSource: {
      key,
      ref: { scope: sourceScope, id: profile.id },
      scope: sourceScope,
      filePath:
        sourceScope === "builtin"
          ? undefined
          : `/workspace/.live-serial-plotter/profiles/${profile.id}.jsonc`,
    },
    errors: [],
  };
}
