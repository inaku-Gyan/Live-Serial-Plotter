import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type * as vscode from "vscode";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ProfileConfigViewProvider } from "../../src/panel/ProfileConfigViewProvider";
import { defaultProfile } from "../../src/profiles/defaultProfile";
import { getWorkspaceProfilesDirectory, ProfileStore } from "../../src/profiles/ProfileStore";
import type { ToProfileEditorMessage } from "../../src/shared/protocol";
import { __resetVscodeMock, __vscodeMock } from "../mocks/vscode";

describe("ProfileConfigViewProvider", () => {
  beforeEach(() => {
    __resetVscodeMock();
  });

  test("posts initial editor state when the view resolves", async () => {
    const { provider, webviewView } = createProvider();

    provider.resolveWebviewView(webviewView as unknown as vscode.WebviewView);
    await waitForAsyncWork();

    expect(webviewView.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "profileEditorState",
        state: expect.objectContaining({
          selectedProfile: expect.objectContaining({ id: "default" }),
          selectedSource: { scope: "builtin" },
        }),
      }),
    );
  });

  test("saves profiles to the selected workspace directory", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "lsp-profile-view-"));
    const profilesDirectory = getWorkspaceProfilesDirectory(workspaceRoot);
    const { provider, webviewView, dispatch } = createProvider({
      workspaceProfilesDirectories: [profilesDirectory],
    });
    __vscodeMock.showQuickPick.mockResolvedValue({
      label: "Workspace profiles",
      scope: "workspace",
    });
    __vscodeMock.showInputBox.mockResolvedValue("saved-profile");

    provider.resolveWebviewView(webviewView as unknown as vscode.WebviewView);
    await waitForAsyncWork();
    webviewView.webview.postMessage.mockClear();
    dispatch({ type: "saveProfile", profile: { ...defaultProfile, name: "Saved Profile" } });
    await waitForAsyncWork();

    expect(webviewView.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "profileSaved",
        profileId: "saved-profile",
        filePath: path.join(profilesDirectory, "saved-profile.jsonc"),
      }),
    );
  });

  test("reports save errors for invalid profiles", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "lsp-profile-view-invalid-"));
    const profilesDirectory = getWorkspaceProfilesDirectory(workspaceRoot);
    const { provider, webviewView, dispatch } = createProvider({
      workspaceProfilesDirectories: [profilesDirectory],
    });
    __vscodeMock.showQuickPick.mockResolvedValue({
      label: "Workspace profiles",
      scope: "workspace",
    });
    __vscodeMock.showInputBox.mockResolvedValue("invalid-profile");

    provider.resolveWebviewView(webviewView as unknown as vscode.WebviewView);
    await waitForAsyncWork();
    webviewView.webview.postMessage.mockClear();
    dispatch({
      type: "saveProfile",
      profile: { ...defaultProfile, schemaVersion: 1 as 2 },
    });
    await waitForAsyncWork();

    expect(webviewView.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        message: expect.stringContaining("schemaVersion 2"),
      }),
    );
  });

  test("asks users to save builtin profiles before opening JSONC", async () => {
    const { provider } = createProvider();

    await provider.openProfileJson();

    expect(__vscodeMock.showInformationMessage).toHaveBeenCalledWith(
      "Save this profile before opening its JSONC file.",
    );
  });
});

interface CreateProviderOptions {
  readonly workspaceProfilesDirectories?: readonly string[];
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
      asWebviewUri: vi.fn((uri: unknown) => uri),
      postMessage: vi.fn(() => Promise.resolve(true)),
      onDidReceiveMessage: vi.fn((nextListener: (message: ToProfileEditorMessage) => void) => {
        listener = nextListener;
        return { dispose: vi.fn() };
      }),
    },
  } satisfies MockWebviewView;
  const provider = new ProfileConfigViewProvider({
    extensionUri: {
      fsPath: "/extension",
      path: "/extension",
      toString: () => "/extension",
    } as unknown as vscode.Uri,
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
    asWebviewUri: ReturnType<typeof vi.fn>;
    postMessage: ReturnType<typeof vi.fn>;
    onDidReceiveMessage: ReturnType<typeof vi.fn>;
  };
}

async function waitForAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}
