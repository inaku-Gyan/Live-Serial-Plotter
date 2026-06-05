import * as vscode from 'vscode';
import { PointBatcher } from '../session/PointBatcher';
import { RingBuffer } from '../session/RingBuffer';
import { SerialService } from '../serial/SerialService';
import {
  isParserMode,
  type ConnectionState,
  type PlotSample,
  type ToExtensionMessage,
} from '../shared/protocol';

const panelViewType = 'liveSerialPlotter.panel';

export class LiveSerialPlotterPanel {
  private static readonly activePanels = new Set<LiveSerialPlotterPanel>();
  private static nextPanelId = 1;

  private readonly disposables: vscode.Disposable[] = [];
  private readonly rawLines = new RingBuffer<string>(500);
  private readonly samples = new RingBuffer<PlotSample>(5_000);
  private readonly pointBatcher = new PointBatcher(50, (samples) => {
    this.postMessage({ type: 'seriesAppend', samples });
  });

  private readonly serialService = new SerialService({
    onConnectionState: (state) => {
      this.updatePanelTitle(state);
      this.postMessage({ type: 'connectionState', state });
    },
    onRawLine: (line, t) => {
      this.rawLines.push(line);
      this.postMessage({ type: 'rawLine', line, t });
    },
    onSample: (sample) => {
      this.samples.push(sample);
      this.pointBatcher.add(sample);
    },
    onError: (message) => this.postError(message),
  });

  static open(extensionUri: vscode.Uri): void {
    const title = `Live Serial Plotter #${LiveSerialPlotterPanel.nextPanelId}`;
    LiveSerialPlotterPanel.nextPanelId += 1;

    const panel = vscode.window.createWebviewPanel(panelViewType, title, vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')],
    });

    const plotterPanel = new LiveSerialPlotterPanel(panel, extensionUri, title);
    LiveSerialPlotterPanel.activePanels.add(plotterPanel);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly defaultTitle: string,
  ) {
    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: ToExtensionMessage) => {
        void this.handleMessage(message);
      },
      undefined,
      this.disposables,
    );
  }

  private async handleMessage(message: ToExtensionMessage): Promise<void> {
    try {
      if (message.type === 'requestPorts') {
        await this.postPorts();
        return;
      }

      if (message.type === 'connect') {
        await this.serialService.connect(message.settings);
        return;
      }

      if (message.type === 'disconnect') {
        await this.serialService.disconnect();
        return;
      }

      if (message.type === 'send') {
        await this.serialService.send(message.text);
        return;
      }

      if (message.type === 'setParserMode' && isParserMode(message.parserMode)) {
        this.serialService.setParserMode(message.parserMode);
        return;
      }

      if (message.type === 'clearLog') {
        this.rawLines.clear();
      }
    } catch (error) {
      this.postError(formatError(error));
    }
  }

  private async postPorts(): Promise<void> {
    const ports = await this.serialService.listPorts();
    this.postMessage({ type: 'ports', ports });
  }

  private postError(message: string): void {
    this.postMessage({ type: 'error', message });
  }

  private postMessage(message: Parameters<vscode.Webview['postMessage']>[0]): void {
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
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'assets', 'index.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'assets', 'index.css'),
    );

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link nonce="${nonce}" href="${styleUri}" rel="stylesheet">
    <title>Live Serial Plotter</title>
  </head>
  <body>
    <div id="app"></div>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
  </body>
</html>`;
  }

  private dispose(): void {
    LiveSerialPlotterPanel.activePanels.delete(this);
    this.pointBatcher.dispose();
    this.serialService.dispose();

    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';

  for (let index = 0; index < 32; index += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return nonce;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
