import * as assert from "node:assert/strict";
import * as vscode from "vscode";

suite("Live Serial Plotter extension", () => {
  test("activates", async () => {
    const extension = vscode.extensions.getExtension("inaku.live-serial-plotter");

    assert.ok(extension);
    await extension.activate();
    assert.equal(extension.isActive, true);
  });

  test("registers the open command", async () => {
    const commands = await vscode.commands.getCommands(true);

    assert.ok(commands.includes("liveSerialPlotter.open"));
  });
});
