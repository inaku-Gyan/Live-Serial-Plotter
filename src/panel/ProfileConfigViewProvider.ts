import * as vscode from "vscode";
import { defaultProfile } from "../profiles/defaultProfile";
import { ProfileStore } from "../profiles/ProfileStore";
import type {
  ProfileEditorState,
  ProfileSourceMetadata,
  ToProfileEditorMessage,
  ToProfileEditorWebviewMessage,
} from "../shared/protocol";

const saveTargetUser = "User profiles";
const saveTargetWorkspace = "Workspace profiles";

export interface ProfileConfigViewProviderOptions {
  readonly extensionUri: vscode.Uri;
  readonly profileStore: ProfileStore;
}

export class ProfileConfigViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "liveSerialPlotter.profiles";

  private webviewView: vscode.WebviewView | undefined;
  private selectedProfileId = defaultProfile.id;
  private selectedSource: ProfileSourceMetadata = { scope: "builtin" };

  constructor(private readonly options: ProfileConfigViewProviderOptions) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.options.extensionUri, "dist", "webview")],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message: ToProfileEditorMessage) => {
      void this.handleMessage(message);
    });
    void this.postEditorState();
  }

  async refreshProfiles(): Promise<void> {
    await this.postEditorState();
  }

  requestSaveProfile(): void {
    this.postMessage({ type: "requestSaveProfile" });
  }

  async openProfileJson(): Promise<void> {
    if (this.selectedSource.filePath === undefined) {
      await vscode.window.showInformationMessage(
        "Save this profile before opening its JSONC file.",
      );
      return;
    }

    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(this.selectedSource.filePath),
    );
    await vscode.window.showTextDocument(document);
  }

  private async handleMessage(message: ToProfileEditorMessage): Promise<void> {
    try {
      if (message.type === "requestProfileEditorState") {
        await this.postEditorState(message.profileId ?? this.selectedProfileId);
        return;
      }

      if (message.type === "selectProfileForEdit") {
        await this.postEditorState(message.profileId);
        return;
      }

      if (message.type === "saveProfile") {
        await this.saveProfile(message.profile);
        return;
      }

      if (message.type === "openProfileJson") {
        await this.openProfileJson();
      }
    } catch (error) {
      this.postMessage({ type: "error", message: formatError(error) });
    }
  }

  private async postEditorState(profileId = this.selectedProfileId): Promise<void> {
    const loadedProfiles = await this.options.profileStore.loadProfiles(profileId);
    this.selectedProfileId = loadedProfiles.activeProfile.id;
    this.selectedSource = loadedProfiles.activeProfileSource;
    this.postMessage({
      type: "profileEditorState",
      state: {
        profiles: loadedProfiles.profiles.map((profile) => profile.summary),
        selectedProfile: loadedProfiles.activeProfile,
        selectedSource: loadedProfiles.activeProfileSource,
        errors: loadedProfiles.errors,
      },
    });
  }

  private async saveProfile(profile: ProfileEditorState["selectedProfile"]): Promise<void> {
    const scope = await this.pickSaveScope();

    if (scope === undefined) {
      return;
    }

    const profileId = await vscode.window.showInputBox({
      title: "Save Profile As",
      prompt: "Profile id",
      value: profile.id,
      validateInput: (value) =>
        /^[A-Za-z0-9_.-]+$/.test(value)
          ? undefined
          : "Use letters, numbers, dot, dash, or underscore.",
    });

    if (profileId === undefined) {
      return;
    }

    const savedProfile = await this.options.profileStore.saveProfile({
      config: profile,
      profileId,
      scope,
    });
    this.selectedProfileId = savedProfile.config.id;
    this.selectedSource = savedProfile.source;
    this.postMessage({
      type: "profileSaved",
      profileId: savedProfile.config.id,
      filePath: savedProfile.source.filePath,
    });
    await this.postEditorState(savedProfile.config.id);
  }

  private async pickSaveScope(): Promise<"user" | "workspace" | undefined> {
    const items: Array<{ label: string; scope: "user" | "workspace" }> = [
      { label: saveTargetUser, scope: "user" },
    ];

    if (
      vscode.workspace.workspaceFolders !== undefined &&
      vscode.workspace.workspaceFolders.length > 0
    ) {
      items.push({ label: saveTargetWorkspace, scope: "workspace" });
    }

    const selected = await vscode.window.showQuickPick(items, {
      title: "Save Profile",
      placeHolder: "Choose where to save the profile",
    });

    return selected?.scope;
  }

  private postMessage(message: ToProfileEditorWebviewMessage): void {
    void this.webviewView?.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const profileStyleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.options.extensionUri, "dist", "webview", "assets", "profile.css"),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.options.extensionUri, "dist", "webview", "assets", "profile.js"),
    );

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link nonce="${nonce}" href="${profileStyleUri}" rel="stylesheet">
    <title>Live Serial Plotter Profiles</title>
  </head>
  <body>
    <div id="profileApp"></div>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";

  for (let index = 0; index < 32; index += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return nonce;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
