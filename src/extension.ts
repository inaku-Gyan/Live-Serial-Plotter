import * as vscode from "vscode";
import { LiveSerialPlotterPanel } from "./panel/LiveSerialPlotterPanel";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("liveSerialPlotter.open", () => {
      LiveSerialPlotterPanel.open(context.extensionUri);
    }),
  );
}

export function deactivate(): void {}
