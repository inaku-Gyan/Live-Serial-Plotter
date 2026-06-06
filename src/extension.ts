import * as vscode from "vscode";
import { LiveSerialPlotterPanel } from "./panel/LiveSerialPlotterPanel";
import { getWorkspaceProfilesDirectory, ProfileStore } from "./profiles/ProfileStore";
import { DevelopmentSerialPortFactory } from "./serial/dev/DevelopmentSerialPortFactory";
import { NodeSerialPortFactory, type SerialPortFactory } from "./serial/SerialService";

export function activate(context: vscode.ExtensionContext): void {
  const serialPortFactory = createSerialPortFactory(context);
  const profileStore = createProfileStore(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("liveSerialPlotter.open", () => {
      LiveSerialPlotterPanel.open(context.extensionUri, { serialPortFactory, profileStore });
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

export function createProfileStore(context: vscode.ExtensionContext): ProfileStore {
  return new ProfileStore({
    userProfilesDirectory: vscode.Uri.joinPath(context.globalStorageUri, "profiles").fsPath,
    workspaceProfilesDirectories:
      vscode.workspace.workspaceFolders?.map((folder) =>
        getWorkspaceProfilesDirectory(folder.uri.fsPath),
      ) ?? [],
  });
}
