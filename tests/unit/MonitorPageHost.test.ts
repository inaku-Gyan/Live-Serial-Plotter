import { EventEmitter } from "node:events";
import * as vscode from "vscode";
import { beforeEach, describe, expect, test } from "vitest";
import { MonitorPageHost } from "../../src/host/MonitorPageHost";
import type { SerialPortFactory, SerialPortLike } from "../../src/serial/SerialService";
import type {
  ConnectionSettings,
  SerialPortSummary,
  ToExtensionMessage,
  ToWebviewMessage,
} from "../../src/shared/protocol";
import { __resetVscodeMock, __vscodeMock, type MockWebviewPanel } from "../mocks/vscode";

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

  test("routes ports, connection state, errors, and batched output", async () => {
    const port = new HostTestSerialPort();
    const factory = new HostTestSerialPortFactory(port, [
      { path: "/dev/ROBOT", manufacturer: "Test Devices" },
    ]);

    MonitorPageHost.open(extensionUri, { serialPortFactory: factory });

    const panel = getCreatedPanel();
    const defaultTitle = panel.title;
    const dispatch = getMessageHandler(panel);
    await waitForAsyncWork();
    panel.webview.postMessage.mockClear();

    dispatch({ type: "requestPorts" });
    await waitForAsyncWork();

    expect(getPostedMessages(panel)).toContainEqual({
      type: "ports",
      ports: [{ path: "/dev/ROBOT", manufacturer: "Test Devices" }],
    });

    panel.webview.postMessage.mockClear();
    dispatch({
      type: "connect",
      settings: { path: "/dev/ROBOT", baudRate: 115200, parserMode: "auto" },
    });
    await waitForAsyncWork();

    expect(getPostedMessages(panel)).toContainEqual({
      type: "connectionState",
      state: { connected: true, path: "/dev/ROBOT", baudRate: 115200 },
    });
    expect(panel.title).toBe("Live Serial Plotter: /dev/ROBOT");

    port.emitData("temp=21\nrpm=1.5\n");
    await waitForAsyncWork(75);

    const outputPackets = getPostedMessages(panel)
      .filter((message): message is Extract<ToWebviewMessage, { type: "outputPacket" }> => {
        return message.type === "outputPacket";
      })
      .map((message) => message.packet);
    const terminalPacket = outputPackets.find((packet) => packet.kind === "terminalAppend");
    const timeSeriesPacket = outputPackets.find((packet) => packet.kind === "timeSeriesAppend");

    expect(terminalPacket).toMatchObject({
      kind: "terminalAppend",
      outputId: "raw",
      lines: [{ text: "temp=21" }, { text: "rpm=1.5" }],
    });
    expect(timeSeriesPacket).toMatchObject({
      kind: "timeSeriesAppend",
      outputId: "plot",
      samples: [{ values: { temp: 21 } }, { values: { rpm: 1.5 } }],
    });

    port.emit("error", new Error("read failed"));
    await waitForAsyncWork();
    expect(getPostedMessages(panel)).toContainEqual({ type: "error", message: "read failed" });

    panel.webview.postMessage.mockClear();
    dispatch({ type: "disconnect" });
    await waitForAsyncWork();

    expect(getPostedMessages(panel)).toContainEqual({
      type: "connectionState",
      state: { connected: false },
    });
    expect(panel.title).toBe(defaultTitle);
    expect(port.listenerCount("data")).toBe(0);
    expect(port.listenerCount("error")).toBe(0);
    expect(port.listenerCount("close")).toBe(0);

    getDisposeHandler(panel)();
    await waitForAsyncWork();
  });

  test("reports failed connections and removes failed port listeners", async () => {
    const port = new HostTestSerialPort(new Error("open failed"));
    const factory = new HostTestSerialPortFactory(port, []);

    MonitorPageHost.open(extensionUri, { serialPortFactory: factory });

    const panel = getCreatedPanel();
    const dispatch = getMessageHandler(panel);
    await waitForAsyncWork();
    panel.webview.postMessage.mockClear();

    dispatch({
      type: "connect",
      settings: { path: "/dev/FAIL", baudRate: 115200, parserMode: "raw" },
    });
    await waitForAsyncWork();

    expect(getPostedMessages(panel)).toContainEqual({ type: "error", message: "open failed" });
    expect(panel.title).toMatch(/^Live Serial Plotter #\d+$/);
    expect(port.listenerCount("data")).toBe(0);
    expect(port.listenerCount("error")).toBe(0);
    expect(port.listenerCount("close")).toBe(0);

    getDisposeHandler(panel)();
    await waitForAsyncWork();
  });
});

class HostTestSerialPort extends EventEmitter implements SerialPortLike {
  private openState = false;

  constructor(private readonly openError?: Error) {
    super();
  }

  get isOpen(): boolean {
    return this.openState;
  }

  open(callback: (error: Error | null | undefined) => void): void {
    if (this.openError !== undefined) {
      callback(this.openError);
      return;
    }

    this.openState = true;
    callback(null);
  }

  close(callback: (error: Error | null | undefined) => void): void {
    this.openState = false;
    callback(null);
  }

  write(_data: string | Buffer, callback: (error: Error | null | undefined) => void): void {
    callback(null);
  }

  emitData(data: string): void {
    this.emit("data", Buffer.from(data));
  }
}

class HostTestSerialPortFactory implements SerialPortFactory {
  constructor(
    private readonly port: HostTestSerialPort,
    private readonly summaries: SerialPortSummary[],
  ) {}

  async list(): Promise<SerialPortSummary[]> {
    return this.summaries;
  }

  create(_settings: ConnectionSettings): SerialPortLike {
    return this.port;
  }
}

function getCreatedPanel(): MockWebviewPanel {
  const panel = __vscodeMock.createdPanels.at(-1);

  if (panel === undefined) {
    throw new Error("No webview panel was created.");
  }

  return panel;
}

function getMessageHandler(panel: MockWebviewPanel): (message: ToExtensionMessage) => void {
  const handler: unknown = panel.webview.onDidReceiveMessage.mock.calls[0]?.[0];

  if (!isMessageHandler(handler)) {
    throw new Error("No webview message handler was registered.");
  }

  return handler;
}

function getDisposeHandler(panel: MockWebviewPanel): () => void {
  const handler: unknown = panel.onDidDispose.mock.calls[0]?.[0];

  if (!isDisposeHandler(handler)) {
    throw new Error("No panel dispose handler was registered.");
  }

  return handler;
}

function getPostedMessages(panel: MockWebviewPanel): ToWebviewMessage[] {
  return panel.webview.postMessage.mock.calls.map((call: unknown[]) => {
    const message: unknown = call[0];

    if (!isToWebviewMessage(message)) {
      throw new Error("Unexpected Webview message.");
    }

    return message;
  });
}

function isMessageHandler(value: unknown): value is (message: ToExtensionMessage) => void {
  return typeof value === "function";
}

function isDisposeHandler(value: unknown): value is () => void {
  return typeof value === "function";
}

function isToWebviewMessage(value: unknown): value is ToWebviewMessage {
  return (
    typeof value === "object" && value !== null && "type" in value && typeof value.type === "string"
  );
}

async function waitForAsyncWork(delayMs = 25): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
