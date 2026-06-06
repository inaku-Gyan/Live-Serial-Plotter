import * as vscode from "vscode";
import { ProfileStore, type ProfileCopyTarget } from "../profiles/ProfileStore";
import type {
  ProfileConfig,
  ProfileEditorState,
  ProfileSourceMetadata,
  ToProfileEditorMessage,
  ToProfileEditorWebviewMessage,
} from "../shared/protocol";

export interface ProfileConfigViewProviderOptions {
  readonly extensionUri: vscode.Uri;
  readonly profileStore: ProfileStore;
}

export class ProfileConfigViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "liveSerialPlotter.profiles";

  private webviewView: vscode.WebviewView | undefined;
  private selectedProfileKey: string | undefined;
  private selectedSource: ProfileSourceMetadata | undefined;

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

  async openProfileJson(profileKey?: string): Promise<void> {
    const source =
      profileKey === undefined
        ? this.selectedSource
        : (await this.loadProfileByKey(profileKey)).source;

    if (source?.filePath === undefined) {
      await vscode.window.showInformationMessage(
        "Copy this profile before opening its JSONC file.",
      );
      return;
    }

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(source.filePath));
    await vscode.window.showTextDocument(document);
  }

  private async handleMessage(message: ToProfileEditorMessage): Promise<void> {
    try {
      if (message.type === "requestProfileEditorState") {
        await this.postEditorState(message.profileKey ?? this.selectedProfileKey);
        return;
      }

      if (message.type === "selectProfileForEdit") {
        await this.postEditorState(message.profileKey);
        return;
      }

      if (message.type === "autoSaveProfile") {
        await this.autoSaveProfile(message.profile);
        return;
      }

      if (message.type === "copyProfileByKey") {
        const { profile } = await this.loadProfileByKey(message.profileKey);
        await this.copyProfile(profile);
        return;
      }

      if (message.type === "openProfileJson") {
        await this.openProfileJson(message.profileKey);
      }
    } catch (error) {
      this.postMessage({ type: "error", message: formatError(error) });
    }
  }

  private async postEditorState(profileKey = this.selectedProfileKey): Promise<void> {
    const loadedProfiles = await this.options.profileStore.loadProfiles(profileKey);
    this.selectedProfileKey = loadedProfiles.activeProfileKey;
    this.selectedSource = loadedProfiles.activeProfileSource;
    this.postMessage({
      type: "profileEditorState",
      state: {
        profiles: loadedProfiles.profiles.map((profile) => profile.summary),
        selectedProfile: loadedProfiles.activeProfile,
        selectedProfileKey: loadedProfiles.activeProfileKey,
        selectedSource: loadedProfiles.activeProfileSource,
        errors: loadedProfiles.errors,
      },
    });
  }

  private async autoSaveProfile(profile: ProfileEditorState["selectedProfile"]): Promise<void> {
    if (this.selectedSource === undefined) {
      throw new Error("No profile is selected.");
    }

    const savedProfile = await this.options.profileStore.autoSaveProfile({
      config: profile,
      source: this.selectedSource,
    });
    this.selectedProfileKey = savedProfile.source.key;
    this.selectedSource = savedProfile.source;
    this.postMessage({
      type: "profileAutoSaved",
      profileKey: savedProfile.source.key,
      filePath: savedProfile.source.filePath,
    });
  }

  private async copyProfile(profile: ProfileConfig): Promise<void> {
    const target = await this.pickCopyTarget();

    if (target === undefined) {
      return;
    }

    const profileId = await vscode.window.showInputBox({
      title: "Copy Profile",
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
      target,
    });
    this.selectedProfileKey = savedProfile.source.key;
    this.selectedSource = savedProfile.source;
    this.postMessage({
      type: "profileCopied",
      profileKey: savedProfile.source.key,
      filePath: savedProfile.source.filePath,
    });
    await this.postEditorState(savedProfile.source.key);
  }

  private async loadProfileByKey(
    profileKey: string,
  ): Promise<{ profile: ProfileConfig; source: ProfileSourceMetadata }> {
    const loadedProfiles = await this.options.profileStore.loadProfiles(profileKey);

    if (loadedProfiles.activeProfileKey !== profileKey) {
      throw new Error(`Profile "${profileKey}" was not found.`);
    }

    return {
      profile: loadedProfiles.activeProfile,
      source: loadedProfiles.activeProfileSource,
    };
  }

  private async pickCopyTarget(): Promise<ProfileCopyTarget | undefined> {
    const items = this.options.profileStore.getCopyTargets();

    if (items.length === 0) {
      await vscode.window.showInformationMessage("No profile copy target is configured.");
      return undefined;
    }

    const selected = await vscode.window.showQuickPick(items, {
      title: "Copy Profile",
      placeHolder: "Choose where to copy the profile",
    });

    return selected;
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
