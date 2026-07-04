import * as vscode from "vscode";
import { beforeEach, describe, expect, test } from "vitest";
import { MonitorPageHost } from "../../src/host/MonitorPageHost";
import { __resetVscodeMock, __vscodeMock } from "../mocks/vscode";

const extensionUri = vscode.Uri.file("/extension");

describe("MonitorPageHost", () => {
  beforeEach(() => {
    __resetVscodeMock();
  });

  test("opens a new webview panel for each command invocation", () => {
    MonitorPageHost.open(extensionUri);
    MonitorPageHost.open(extensionUri);

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

  test("passes the initial profile key to the webview", () => {
    MonitorPageHost.open(extensionUri, {
      initialProfileKey: "workspace:file:///workspace:telemetry",
    });

    expect(__vscodeMock.createdPanels[0]?.webview.html).toContain(
      'data-initial-profile-key="workspace:file:///workspace:telemetry"',
    );
  });
});
