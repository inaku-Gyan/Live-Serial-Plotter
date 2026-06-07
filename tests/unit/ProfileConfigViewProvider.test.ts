import packageJson from "../../package.json";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as vscode from "vscode";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ProfileConfigViewProvider } from "../../src/panel/ProfileConfigViewProvider";
import { defaultProfile } from "../../src/profiles/defaultProfile";
import {
  createProfileKey,
  getWorkspaceProfilesDirectory,
  ProfileStore,
  type WorkspaceProfilesDirectory,
} from "../../src/profiles/ProfileStore";
import type { ToProfileEditorMessage } from "../../src/shared/protocol";
import { __resetVscodeMock, __vscodeMock } from "../mocks/vscode";

describe("ProfileConfigViewProvider", () => {
  beforeEach(() => {
    __resetVscodeMock();
  });

  test("posts initial editor state when the view resolves", async () => {
    const { provider, webviewView } = createProvider();

    provider.resolveWebviewView(webviewView);
    await waitForAsyncWork();

    expect(webviewView.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "profileEditorState",
        state: expect.objectContaining({
          selectedProfile: expect.objectContaining({ id: "default" }),
          selectedProfileKey: "builtin:default",
          selectedSource: expect.objectContaining({ scope: "builtin", key: "builtin:default" }),
        }),
      }),
    );
  });

  test("copies profiles by key to the selected workspace directory", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "lsp-profile-view-"));
    const workspaceDirectory = createWorkspaceDirectory(workspaceRoot, "Firmware");
    const profilesDirectory = workspaceDirectory.profilesDirectory;
    const { provider, webviewView, dispatch } = createProvider({
      workspaceProfilesDirectories: [workspaceDirectory],
    });
    __vscodeMock.showQuickPick.mockResolvedValue({
      label: "Workspace: Firmware",
      scope: "workspace",
      workspaceFolderUri: workspaceDirectory.folderUri,
      workspaceName: workspaceDirectory.folderName,
    });
    __vscodeMock.showInputBox.mockResolvedValue("saved-profile");

    provider.resolveWebviewView(webviewView);
    await waitForAsyncWork();
    webviewView.webview.postMessage.mockClear();
    dispatch({ type: "copyProfileByKey", profileKey: "builtin:jsonl-telemetry" });
    await waitForAsyncWork();

    expect(webviewView.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "profileCopied",
        profileKey: createProfileKey({
          scope: "workspace",
          id: "saved-profile",
          workspaceFolderUri: workspaceDirectory.folderUri,
        }),
        filePath: path.join(profilesDirectory, "saved-profile.jsonc"),
      }),
    );
    await expect(
      readFile(path.join(profilesDirectory, "saved-profile.jsonc"), "utf8"),
    ).resolves.toContain('"name": "JSONL Telemetry"');
  });

  test("auto-saves workspace profiles to their source file", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "lsp-profile-view-autosave-"));
    const workspaceDirectory = createWorkspaceDirectory(workspaceRoot, "Firmware");
    const profilesDirectory = workspaceDirectory.profilesDirectory;
    await mkdir(profilesDirectory, { recursive: true });
    await writeFile(
      path.join(profilesDirectory, "editable.jsonc"),
      `${JSON.stringify({ ...defaultProfile, id: "editable", name: "Editable" }, null, 2)}\n`,
      "utf8",
    );
    const profileKey = createProfileKey({
      scope: "workspace",
      id: "editable",
      workspaceFolderUri: workspaceDirectory.folderUri,
    });
    const { provider, webviewView, dispatch } = createProvider({
      workspaceProfilesDirectories: [workspaceDirectory],
    });

    provider.resolveWebviewView(webviewView);
    await waitForAsyncWork();
    dispatch({ type: "selectProfileForEdit", profileKey });
    await waitForAsyncWork();
    webviewView.webview.postMessage.mockClear();
    dispatch({
      type: "autoSaveProfile",
      profile: { ...defaultProfile, id: "editable", name: "Auto Saved" },
    });
    await waitForAsyncWork();

    expect(webviewView.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "profileAutoSaved",
        profileKey,
        filePath: path.join(profilesDirectory, "editable.jsonc"),
      }),
    );
  });

  test("shows native warnings for missing profile keys", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "lsp-profile-view-invalid-"));
    const workspaceDirectory = createWorkspaceDirectory(workspaceRoot, "Invalid");
    const { provider, webviewView, dispatch } = createProvider({
      workspaceProfilesDirectories: [workspaceDirectory],
    });
    __vscodeMock.showQuickPick.mockResolvedValue({
      label: "Workspace: Invalid",
      scope: "workspace",
      workspaceFolderUri: workspaceDirectory.folderUri,
      workspaceName: workspaceDirectory.folderName,
    });
    __vscodeMock.showInputBox.mockResolvedValue("invalid-profile");

    provider.resolveWebviewView(webviewView);
    await waitForAsyncWork();
    webviewView.webview.postMessage.mockClear();
    dispatch({
      type: "copyProfileByKey",
      profileKey: "builtin:missing",
    });
    await waitForAsyncWork();

    expect(__vscodeMock.showWarningMessage).toHaveBeenCalledWith(
      'Profile "builtin:missing" was not found.',
    );
    expect(webviewView.webview.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "error" }),
    );
  });

  test("shows native warnings when copied profile ids already exist", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "lsp-profile-view-duplicate-"));
    const workspaceDirectory = createWorkspaceDirectory(workspaceRoot, "workspace");
    const profilesDirectory = workspaceDirectory.profilesDirectory;
    await mkdir(profilesDirectory, { recursive: true });
    await writeFile(
      path.join(profilesDirectory, "default.jsonc"),
      `${JSON.stringify(defaultProfile, null, 2)}\n`,
      "utf8",
    );
    const { provider, webviewView, dispatch } = createProvider({
      workspaceProfilesDirectories: [workspaceDirectory],
    });
    __vscodeMock.showQuickPick.mockResolvedValue({
      label: "Workspace: workspace",
      scope: "workspace",
      workspaceFolderUri: workspaceDirectory.folderUri,
      workspaceName: workspaceDirectory.folderName,
    });
    __vscodeMock.showInputBox.mockResolvedValue("default");

    provider.resolveWebviewView(webviewView);
    await waitForAsyncWork();
    webviewView.webview.postMessage.mockClear();
    dispatch({ type: "copyProfileByKey", profileKey: "builtin:default" });
    await waitForAsyncWork();

    expect(__vscodeMock.showWarningMessage).toHaveBeenCalledWith(
      'Profile "default" already exists in Workspace: workspace.',
    );
    expect(webviewView.webview.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "error" }),
    );
  });

  test("opens workspace profile JSONC by key", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "lsp-profile-view-open-"));
    const workspaceDirectory = createWorkspaceDirectory(workspaceRoot, "Firmware");
    const profilesDirectory = workspaceDirectory.profilesDirectory;
    await mkdir(profilesDirectory, { recursive: true });
    const filePath = path.join(profilesDirectory, "editable.jsonc");
    await writeFile(
      filePath,
      `${JSON.stringify({ ...defaultProfile, id: "editable", name: "Editable" }, null, 2)}\n`,
      "utf8",
    );
    const profileKey = createProfileKey({
      scope: "workspace",
      id: "editable",
      workspaceFolderUri: workspaceDirectory.folderUri,
    });
    const { provider, webviewView, dispatch } = createProvider({
      workspaceProfilesDirectories: [workspaceDirectory],
    });

    provider.resolveWebviewView(webviewView);
    await waitForAsyncWork();
    dispatch({ type: "openProfileJson", profileKey });
    await waitForAsyncWork();

    expect(__vscodeMock.file).toHaveBeenCalledWith(filePath);
    expect(__vscodeMock.openTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: filePath }),
    );
    expect(__vscodeMock.showTextDocument).toHaveBeenCalled();
  });

  test("asks users to copy builtin profiles before opening JSONC", async () => {
    const { provider } = createProvider();

    await provider.openProfileJson();

    expect(__vscodeMock.showInformationMessage).toHaveBeenCalledWith(
      "Copy this profile before opening its JSONC file.",
    );
  });

  test("asks users to copy keyed builtin profiles before opening JSONC", async () => {
    const { provider, webviewView, dispatch } = createProvider();

    provider.resolveWebviewView(webviewView);
    await waitForAsyncWork();
    dispatch({ type: "openProfileJson", profileKey: "builtin:jsonl-telemetry" });
    await waitForAsyncWork();

    expect(__vscodeMock.showInformationMessage).toHaveBeenCalledWith(
      "Copy this profile before opening its JSONC file.",
    );
  });

  test("updates profile editor view context", async () => {
    const { provider, webviewView, dispatch } = createProvider();

    provider.resolveWebviewView(webviewView);
    await waitForAsyncWork();
    dispatch({ type: "setProfileEditorView", view: "editor" });
    await waitForAsyncWork();

    expect(__vscodeMock.executeCommand).toHaveBeenCalledWith(
      "setContext",
      "liveSerialPlotter.profileEditorView",
      "editor",
    );
  });

  test("contributes refresh and editor-only open jsonc to the view title", () => {
    const viewTitleMenu = packageJson.contributes.menus["view/title"] ?? [];

    expect(viewTitleMenu).toEqual([
      {
        command: "liveSerialPlotter.profiles.openJson",
        when: "view == liveSerialPlotter.profiles && liveSerialPlotter.profileEditorView == editor",
        group: "navigation@1",
      },
      {
        command: "liveSerialPlotter.profiles.refresh",
        when: "view == liveSerialPlotter.profiles",
        group: "navigation@2",
      },
    ]);
  });
});

interface CreateProviderOptions {
  readonly workspaceProfilesDirectories?: readonly WorkspaceProfilesDirectory[];
}

function createProvider(options: CreateProviderOptions = {}): {
  provider: ProfileConfigViewProvider;
  webviewView: MockWebviewView;
  dispatch: (message: ToProfileEditorMessage) => void;
} {
  let listener: ((message: ToProfileEditorMessage) => void) | undefined;
  const webviewView = {
    webview: {
      cspSource: "vscode-webview:",
      html: "",
      options: undefined,
      asWebviewUri: vi.fn<(uri: vscode.Uri) => vscode.Uri>((uri: vscode.Uri) => uri),
      postMessage: vi.fn<(message: unknown) => Promise<boolean>>(() => Promise.resolve(true)),
      onDidReceiveMessage: vi.fn<
        (nextListener: (message: ToProfileEditorMessage) => void) => { dispose(): void }
      >((nextListener: (message: ToProfileEditorMessage) => void) => {
        listener = nextListener;
        return { dispose: vi.fn<() => void>() };
      }),
    },
  } satisfies MockWebviewView;
  const provider = new ProfileConfigViewProvider({
    extensionUri: vscode.Uri.file("/extension"),
    profileStore: new ProfileStore(options),
  });

  return {
    provider,
    webviewView,
    dispatch: (message) => {
      if (listener === undefined) {
        throw new Error("No webview message listener was registered.");
      }

      listener(message);
    },
  };
}

interface MockWebviewView {
  webview: {
    cspSource: string;
    html: string;
    options: unknown;
    asWebviewUri: (uri: vscode.Uri) => vscode.Uri;
    postMessage: ReturnType<typeof vi.fn<(message: unknown) => Promise<boolean>>>;
    onDidReceiveMessage: (nextListener: (message: ToProfileEditorMessage) => void) => {
      dispose(): void;
    };
  };
}

async function waitForAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

function createWorkspaceDirectory(
  workspaceRoot: string,
  folderName: string,
): WorkspaceProfilesDirectory {
  return {
    folderUri: `file://${workspaceRoot}`,
    folderName,
    profilesDirectory: getWorkspaceProfilesDirectory(workspaceRoot),
  };
}
