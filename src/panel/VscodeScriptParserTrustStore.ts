import * as vscode from "vscode";
import type {
  ScriptParserTrustRequest,
  ScriptParserTrustStore,
} from "../parsers/ScriptParserLoader";

const trustKeyPrefix = "trustedScriptParser";
const trustButton = "Run Parser";

export class VscodeScriptParserTrustStore implements ScriptParserTrustStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  isWorkspaceTrusted(): boolean {
    return vscode.workspace.isTrusted;
  }

  isTrusted(request: ScriptParserTrustRequest): boolean {
    return this.context.globalState.get<boolean>(getTrustKey(request)) === true;
  }

  async confirmTrust(request: ScriptParserTrustRequest): Promise<boolean> {
    const selection = await vscode.window.showWarningMessage(
      `Run script parser ${request.filePath}? Script parsers execute local code and are not sandboxed.`,
      { modal: true },
      trustButton,
    );

    if (selection !== trustButton) {
      return false;
    }

    await this.context.globalState.update(getTrustKey(request), true);
    return true;
  }
}

function getTrustKey(request: ScriptParserTrustRequest): string {
  return `${trustKeyPrefix}:${request.filePath}:${request.hash}`;
}
