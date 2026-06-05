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

const createdPanels: MockWebviewPanel[] = [];

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
};

export const ViewColumn = {
  One: 1,
};

export const Uri = {
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
  createWebviewPanel: window.createWebviewPanel,
  joinPath: Uri.joinPath,
};

export function __resetVscodeMock(): void {
  createdPanels.length = 0;
  window.createWebviewPanel.mockClear();
  Uri.joinPath.mockClear();
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
