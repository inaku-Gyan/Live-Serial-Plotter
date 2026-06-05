import type * as vscode from 'vscode';
import { beforeEach, describe, expect, test } from 'vitest';
import { LiveSerialPlotterPanel } from '../../src/panel/LiveSerialPlotterPanel';
import { __resetVscodeMock, __vscodeMock } from '../mocks/vscode';

const extensionUri = {
  fsPath: '/extension',
  path: '/extension',
  toString: () => '/extension',
};

describe('LiveSerialPlotterPanel', () => {
  beforeEach(() => {
    __resetVscodeMock();
  });

  test('opens a new webview panel for each command invocation', () => {
    LiveSerialPlotterPanel.open(extensionUri as unknown as vscode.Uri);
    LiveSerialPlotterPanel.open(extensionUri as unknown as vscode.Uri);

    expect(__vscodeMock.createWebviewPanel).toHaveBeenCalledTimes(2);
    expect(__vscodeMock.createdPanels).toHaveLength(2);

    const firstTitle = __vscodeMock.createWebviewPanel.mock.calls[0]?.[1];
    const secondTitle = __vscodeMock.createWebviewPanel.mock.calls[1]?.[1];

    expect(firstTitle).toMatch(/^Live Serial Plotter #\d+$/);
    expect(secondTitle).toMatch(/^Live Serial Plotter #\d+$/);
    expect(firstTitle).not.toBe(secondTitle);

    for (const panel of __vscodeMock.createdPanels) {
      expect(panel.reveal).not.toHaveBeenCalled();
    }
  });
});
