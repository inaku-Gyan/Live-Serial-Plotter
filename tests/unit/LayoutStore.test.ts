import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { defaultLayout } from "../../src/profiles/defaultLayout";
import {
  createLayoutKey,
  getWorkspaceLayoutsDirectory,
  LayoutStore,
  normalizeLayoutConfig,
  type WorkspaceLayoutsDirectory,
} from "../../src/profiles/LayoutStore";
import type { LayoutConfig } from "../../src/shared/protocol";

describe("LayoutStore", () => {
  test("loads builtin and workspace JSONC layouts", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "lsp-layout-workspace-"));
    const workspaceDirectory = createWorkspaceDirectory(workspaceRoot, "Firmware");
    await mkdir(workspaceDirectory.layoutsDirectory, { recursive: true });
    await writeFile(
      path.join(workspaceDirectory.layoutsDirectory, "wide.jsonc"),
      `{
        // JSONC comments are supported.
        "schemaVersion": 1,
        "id": "wide",
        "name": "Wide",
        "page": { "mode": "grid", "columns": "two" },
        "outputs": {
          "plot": { "panel": { "order": 1, "columnSpan": 2, "minHeight": 360 } }
        }
      }`,
    );

    const store = new LayoutStore({
      workspaceLayoutsDirectories: [workspaceDirectory],
    });
    const layoutKey = createLayoutKey({
      scope: "workspace",
      id: "wide",
      workspaceFolderUri: workspaceDirectory.folderUri,
    });
    const resolved = await store.resolveLayout(layoutKey);

    expect(resolved.errors).toEqual([]);
    expect(resolved.layoutKey).toBe(layoutKey);
    expect(resolved.layout.id).toBe("wide");
    expect(resolved.layouts.map((layout) => layout.summary.key)).toEqual([
      layoutKey,
      "builtin:default",
    ]);
  });

  test("normalizes layout defaults and view state", () => {
    const normalized = normalizeLayoutConfig({
      schemaVersion: 1,
      id: "custom",
      name: "Custom",
      page: { mode: "grid", columns: "single", density: "compact" },
      outputs: {
        plot: {
          panel: { order: 2, columnSpan: 2, minHeight: 400, collapsed: false },
          view: {
            kind: "timeSeriesLine",
            showLegend: false,
            autoFollow: false,
            followMode: "locked",
            zoom: { x: { min: 10, max: 20 } },
          },
        },
      },
    });

    expect(normalized.outputs.plot).toEqual({
      panel: { order: 2, columnSpan: 2, minHeight: 400, collapsed: false },
      view: {
        kind: "timeSeriesLine",
        showLegend: false,
        autoFollow: false,
        followMode: "locked",
        zoom: { x: { min: 10, max: 20 }, y: undefined },
      },
    });
  });

  test("saves and reloads user layouts", async () => {
    const userLayoutsDirectory = await mkdtemp(path.join(tmpdir(), "lsp-user-layouts-"));
    const store = new LayoutStore({ userLayoutsDirectory });
    const saved = await store.saveLayoutAs({
      target: { label: "User", scope: "user" },
      layoutId: "saved",
      layout: createLayout({ id: "draft", name: "Draft" }),
    });

    expect(saved.layoutKey).toBe("user:saved");
    expect(saved.source.filePath).toBe(path.join(userLayoutsDirectory, "saved.jsonc"));

    const savedText = await readFile(saved.source.filePath, "utf8");
    expect(savedText).toContain('"schemaVersion": 1');

    const reloaded = await store.resolveLayout("user:saved");
    expect(reloaded.layout.name).toBe("Draft");
  });

  test("overwrites existing non-builtin layouts with Save", async () => {
    const userLayoutsDirectory = await mkdtemp(path.join(tmpdir(), "lsp-save-layout-"));
    const store = new LayoutStore({ userLayoutsDirectory });
    const saved = await store.saveLayoutAs({
      target: { label: "User", scope: "user" },
      layoutId: "saved",
      layout: createLayout({ id: "draft", name: "Draft" }),
    });

    await store.saveLayout(saved.layoutKey, createLayout({ id: "ignored", name: "Updated" }));

    const reloaded = await store.resolveLayout(saved.layoutKey);
    expect(reloaded.layout).toEqual(createLayout({ id: "saved", name: "Updated" }));
  });

  test("does not overwrite builtin layouts", async () => {
    const store = new LayoutStore();

    await expect(store.saveLayout("builtin:default", defaultLayout)).rejects.toThrow(
      "Builtin layouts cannot be overwritten",
    );
  });
});

function createWorkspaceDirectory(
  workspaceRoot: string,
  folderName: string,
): WorkspaceLayoutsDirectory {
  return {
    folderUri: `file://${workspaceRoot}`,
    folderName,
    layoutsDirectory: getWorkspaceLayoutsDirectory(workspaceRoot),
  };
}

function createLayout(overrides: Partial<LayoutConfig> = {}): LayoutConfig {
  return {
    schemaVersion: 1,
    id: "layout",
    name: "Layout",
    page: { mode: "grid", columns: "auto", density: "normal" },
    outputs: {},
    ...overrides,
  };
}
