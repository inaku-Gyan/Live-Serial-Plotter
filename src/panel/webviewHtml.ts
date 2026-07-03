import * as vscode from "vscode";

export interface WebviewHtmlOptions {
  webview: Pick<vscode.Webview, "cspSource" | "asWebviewUri">;
  extensionUri: vscode.Uri;
  /** Bundled entry base name under dist/webview/assets, e.g. "index" or "profile". */
  entry: string;
  /** Id of the mount element the webview app attaches to. */
  rootId: string;
  title: string;
  /** Optional `data-*` attributes rendered on the body element (values are escaped). */
  bodyDataset?: Record<string, string>;
}

export function buildWebviewHtml(options: WebviewHtmlOptions): string {
  const { webview, extensionUri, entry, rootId, title, bodyDataset } = options;
  const nonce = getNonce();
  const scriptUri = String(
    webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "dist", "webview", "assets", `${entry}.js`),
    ),
  );
  const styleUri = String(
    webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "dist", "webview", "assets", `${entry}.css`),
    ),
  );
  const datasetAttributes = formatBodyDataset(bodyDataset);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link nonce="${nonce}" href="${styleUri}" rel="stylesheet">
    <title>${title}</title>
  </head>
  <body${datasetAttributes}>
    <div id="${rootId}"></div>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
  </body>
</html>`;
}

function formatBodyDataset(dataset: Record<string, string> | undefined): string {
  if (dataset === undefined) {
    return "";
  }

  return Object.entries(dataset)
    .map(([key, value]) => ` data-${key}="${escapeHtmlAttribute(value)}"`)
    .join("");
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";

  for (let index = 0; index < 32; index += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return nonce;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
