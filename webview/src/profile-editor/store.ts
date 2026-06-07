import { computed, reactive, watch, type WatchStopHandle } from "vue";
import type {
  ProfileConfig,
  ProfileEditorState,
  ProfileSourceMetadata,
  ToProfileEditorMessage,
  ToProfileEditorWebviewMessage,
} from "../../../src/shared/protocol";
import {
  applyProfileEditorPatch,
  createProfileEditorPatch,
  type ProfileEditorPatch,
} from "../profileEditorModel";

export type ProfileEditorView = "home" | "editor";

export interface ProfileEditorPersistedState {
  selectedProfileKey?: string;
  view?: ProfileEditorView;
}

export interface VsCodeApi<State> {
  getState(): State | undefined;
  setState(state: State): void;
  postMessage(message: ToProfileEditorMessage): void;
}

interface ProfileEditorUiState {
  editorState: ProfileEditorState | undefined;
  selectedProfile: ProfileConfig | undefined;
  selectedProfileKey: string | undefined;
  selectedSource: ProfileSourceMetadata | undefined;
  draft: ProfileEditorPatch | undefined;
  view: ProfileEditorView;
  openMenuProfileKey: string | undefined;
  statusText: string;
}

export function createProfileEditorStore(
  vscode: VsCodeApi<ProfileEditorPersistedState>,
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
    view: persistedState?.view ?? "home",
    openMenuProfileKey: undefined,
    statusText: "",
  });
  syncProfileEditorView();

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
    postMessage({ type: "requestProfileEditorState", profileKey });
  }

  function handleHostMessage(message: ToProfileEditorWebviewMessage): void {
    if (message.type === "profileEditorState") {
      applyEditorState(message.state);
      return;
    }

    if (message.type === "profileAutoSaved") {
      state.selectedProfileKey = message.profileKey;
      persistState();
      setStatusText(`Saved to ${message.filePath}`);
      return;
    }

    if (message.type === "profileCopied") {
      state.view = "editor";
      state.selectedProfileKey = message.profileKey;
      state.openMenuProfileKey = undefined;
      persistState();
      syncProfileEditorView();
      setStatusText(`Copied to ${message.filePath}`);
      return;
    }

    setStatusText(message.message);
  }

  function selectProfile(profileKey: string): void {
    state.openMenuProfileKey = undefined;
    state.selectedProfileKey = profileKey;
    persistState();
    postMessage({ type: "selectProfileForEdit", profileKey });
  }

  function openEditor(profileKey = state.selectedProfileKey): void {
    state.view = "editor";
    state.openMenuProfileKey = undefined;
    persistState();
    syncProfileEditorView();

    if (profileKey !== undefined && profileKey !== state.selectedProfileKey) {
      state.selectedProfileKey = profileKey;
      postMessage({ type: "selectProfileForEdit", profileKey });
    }
  }

  function backToHome(): void {
    state.view = "home";
    state.openMenuProfileKey = undefined;
    persistState();
    syncProfileEditorView();
  }

  function toggleProfileMenu(profileKey: string): void {
    state.openMenuProfileKey = state.openMenuProfileKey === profileKey ? undefined : profileKey;
  }

  function closeProfileMenu(): void {
    state.openMenuProfileKey = undefined;
  }

  function copyProfile(profileKey: string): void {
    state.openMenuProfileKey = undefined;
    postMessage({ type: "copyProfileByKey", profileKey });
  }

  function openProfileJson(profileKey?: string): void {
    state.openMenuProfileKey = undefined;
    postMessage({ type: "openProfileJson", profileKey });
  }

  function replaceDraft(draft: ProfileEditorPatch): void {
    state.draft = draft;
  }

  function scheduleAutoSave(): void {
    if (state.view !== "editor" || isBuiltin.value) {
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
      const nextProfile = applyProfileEditorPatch(state.selectedProfile, state.draft);
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
    vscode.setState({
      selectedProfileKey: state.selectedProfileKey,
      view: state.view,
    });
  }

  function syncProfileEditorView(): void {
    postMessage({ type: "setProfileEditorView", view: state.view });
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
    openEditor,
    backToHome,
    toggleProfileMenu,
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

function cloneProfile(profile: ProfileConfig): ProfileConfig {
  return JSON.parse(JSON.stringify(profile)) as ProfileConfig;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
