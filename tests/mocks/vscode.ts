import { vi } from "vitest";

interface DisposableLike {
  dispose(): void;
}

interface MockUri {
  fsPath?: string;
  path?: string;
  toString(): string;
}

export interface MockWebviewPanel {
  title: string;
  readonly webview: {
    cspSource: string;
    html: string;
    asWebviewUri: ReturnType<typeof vi.fn>;
    onDidReceiveMessage: ReturnType<typeof vi.fn>;
    postMessage: ReturnType<typeof vi.fn>;
  };
  readonly onDidDispose: ReturnType<typeof vi.fn>;
  readonly reveal: ReturnType<typeof vi.fn>;
}

export interface MockWebviewView {
  readonly webview: MockWebviewPanel["webview"] & {
    options?: unknown;
  };
}

const createdPanels: MockWebviewPanel[] = [];
const registeredWebviewViewProviders: Array<{
  viewType: string;
  provider: unknown;
  options: unknown;
}> = [];

export const window = {
  createWebviewPanel: vi.fn(
    (
      _viewType: string,
      title: string,
      _showOptions: unknown,
      _options: unknown,
    ): MockWebviewPanel => {
      const panel = createMockWebviewPanel(title);
      createdPanels.push(panel);
      return panel;
    },
  ),
  registerWebviewViewProvider: vi.fn((viewType: string, provider: unknown, options?: unknown) => {
    registeredWebviewViewProviders.push({ viewType, provider, options });
    return createDisposable();
  }),
  showQuickPick: vi.fn(),
  showInputBox: vi.fn(),
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showTextDocument: vi.fn(() => Promise.resolve()),
};

export const workspace = {
  isTrusted: true,
  workspaceFolders: undefined as Array<{ uri: MockUri; name?: string }> | undefined,
  openTextDocument: vi.fn((uri: MockUri) => Promise.resolve({ uri })),
};

export const commands = {
  registerCommand: vi.fn(() => createDisposable()),
  executeCommand: vi.fn(() => Promise.resolve()),
};

export const ViewColumn = {
  One: 1,
};

export const ExtensionMode = {
  Production: 1,
  Development: 2,
  Test: 3,
};

export const Uri = {
  file: vi.fn((filePath: string): MockUri => {
    return {
      fsPath: filePath,
      path: filePath,
      toString: () => filePath,
    };
  }),
  joinPath: vi.fn((base: MockUri, ...parts: string[]): MockUri => {
    const path = [formatUri(base), ...parts].join("/");

    return {
      fsPath: path,
      path,
      toString: () => path,
    };
  }),
};

export const __vscodeMock = {
  createdPanels,
  registeredWebviewViewProviders,
  createWebviewPanel: window.createWebviewPanel,
  registerWebviewViewProvider: window.registerWebviewViewProvider,
  showQuickPick: window.showQuickPick,
  showInputBox: window.showInputBox,
  showInformationMessage: window.showInformationMessage,
  showWarningMessage: window.showWarningMessage,
  showTextDocument: window.showTextDocument,
  openTextDocument: workspace.openTextDocument,
  registerCommand: commands.registerCommand,
  executeCommand: commands.executeCommand,
  joinPath: Uri.joinPath,
  file: Uri.file,
};

export function __resetVscodeMock(): void {
  createdPanels.length = 0;
  registeredWebviewViewProviders.length = 0;
  window.createWebviewPanel.mockClear();
  window.registerWebviewViewProvider.mockClear();
  window.showQuickPick.mockReset();
  window.showInputBox.mockReset();
  window.showInformationMessage.mockReset();
  window.showWarningMessage.mockReset();
  window.showTextDocument.mockReset();
  workspace.openTextDocument.mockClear();
  workspace.isTrusted = true;
  workspace.workspaceFolders = undefined;
  commands.registerCommand.mockClear();
  commands.executeCommand.mockClear();
  Uri.joinPath.mockClear();
  Uri.file.mockClear();
}

function createMockWebviewPanel(title: string): MockWebviewPanel {
  return {
    title,
    webview: {
      cspSource: "vscode-webview:",
      html: "",
      asWebviewUri: vi.fn((uri: MockUri) => uri),
      onDidReceiveMessage: vi.fn(
        (
          _listener: (message: unknown) => void,
          _thisArg?: unknown,
          disposables?: DisposableLike[],
        ) => {
          const disposable = createDisposable();
          disposables?.push(disposable);
          return disposable;
        },
      ),
      postMessage: vi.fn(() => Promise.resolve(true)),
    },
    onDidDispose: vi.fn(
      (_listener: () => void, _thisArg?: unknown, disposables?: DisposableLike[]) => {
        const disposable = createDisposable();
        disposables?.push(disposable);
        return disposable;
      },
    ),
    reveal: vi.fn(),
  };
}

function createDisposable(): DisposableLike {
  return {
    dispose: vi.fn(),
  };
}

function formatUri(uri: MockUri): string {
  return uri.path ?? uri.fsPath ?? uri.toString();
}
