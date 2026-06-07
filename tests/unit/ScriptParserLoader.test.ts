import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  ScriptParserLoader,
  type ScriptParserTrustRequest,
  type ScriptParserTrustStore,
} from "../../src/parsers/ScriptParserLoader";

class FakeTrustStore implements ScriptParserTrustStore {
  trustedRequests: ScriptParserTrustRequest[] = [];

  constructor(
    private readonly workspaceTrusted: boolean,
    private readonly confirmResult: boolean,
  ) {}

  isWorkspaceTrusted(): boolean {
    return this.workspaceTrusted;
  }

  isTrusted(): boolean {
    return false;
  }

  async confirmTrust(request: ScriptParserTrustRequest): Promise<boolean> {
    this.trustedRequests.push(request);
    return this.confirmResult;
  }
}

describe("ScriptParserLoader", () => {
  test("loads trusted workspace .mjs parsers from the allowed directory", async () => {
    const workspaceRoot = await createWorkspaceParser(
      "parser.mjs",
      `export function createParser(options) {
        return {
          parseFrame(frame) {
            return { fields: { value: Number(frame.raw) * options.scale } };
          },
          reset() {}
        };
      }`,
    );
    const trustStore = new FakeTrustStore(true, true);
    const loader = new ScriptParserLoader({
      workspaceRoots: [workspaceRoot],
      trustStore,
    });

    const parser = await loader.load({
      kind: "script",
      path: "parser.mjs",
      options: { scale: 2 },
    });

    expect(parser.parseFrame({ seq: 1, receivedAt: 100, raw: "21" })).toEqual([
      { fields: { value: 42 } },
    ]);
    expect(trustStore.trustedRequests).toHaveLength(1);
  });

  test("rejects script parsers in untrusted workspaces", async () => {
    const workspaceRoot = await createWorkspaceParser(
      "parser.mjs",
      "export function createParser() { return { parseFrame() { return null; } }; }",
    );
    const loader = new ScriptParserLoader({
      workspaceRoots: [workspaceRoot],
      trustStore: new FakeTrustStore(false, true),
    });

    await expect(loader.load({ kind: "script", path: "parser.mjs" })).rejects.toThrow(
      "trusted workspace",
    );
  });

  test("rejects parser paths outside the allowed parser directory", async () => {
    const workspaceRoot = await createWorkspaceParser(
      "parser.mjs",
      "export function createParser() { return { parseFrame() { return null; } }; }",
    );
    const loader = new ScriptParserLoader({
      workspaceRoots: [workspaceRoot],
      trustStore: new FakeTrustStore(true, true),
    });

    await expect(loader.load({ kind: "script", path: "../parser.mjs" })).rejects.toThrow(
      "inside .live-serial-plotter/parsers",
    );
  });
});

async function createWorkspaceParser(fileName: string, source: string): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "lsp-script-parser-"));
  const parserDirectory = path.join(workspaceRoot, ".live-serial-plotter", "parsers");
  await mkdir(parserDirectory, { recursive: true });
  await writeFile(path.join(parserDirectory, fileName), source);
  return workspaceRoot;
}
