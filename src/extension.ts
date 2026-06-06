import * as vscode from "vscode";
import { LiveSerialPlotterPanel } from "./panel/LiveSerialPlotterPanel";
import { ProfileConfigViewProvider } from "./panel/ProfileConfigViewProvider";
import { VscodeScriptParserTrustStore } from "./panel/VscodeScriptParserTrustStore";
import { ScriptParserLoader } from "./parsers/ScriptParserLoader";
import { getWorkspaceProfilesDirectory, ProfileStore } from "./profiles/ProfileStore";
import { DevelopmentSerialPortFactory } from "./serial/dev/DevelopmentSerialPortFactory";
import { NodeSerialPortFactory, type SerialPortFactory } from "./serial/SerialService";

export function activate(context: vscode.ExtensionContext): void {
  const serialPortFactory = createSerialPortFactory(context);
  const profileStore = createProfileStore(context);
  const scriptParserLoader = createScriptParserLoader(context);
  const profileConfigViewProvider = new ProfileConfigViewProvider({
    extensionUri: context.extensionUri,
    profileStore,
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ProfileConfigViewProvider.viewType,
      profileConfigViewProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.commands.registerCommand("liveSerialPlotter.open", () => {
      LiveSerialPlotterPanel.open(context.extensionUri, {
        serialPortFactory,
        profileStore,
        scriptParserLoader,
      });
    }),
    vscode.commands.registerCommand("liveSerialPlotter.profiles.refresh", () =>
      profileConfigViewProvider.refreshProfiles(),
    ),
    vscode.commands.registerCommand("liveSerialPlotter.profiles.saveAs", () =>
      profileConfigViewProvider.requestSaveProfile(),
    ),
    vscode.commands.registerCommand("liveSerialPlotter.profiles.openJson", () =>
      profileConfigViewProvider.openProfileJson(),
    ),
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

export function createScriptParserLoader(context: vscode.ExtensionContext): ScriptParserLoader {
  return new ScriptParserLoader({
    workspaceRoots: vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [],
    trustStore: new VscodeScriptParserTrustStore(context),
  });
}
