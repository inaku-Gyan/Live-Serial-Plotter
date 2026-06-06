import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { getWorkspaceProfilesDirectory, ProfileStore } from "../../src/profiles/ProfileStore";

describe("ProfileStore", () => {
  test("loads builtin and workspace JSONC profiles", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "lsp-profile-workspace-"));
    const profilesDirectory = getWorkspaceProfilesDirectory(workspaceRoot);
    await mkdir(profilesDirectory, { recursive: true });
    await writeFile(
      path.join(profilesDirectory, "sensor.jsonc"),
      `{
        // JSONC comments are supported.
        "schemaVersion": 2,
        "id": "sensor",
        "name": "Sensor",
        "serialDefaults": {
          "baudRate": 9600
        },
        "codec": {
          "kind": "text",
          "encoding": "utf8",
          "sendLineEnding": "lf"
        },
        "framing": {
          "kind": "line",
          "delimiter": "lf",
        },
        "parser": {
          "kind": "builtin",
          "mode": "keyValue",
        },
        "outputs": [
          { "id": "raw", "kind": "terminalAppend", "source": "raw" },
        ],
      }`,
    );

    const store = new ProfileStore({
      workspaceProfilesDirectories: [profilesDirectory],
    });
    const loaded = await store.loadProfiles("sensor");

    expect(loaded.errors).toEqual([]);
    expect(loaded.profiles.map((profile) => profile.summary)).toEqual([
      { id: "default", name: "Default Auto Plot", scope: "builtin" },
      { id: "sensor", name: "Sensor", scope: "workspace" },
    ]);
    expect(loaded.activeProfile.id).toBe("sensor");
    expect(loaded.activeProfileSource).toEqual({
      scope: "workspace",
      filePath: path.join(profilesDirectory, "sensor.jsonc"),
    });
    expect(loaded.activeProfile.serialDefaults?.baudRate).toBe(9600);
    expect(loaded.activeProfile.codec.sendLineEnding).toBe("lf");
  });

  test("collects invalid profile errors without dropping builtin profile", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "lsp-profile-invalid-"));
    const profilesDirectory = getWorkspaceProfilesDirectory(workspaceRoot);
    await mkdir(profilesDirectory, { recursive: true });
    await writeFile(path.join(profilesDirectory, "broken.jsonc"), "{");

    const store = new ProfileStore({
      workspaceProfilesDirectories: [profilesDirectory],
    });
    const loaded = await store.loadProfiles("missing");

    expect(loaded.activeProfile.id).toBe("default");
    expect(loaded.profiles).toHaveLength(1);
    expect(loaded.errors).toHaveLength(1);
    expect(loaded.errors[0]).toContain("broken.jsonc");
  });

  test("rejects old schema profiles", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "lsp-profile-old-schema-"));
    const profilesDirectory = getWorkspaceProfilesDirectory(workspaceRoot);
    await mkdir(profilesDirectory, { recursive: true });
    await writeFile(
      path.join(profilesDirectory, "old.jsonc"),
      `{
        "schemaVersion": 1,
        "id": "old",
        "name": "Old",
        "connection": { "baudRate": 9600 },
        "framing": { "kind": "line", "encoding": "utf8", "delimiter": "lf" },
        "parser": { "kind": "builtin", "mode": "raw" },
        "outputs": [{ "id": "raw", "kind": "terminalAppend" }]
      }`,
    );

    const store = new ProfileStore({
      workspaceProfilesDirectories: [profilesDirectory],
    });
    const loaded = await store.loadProfiles("old");

    expect(loaded.activeProfile.id).toBe("default");
    expect(loaded.profiles).toHaveLength(1);
    expect(loaded.errors[0]).toContain("must use schemaVersion 2");
  });

  test("saves user profiles and can load them again", async () => {
    const userProfilesDirectory = await mkdtemp(path.join(tmpdir(), "lsp-user-profiles-"));
    const store = new ProfileStore({ userProfilesDirectory });

    const saved = await store.saveProfile({
      scope: "user",
      profileId: "saved-user",
      config: {
        schemaVersion: 2,
        id: "draft",
        name: "Saved User",
        serialDefaults: { baudRate: 115200 },
        codec: { kind: "text", encoding: "utf8", sendLineEnding: "none" },
        framing: { kind: "line", delimiter: "auto" },
        parser: { kind: "builtin", mode: "jsonl", options: { flatten: true } },
        outputs: [{ id: "raw", kind: "terminalAppend", source: "raw" }],
        export: { mode: "parsed", format: "csv", includeMetadata: true },
      },
    });

    expect(saved.source).toEqual({
      scope: "user",
      filePath: path.join(userProfilesDirectory, "saved-user.jsonc"),
    });

    const loaded = await store.loadProfiles("saved-user");
    expect(loaded.activeProfile.id).toBe("saved-user");
    expect(loaded.activeProfile.export).toEqual({
      mode: "parsed",
      format: "csv",
      includeMetadata: true,
    });
  });

  test("saves workspace profiles and creates the directory", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "lsp-save-workspace-"));
    const profilesDirectory = getWorkspaceProfilesDirectory(workspaceRoot);
    const store = new ProfileStore({ workspaceProfilesDirectories: [profilesDirectory] });

    await store.saveProfile({
      scope: "workspace",
      profileId: "workspace-profile",
      config: {
        schemaVersion: 2,
        id: "workspace-profile",
        name: "Workspace Profile",
        serialDefaults: { baudRate: 9600 },
        codec: { kind: "text", encoding: "utf8", sendLineEnding: "none" },
        framing: { kind: "line", delimiter: "lf" },
        parser: { kind: "builtin", mode: "keyValue" },
        outputs: [{ id: "raw", kind: "terminalAppend" }],
      },
    });

    const savedText = await readFile(
      path.join(profilesDirectory, "workspace-profile.jsonc"),
      "utf8",
    );
    expect(savedText).toContain('"id": "workspace-profile"');
    expect(savedText).not.toContain('"connection"');
    expect(savedText).not.toContain('"encoding": "utf8",\n    "delimiter"');
  });
});
