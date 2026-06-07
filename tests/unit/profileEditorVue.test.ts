// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, test, vi } from "vitest";
import { builtinProfiles, defaultProfile } from "../../src/profiles/defaultProfile";
import type {
  ProfileConfig,
  ProfileEditorState,
  ToProfileEditorMessage,
} from "../../src/shared/protocol";
import ProfileEditorApp from "../../webview/src/profile-editor/ProfileEditorApp.vue";
import {
  createProfileEditorStore,
  type ProfileEditorPersistedState,
  type VsCodeApi,
} from "../../webview/src/profile-editor/store";

describe("ProfileEditorApp", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("profile item click opens a monitor page without entering editor", async () => {
    const { wrapper, vscode } = mountProfileEditor();
    const jsonlProfile = requireBuiltinProfile("jsonl-telemetry");
    dispatchEditorState(createEditorState({ selectedProfile: defaultProfile }));
    await nextTick();

    await requireItem(wrapper.findAll(".profile-list-main"), 1).trigger("click");
    expect(vscode.messages).toContainEqual({
      type: "selectProfileForEdit",
      profileKey: "builtin:jsonl-telemetry",
    });
    expect(vscode.messages).toContainEqual({
      type: "openMonitorForProfile",
      profileKey: "builtin:jsonl-telemetry",
    });
    expect(wrapper.find("main").classes()).toContain("profile-home");

    dispatchEditorState(createEditorState({ selectedProfile: jsonlProfile }));
    await nextTick();

    expect(wrapper.text()).toContain("JSONL Telemetry / jsonl-telemetry");
    expect(wrapper.find("main").classes()).toContain("profile-home");
  });

  test("profile action menu opens and closes on outside pointerdown", async () => {
    const { wrapper } = mountProfileEditor();
    dispatchEditorState(createEditorState({ selectedProfile: defaultProfile }));
    await nextTick();

    await wrapper.find(".profile-menu-trigger").trigger("click");
    expect(wrapper.find(".profile-list-menu").exists()).toBe(true);

    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await nextTick();

    expect(wrapper.find(".profile-list-menu").exists()).toBe(false);
  });

  test("builtin profile action menu only shows copy", async () => {
    const { wrapper, vscode } = mountProfileEditor();
    dispatchEditorState(createEditorState({ selectedProfile: defaultProfile }));
    await nextTick();

    await wrapper.find(".profile-menu-trigger").trigger("click");
    const menuButtons = wrapper.findAll(".profile-list-menu button");
    expect(menuButtons.map((button) => button.text())).toEqual(["Copy"]);
    await requireItem(menuButtons, 0).trigger("click");

    expect(vscode.messages).toContainEqual({
      type: "copyProfileByKey",
      profileKey: "builtin:default",
    });
    expect(vscode.messages).not.toContainEqual(
      expect.objectContaining({ type: "openProfileJson" }),
    );
  });

  test("workspace profile action menu shows edit copy and open jsonc", async () => {
    const { wrapper, vscode } = mountProfileEditor();
    const profile = { ...defaultProfile, id: "editable", name: "Editable" };
    dispatchEditorState(createEditorState({ selectedProfile: profile, sourceScope: "workspace" }));
    await nextTick();

    await wrapper.find(".profile-menu-trigger").trigger("click");
    const menuButtons = wrapper.findAll(".profile-list-menu button");
    expect(menuButtons.map((button) => button.text())).toEqual(["Edit", "Copy", "Open JSONC"]);
    await requireItem(menuButtons, 2).trigger("click");

    expect(vscode.messages).toContainEqual({
      type: "openProfileJson",
      profileKey: "workspace:editable",
    });
  });

  test("profile item context menu uses the same profile actions", async () => {
    const { wrapper, vscode } = mountProfileEditor();
    const profile = { ...defaultProfile, id: "editable", name: "Editable" };
    dispatchEditorState(createEditorState({ selectedProfile: profile, sourceScope: "workspace" }));
    await nextTick();

    await wrapper.find(".profile-list-item").trigger("contextmenu", { clientX: 24, clientY: 36 });
    await nextTick();
    const menu = wrapper.find(".profile-list-menu");
    const menuButtons = wrapper.findAll(".profile-list-menu button");
    expect(menu.classes()).toContain("profile-list-menu--context");
    expect(menu.attributes("style")).toContain("left: 24px");
    expect(menu.attributes("style")).toContain("top: 36px");
    expect(menuButtons.map((button) => button.text())).toEqual(["Edit", "Copy", "Open JSONC"]);

    await requireItem(menuButtons, 1).trigger("click");

    expect(vscode.messages).toContainEqual({
      type: "copyProfileByKey",
      profileKey: "workspace:editable",
    });
  });

  test("profile item context menu closes when focus changes outside the menu root", async () => {
    const { wrapper } = mountProfileEditor();
    const profile = { ...defaultProfile, id: "editable", name: "Editable" };
    dispatchEditorState(createEditorState({ selectedProfile: profile, sourceScope: "workspace" }));
    await nextTick();

    await wrapper.find(".profile-list-item").trigger("contextmenu", { clientX: 24, clientY: 36 });
    await nextTick();
    const firstMenuButton = requireItem(wrapper.findAll(".profile-list-menu button"), 0);
    expect(document.activeElement).toBe(firstMenuButton.element);

    wrapper.find<HTMLButtonElement>(".profile-list-main").element.focus();
    await nextTick();

    expect(wrapper.find(".profile-list-menu").exists()).toBe(false);
  });

  test("profile action menu closes when focus moves outside the menu root", async () => {
    const { wrapper } = mountProfileEditor();
    dispatchEditorState(createEditorState({ selectedProfile: defaultProfile }));
    await nextTick();

    await wrapper.find(".profile-menu-trigger").trigger("click");
    expect(wrapper.find(".profile-list-menu").exists()).toBe(true);

    wrapper.find<HTMLButtonElement>(".profile-list-main").element.focus();
    await nextTick();

    expect(wrapper.find(".profile-list-menu").exists()).toBe(false);
  });

  test("copy success moves to the copied profile editor", async () => {
    const { wrapper } = mountProfileEditor();
    const copiedProfile = { ...defaultProfile, id: "copied", name: "Copied" };
    dispatchEditorState(createEditorState({ selectedProfile: defaultProfile }));
    await nextTick();

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "profileCopied",
          profileKey: "workspace:file:///workspace:copied",
          filePath: "/workspace/.live-serial-plotter/profiles/copied.jsonc",
        },
      }),
    );
    dispatchEditorState(
      createEditorState({ selectedProfile: copiedProfile, sourceScope: "workspace" }),
    );
    await nextTick();

    expect(wrapper.find("main").classes()).toContain("profile-editor");
    expect(wrapper.find(".profile-editor-title").text()).toContain("Copied");
  });

  test("editable profile autosaves valid changes after debounce", async () => {
    vi.useFakeTimers();
    const { wrapper, vscode } = mountProfileEditor();
    const profile = { ...defaultProfile, id: "editable", name: "Editable" };
    dispatchEditorState(createEditorState({ selectedProfile: profile, sourceScope: "workspace" }));
    await nextTick();

    await wrapper.find(".profile-menu-trigger").trigger("click");
    await requireItem(wrapper.findAll(".profile-list-menu button"), 0).trigger("click");
    await nextTick();
    await wrapper.find<HTMLInputElement>('input[name="profile.name"]').setValue("Edited");
    vi.advanceTimersByTime(350);
    await nextTick();

    expect(vscode.messages).toContainEqual({
      type: "autoSaveProfile",
      profile: expect.objectContaining({ id: "editable", name: "Edited" }),
    });
  });

  test("editable profile autosaves custom baud rate after debounce", async () => {
    vi.useFakeTimers();
    const { wrapper, vscode } = mountProfileEditor();
    const profile = { ...defaultProfile, id: "editable", name: "Editable" };
    dispatchEditorState(createEditorState({ selectedProfile: profile, sourceScope: "workspace" }));
    await nextTick();

    await wrapper.find(".profile-menu-trigger").trigger("click");
    await requireItem(wrapper.findAll(".profile-list-menu button"), 0).trigger("click");
    await nextTick();
    await wrapper
      .find<HTMLInputElement>('input[name="serialDefaults.baudRate"]')
      .setValue("250000");
    vi.advanceTimersByTime(350);
    await nextTick();

    expect(vscode.messages).toContainEqual({
      type: "autoSaveProfile",
      profile: expect.objectContaining({ serialDefaults: { baudRate: 250000 } }),
    });
  });

  test("invalid profile baud rate does not autosave", async () => {
    vi.useFakeTimers();
    const { wrapper, vscode } = mountProfileEditor();
    const profile = { ...defaultProfile, id: "editable", name: "Editable" };
    dispatchEditorState(createEditorState({ selectedProfile: profile, sourceScope: "workspace" }));
    await nextTick();

    await wrapper.find(".profile-menu-trigger").trigger("click");
    await requireItem(wrapper.findAll(".profile-list-menu button"), 0).trigger("click");
    await nextTick();
    await wrapper.find<HTMLInputElement>('input[name="serialDefaults.baudRate"]').setValue("0");
    vi.advanceTimersByTime(350);
    await nextTick();

    expect(vscode.messages).not.toContainEqual(
      expect.objectContaining({ type: "autoSaveProfile" }),
    );
    expect(wrapper.text()).toContain("Baud rate must be a positive integer.");
  });

  test("invalid parser options do not autosave", async () => {
    vi.useFakeTimers();
    const { wrapper, vscode } = mountProfileEditor();
    const profile = { ...defaultProfile, id: "editable", name: "Editable" };
    dispatchEditorState(createEditorState({ selectedProfile: profile, sourceScope: "workspace" }));
    await nextTick();

    await wrapper.find(".profile-menu-trigger").trigger("click");
    await requireItem(wrapper.findAll(".profile-list-menu button"), 0).trigger("click");
    await nextTick();
    await wrapper.find<HTMLTextAreaElement>('textarea[name="parser.options"]').setValue("{");
    vi.advanceTimersByTime(350);
    await nextTick();

    expect(vscode.messages).not.toContainEqual(
      expect.objectContaining({ type: "autoSaveProfile" }),
    );
    expect(wrapper.text()).toContain("Expected");
  });
});

function mountProfileEditor(): {
  wrapper: ReturnType<typeof mount>;
  vscode: ReturnType<typeof createVscodeApi>;
} {
  const vscode = createVscodeApi();
  const store = createProfileEditorStore(vscode.api);
  const wrapper = mount(ProfileEditorApp, {
    props: { store },
    attachTo: document.body,
  });

  return { wrapper, vscode };
}

function dispatchEditorState(state: ProfileEditorState): void {
  window.dispatchEvent(
    new MessageEvent("message", { data: { type: "profileEditorState", state } }),
  );
}

function createVscodeApi(): {
  api: VsCodeApi<ProfileEditorPersistedState>;
  messages: ToProfileEditorMessage[];
  persistedState: ProfileEditorPersistedState | undefined;
} {
  const messages: ToProfileEditorMessage[] = [];
  let persistedState: ProfileEditorPersistedState | undefined;

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

function requireItem<T>(items: readonly T[], index: number): T {
  const item = items[index];

  if (item === undefined) {
    throw new Error(`Missing item at index ${index}.`);
  }

  return item;
}

function createEditorState(options: {
  selectedProfile: ProfileConfig;
  sourceScope?: "builtin" | "workspace" | "user";
}): ProfileEditorState {
  const sourceScope = options.sourceScope ?? "builtin";
  const selectedKey = `${sourceScope}:${options.selectedProfile.id}`;
  const selectedSummary = {
    key: selectedKey,
    ref: { scope: sourceScope, id: options.selectedProfile.id },
    id: options.selectedProfile.id,
    name: options.selectedProfile.name,
    scope: sourceScope,
    workspaceName: sourceScope === "workspace" ? "workspace" : undefined,
  };

  return {
    profiles:
      sourceScope === "builtin"
        ? builtinProfiles.map((profile) => ({
            key: `builtin:${profile.id}`,
            ref: { scope: "builtin", id: profile.id },
            id: profile.id,
            name: profile.name,
            scope: "builtin",
          }))
        : [selectedSummary],
    selectedProfile: options.selectedProfile,
    selectedProfileKey: selectedKey,
    selectedSource: {
      key: selectedKey,
      ref: { scope: sourceScope, id: options.selectedProfile.id },
      scope: sourceScope,
      filePath:
        sourceScope === "builtin"
          ? undefined
          : `/workspace/.live-serial-plotter/profiles/${options.selectedProfile.id}.jsonc`,
      workspaceFolderUri: sourceScope === "workspace" ? "file:///workspace" : undefined,
      workspaceName: sourceScope === "workspace" ? "workspace" : undefined,
    },
    errors: [],
  };
}

function requireBuiltinProfile(profileId: string): ProfileConfig {
  const profile = builtinProfiles.find((candidate) => candidate.id === profileId);

  if (profile === undefined) {
    throw new Error(`Missing builtin profile ${profileId}.`);
  }

  return profile;
}
