import * as vscode from "vscode";
import { LiveSerialPlotterPanel } from "./panel/LiveSerialPlotterPanel";
import { DevelopmentSerialPortFactory } from "./serial/dev/DevelopmentSerialPortFactory";
import { NodeSerialPortFactory, type SerialPortFactory } from "./serial/SerialService";

export function activate(context: vscode.ExtensionContext): void {
  const serialPortFactory = createSerialPortFactory(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("liveSerialPlotter.open", () => {
      LiveSerialPlotterPanel.open(context.extensionUri, { serialPortFactory });
    }),
  );
}

export function deactivate(): void {}

export function createSerialPortFactory(context: vscode.ExtensionContext): SerialPortFactory {
  if (context.extensionMode === vscode.ExtensionMode.Production) {
    return new NodeSerialPortFactory();
  }

  return new DevelopmentSerialPortFactory(context.extensionUri.fsPath);
}
