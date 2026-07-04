import { computed, inject, reactive, watch, type InjectionKey, type WatchStopHandle } from "vue";
import { formatError } from "../../../src/shared/formatError";
import type {
  ProfileConfig,
  ProfileEditorState,
  ProfileSourceMetadata,
  ToProfileEditorMessage,
  ToProfileEditorWebviewMessage,
} from "../../../src/shared/protocol";
import type { VsCodeApi } from "../../../src/shared/vscodeApi";
import {
  applyProfileEditorPatch,
  createProfileEditorPatch,
  type ProfileEditorPatch,
} from "./model";

export type ProfileEditorScreen = "home" | "editor";

export type ProfileEditorVsCodeApi = VsCodeApi<ProfileEditorPersistedState, ToProfileEditorMessage>;

export interface ProfileEditorPersistedState {
  selectedProfileKey?: string;
  screen?: ProfileEditorScreen;
}

export interface ProfileMenu {
  profileKey: string;
  x?: number;
  y?: number;
}

interface ProfileEditorUiState {
  editorState: ProfileEditorState | undefined;
  selectedProfile: ProfileConfig | undefined;
  selectedProfileKey: string | undefined;
  selectedSource: ProfileSourceMetadata | undefined;
  draft: ProfileEditorPatch | undefined;
  screen: ProfileEditorScreen;
  profileMenu: ProfileMenu | undefined;
  statusText: string;
}

export function createProfileEditorStore(
  vscode: ProfileEditorVsCodeApi,
  options: { autosaveDelayMs?: number } = {},
) {
  const persistedState = vscode.getState();
  const autosaveDelayMs = options.autosaveDelayMs ?? 350;
  let autoSaveTimer: ReturnType<typeof setTimeout> | undefined;
  let isApplyingEditorState = false;
  let stopDraftWatcher: WatchStopHandle | undefined;

  const state = reactive<ProfileEditorUiState>({
    editorState: undefined,
    selectedProfile: undefined,
    selectedProfileKey: persistedState?.selectedProfileKey,
    selectedSource: undefined,
    draft: undefined,
    screen: persistedState?.screen ?? "home",
    profileMenu: undefined,
    statusText: "",
  });
  syncProfileEditorScreen();

  const isBuiltin = computed(() => state.selectedSource?.scope === "builtin");
  const isReady = computed(
    () => state.editorState !== undefined && state.selectedProfile !== undefined,
  );

  stopDraftWatcher = watch(
    () => state.draft,
    () => {
      if (isApplyingEditorState) {
        return;
      }

      scheduleAutoSave();
    },
    { deep: true, flush: "sync" },
  );

  function requestProfileEditorState(profileKey = state.selectedProfileKey): void {
    if (profileKey === undefined) {
      postMessage({ type: "requestProfileEditorState" });
      return;
    }

    postMessage({ type: "requestProfileEditorState", profileKey });
  }

  function handleHostMessage(message: ToProfileEditorWebviewMessage): void {
    switch (message.type) {
      case "profileEditorState":
        applyEditorState(message.state);
        return;
      case "profileAutoSaved":
        state.selectedProfileKey = message.profileKey;
        persistState();
        setStatusText(`Saved to ${message.filePath}`);
        return;
      case "profileCopied":
        state.screen = "editor";
        state.selectedProfileKey = message.profileKey;
        state.profileMenu = undefined;
        persistState();
        syncProfileEditorScreen();
        setStatusText(`Copied to ${message.filePath}`);
        return;
      case "error":
        setStatusText(message.message);
        return;
      default:
        assertNever(message);
    }
  }

  function selectProfile(profileKey: string): void {
    state.profileMenu = undefined;
    state.selectedProfileKey = profileKey;
    persistState();
    postMessage({ type: "selectProfileForEdit", profileKey });
  }

  function openMonitorProfile(profileKey: string): void {
    selectProfile(profileKey);
    postMessage({ type: "openMonitorForProfile", profileKey });
  }

  function openEditor(profileKey = state.selectedProfileKey): void {
    state.screen = "editor";
    state.profileMenu = undefined;
    persistState();
    syncProfileEditorScreen();

    if (profileKey !== undefined && profileKey !== state.selectedProfileKey) {
      state.selectedProfileKey = profileKey;
      postMessage({ type: "selectProfileForEdit", profileKey });
    }
  }

  function backToHome(): void {
    state.screen = "home";
    state.profileMenu = undefined;
    persistState();
    syncProfileEditorScreen();
  }

  function toggleProfileMenu(profileKey: string): void {
    state.profileMenu = state.profileMenu?.profileKey === profileKey ? undefined : { profileKey };
  }

  function openProfileContextMenu(profileKey: string, x: number, y: number): void {
    state.profileMenu = { profileKey, x, y };
  }

  function closeProfileMenu(): void {
    state.profileMenu = undefined;
  }

  function copyProfile(profileKey: string): void {
    state.profileMenu = undefined;
    postMessage({ type: "copyProfileByKey", profileKey });
  }

  function openProfileJson(profileKey?: string): void {
    state.profileMenu = undefined;

    if (profileKey === undefined) {
      postMessage({ type: "openProfileJson" });
      return;
    }

    postMessage({ type: "openProfileJson", profileKey });
  }

  function replaceDraft(draft: ProfileEditorPatch): void {
    state.draft = draft;
  }

  function scheduleAutoSave(): void {
    if (state.screen !== "editor" || isBuiltin.value) {
      return;
    }

    if (autoSaveTimer !== undefined) {
      clearTimeout(autoSaveTimer);
    }

    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = undefined;
      autoSaveCurrentProfile();
    }, autosaveDelayMs);
  }

  function autoSaveCurrentProfile(): void {
    if (state.selectedProfile === undefined || state.draft === undefined || isBuiltin.value) {
      return;
    }

    try {
      const nextProfile = cloneProfile(applyProfileEditorPatch(state.selectedProfile, state.draft));
      state.selectedProfile = cloneProfile(nextProfile);
      setStatusText("Saving...");
      postMessage({ type: "autoSaveProfile", profile: nextProfile });
    } catch (error) {
      setStatusText(formatError(error));
    }
  }

  function dispose(): void {
    if (autoSaveTimer !== undefined) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = undefined;
    }

    stopDraftWatcher?.();
    stopDraftWatcher = undefined;
  }

  function applyEditorState(editorState: ProfileEditorState): void {
    isApplyingEditorState = true;
    try {
      state.editorState = editorState;
      state.selectedProfile = cloneProfile(editorState.selectedProfile);
      state.selectedProfileKey = editorState.selectedProfileKey;
      state.selectedSource = editorState.selectedSource;
      state.draft = createProfileEditorPatch(editorState.selectedProfile);
      state.statusText = editorState.errors.join("\n");
      persistState();
    } finally {
      isApplyingEditorState = false;
    }
  }

  function setStatusText(text: string): void {
    state.statusText = text;
  }

  function persistState(): void {
    const nextPersistedState: ProfileEditorPersistedState = {
      screen: state.screen,
    };

    if (state.selectedProfileKey !== undefined) {
      nextPersistedState.selectedProfileKey = state.selectedProfileKey;
    }

    vscode.setState(nextPersistedState);
  }

  function syncProfileEditorScreen(): void {
    postMessage({ type: "setProfileEditorScreen", screen: state.screen });
  }

  function postMessage(message: ToProfileEditorMessage): void {
    vscode.postMessage(message);
  }

  return {
    state,
    isBuiltin,
    isReady,
    requestProfileEditorState,
    handleHostMessage,
    selectProfile,
    openMonitorProfile,
    openEditor,
    backToHome,
    toggleProfileMenu,
    openProfileContextMenu,
    closeProfileMenu,
    copyProfile,
    openProfileJson,
    replaceDraft,
    scheduleAutoSave,
    autoSaveCurrentProfile,
    dispose,
  };
}

export type ProfileEditorStore = ReturnType<typeof createProfileEditorStore>;

export const ProfileEditorStoreKey: InjectionKey<ProfileEditorStore> = Symbol("ProfileEditorStore");

export function useProfileEditorStore(): ProfileEditorStore {
  const store = inject(ProfileEditorStoreKey);

  if (store === undefined) {
    throw new Error("ProfileEditorStore was not provided.");
  }

  return store;
}

function cloneProfile(profile: ProfileConfig): ProfileConfig {
  return JSON.parse(JSON.stringify(profile));
}

function assertNever(value: never): never {
  throw new Error(`Unhandled host message: ${JSON.stringify(value)}`);
}
