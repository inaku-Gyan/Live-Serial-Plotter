import * as vscode from "vscode";
import type { AsyncScriptParserLoader } from "../pipeline/PipelineRunner";
import { LayoutStore } from "../profiles/LayoutStore";
import { ProfileStore } from "../profiles/ProfileStore";
import { SerialService, type SerialPortFactory } from "../serial/SerialService";
import { OutputPacketBatcher } from "../session/OutputPacketBatcher";
import {
  isParserMode,
  type ConnectionState,
  type ProfileConfig,
  type ToExtensionMessage,
} from "../shared/protocol";

const panelViewType = "liveSerialPlotter.panel";

export interface LiveSerialPlotterPanelOptions {
  readonly serialPortFactory?: SerialPortFactory;
  readonly profileStore?: ProfileStore;
  readonly layoutStore?: LayoutStore;
  readonly scriptParserLoader?: AsyncScriptParserLoader;
  readonly initialProfileKey?: string;
}

export class LiveSerialPlotterPanel {
  private static readonly activePanels = new Set<LiveSerialPlotterPanel>();
  private static nextPanelId = 1;

  private readonly disposables: vscode.Disposable[] = [];
  private readonly serialService: SerialService;
  private readonly profileStore: ProfileStore;
  private readonly layoutStore: LayoutStore;
  private readonly outputPacketBatcher = new OutputPacketBatcher(50, (packet) => {
    this.postMessage({ type: "outputPacket", packet });
  });
  private activeProfileKey: string | undefined;

  static open(extensionUri: vscode.Uri, options: LiveSerialPlotterPanelOptions = {}): void {
    const title = `Live Serial Plotter #${LiveSerialPlotterPanel.nextPanelId}`;
    LiveSerialPlotterPanel.nextPanelId += 1;

    const panel = vscode.window.createWebviewPanel(panelViewType, title, vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist", "webview")],
    });

    const plotterPanel = new LiveSerialPlotterPanel(panel, extensionUri, title, options);
    LiveSerialPlotterPanel.activePanels.add(plotterPanel);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly defaultTitle: string,
    options: LiveSerialPlotterPanelOptions,
  ) {
    this.profileStore = options.profileStore ?? new ProfileStore();
    this.layoutStore = options.layoutStore ?? new LayoutStore();
    this.activeProfileKey = options.initialProfileKey;
    this.serialService = new SerialService(
      {
        onConnectionState: (state) => {
          this.updatePanelTitle(state);
          this.postMessage({ type: "connectionState", state });
        },
        onOutputPacket: (packet) => this.outputPacketBatcher.add(packet),
        onError: (message) => this.postError(message),
      },
      options.serialPortFactory,
      { scriptParserLoader: options.scriptParserLoader },
    );

    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: ToExtensionMessage) => {
        void this.handleMessage(message);
      },
      undefined,
      this.disposables,
    );

    void this.postProfiles(this.activeProfileKey);
  }

  private async handleMessage(message: ToExtensionMessage): Promise<void> {
    try {
      if (message.type === "requestPorts") {
        await this.postPorts();
        return;
      }

      if (message.type === "requestProfiles") {
        await this.postProfiles(message.profileKey ?? this.activeProfileKey);
        return;
      }

      if (message.type === "selectProfile") {
        await this.selectProfile(message.profileKey);
        return;
      }

      if (message.type === "connect") {
        await this.serialService.connect(message.settings);
        return;
      }

      if (message.type === "disconnect") {
        await this.serialService.disconnect();
        return;
      }

      if (message.type === "send") {
        await this.serialService.send(message.text);
        return;
      }

      if (message.type === "setParserMode" && isParserMode(message.parserMode)) {
        this.serialService.setParserMode(message.parserMode);
        return;
      }

      if (message.type === "saveLayout") {
        const saved = await this.layoutStore.saveLayout(
          message.request.layoutKey,
          message.request.layout,
        );
        this.postMessage({
          type: "layoutSaved",
          layout: saved.layout,
          layoutKey: saved.layoutKey,
        });
        return;
      }

      if (message.type === "saveLayoutAs") {
        const savedLayout = await this.layoutStore.saveLayoutAs(message.request);
        const updatedProfile = await this.updateProfileLayoutPreset(
          message.request.profileKey,
          savedLayout.layoutKey,
        );
        this.postMessage({
          type: "layoutSavedAs",
          layout: savedLayout.layout,
          layoutKey: savedLayout.layoutKey,
          profile: updatedProfile,
        });
        return;
      }

      if (message.type === "clearLog") {
        return;
      }
    } catch (error) {
      this.postError(formatError(error));
    }
  }

  private async postPorts(): Promise<void> {
    const ports = await this.serialService.listPorts();
    this.postMessage({ type: "ports", ports });
  }

  private postError(message: string): void {
    this.postMessage({ type: "error", message });
  }

  private async postProfiles(activeProfileKey: string | undefined): Promise<void> {
    const loadedProfiles = await this.profileStore.loadProfiles(activeProfileKey);
    const resolvedLayout = await this.layoutStore.resolveLayout(
      loadedProfiles.activeProfile.layout.defaultPreset,
    );
    this.activeProfileKey = loadedProfiles.activeProfileKey;
    this.serialService.setProfile(loadedProfiles.activeProfile);
    this.postMessage({
      type: "profiles",
      profiles: loadedProfiles.profiles.map((profile) => profile.summary),
      activeProfile: loadedProfiles.activeProfile,
      activeProfileKey: loadedProfiles.activeProfileKey,
      activeLayout: resolvedLayout.layout,
      activeLayoutKey: resolvedLayout.layoutKey,
      layouts: resolvedLayout.layouts.map((layout) => layout.summary),
      layoutTargets: resolvedLayout.layoutTargets,
    });

    for (const error of [...loadedProfiles.errors, ...resolvedLayout.errors]) {
      this.postError(error);
    }
  }

  private async selectProfile(profileKey: string): Promise<void> {
    const loadedProfiles = await this.profileStore.loadProfiles(profileKey);
    const resolvedLayout = await this.layoutStore.resolveLayout(
      loadedProfiles.activeProfile.layout.defaultPreset,
    );
    this.activeProfileKey = loadedProfiles.activeProfileKey;
    this.serialService.setProfile(loadedProfiles.activeProfile);
    this.postMessage({
      type: "activeProfile",
      profile: loadedProfiles.activeProfile,
      profileKey: loadedProfiles.activeProfileKey,
      layout: resolvedLayout.layout,
      layoutKey: resolvedLayout.layoutKey,
    });

    for (const error of [...loadedProfiles.errors, ...resolvedLayout.errors]) {
      this.postError(error);
    }
  }

  private async updateProfileLayoutPreset(
    profileKey: string,
    layoutKey: string,
  ): Promise<ProfileConfig> {
    const loadedProfiles = await this.profileStore.loadProfiles(profileKey);
    const profile = {
      ...loadedProfiles.activeProfile,
      layout: {
        ...loadedProfiles.activeProfile.layout,
        defaultPreset: layoutKey,
      },
    };
    const saved = await this.profileStore.autoSaveProfile({
      config: profile,
      source: loadedProfiles.activeProfileSource,
    });

    return saved.config;
  }

  private postMessage(message: Parameters<vscode.Webview["postMessage"]>[0]): void {
    void this.panel.webview.postMessage(message);
  }

  private updatePanelTitle(state: ConnectionState): void {
    this.panel.title =
      state.connected && state.path !== undefined
        ? `Live Serial Plotter: ${state.path}`
        : this.defaultTitle;
  }

  private getHtml(): string {
    const webview = this.panel.webview;
    const nonce = getNonce();
    const scriptUri = String(
      webview.asWebviewUri(
        vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "assets", "index.js"),
      ),
    );
    const styleUri = String(
      webview.asWebviewUri(
        vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "assets", "index.css"),
      ),
    );

    const initialProfileKey = escapeHtmlAttribute(this.activeProfileKey ?? "");

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link nonce="${nonce}" href="${styleUri}" rel="stylesheet">
    <title>Live Serial Plotter</title>
  </head>
  <body data-initial-profile-key="${initialProfileKey}">
    <div id="app"></div>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
  </body>
</html>`;
  }

  private dispose(): void {
    LiveSerialPlotterPanel.activePanels.delete(this);
    this.outputPacketBatcher.dispose();
    this.serialService.dispose();

    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
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

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
