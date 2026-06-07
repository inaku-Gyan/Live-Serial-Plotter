import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import packageJson from "../../package.json";
import { builtinProfiles, defaultProfile } from "../../src/profiles/defaultProfile";
import {
  createProfileKey,
  getWorkspaceProfilesDirectory,
  normalizeProfileConfig,
  profileSchemaUri,
  ProfileStore,
  type WorkspaceProfilesDirectory,
} from "../../src/profiles/ProfileStore";

const execFileAsync = promisify(execFile);

describe("ProfileStore", () => {
  test("loads builtin and workspace JSONC profiles", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "lsp-profile-workspace-"));
    const workspaceDirectory = createWorkspaceDirectory(workspaceRoot, "Firmware");
    const profilesDirectory = workspaceDirectory.profilesDirectory;
    await mkdir(profilesDirectory, { recursive: true });
    await writeFile(
      path.join(profilesDirectory, "sensor.jsonc"),
      `{
        // JSONC comments are supported.
        "$schema": "${profileSchemaUri}",
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
      workspaceProfilesDirectories: [workspaceDirectory],
    });
    const sensorKey = createProfileKey({
      scope: "workspace",
      id: "sensor",
      workspaceFolderUri: workspaceDirectory.folderUri,
    });
    const loaded = await store.loadProfiles(sensorKey);

    expect(loaded.errors).toEqual([]);
    expect(loaded.profiles[0]?.summary).toEqual({
      key: sensorKey,
      ref: {
        scope: "workspace",
        id: "sensor",
        workspaceFolderUri: workspaceDirectory.folderUri,
      },
      id: "sensor",
      name: "Sensor",
      scope: "workspace",
      workspaceName: "Firmware",
    });
    expect(loaded.profiles.slice(1).map((profile) => profile.summary.key)).toEqual(
      builtinProfiles.map((profile) => `builtin:${profile.id}`),
    );
    expect(loaded.activeProfile.id).toBe("sensor");
    expect(loaded.activeProfileKey).toBe(sensorKey);
    expect(loaded.activeProfileSource).toEqual({
      key: sensorKey,
      ref: {
        scope: "workspace",
        id: "sensor",
        workspaceFolderUri: workspaceDirectory.folderUri,
      },
      scope: "workspace",
      filePath: path.join(profilesDirectory, "sensor.jsonc"),
      workspaceFolderUri: workspaceDirectory.folderUri,
      workspaceName: "Firmware",
    });
    expect(loaded.activeProfile.serialDefaults?.baudRate).toBe(9600);
    expect(loaded.activeProfile.codec.sendLineEnding).toBe("lf");
  });

  test("normalizes profiles with a JSON schema association", () => {
    const normalized = normalizeProfileConfig({
      $schema: profileSchemaUri,
      ...defaultProfile,
      id: "schema-profile",
      name: "Schema Profile",
    });

    expect(normalized).toEqual({
      ...defaultProfile,
      id: "schema-profile",
      name: "Schema Profile",
    });
    expect("$schema" in normalized).toBe(false);
  });

  test("collects invalid profile errors without dropping builtin profile", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "lsp-profile-invalid-"));
    const profilesDirectory = getWorkspaceProfilesDirectory(workspaceRoot);
    await mkdir(profilesDirectory, { recursive: true });
    await writeFile(path.join(profilesDirectory, "broken.jsonc"), "{");

    const store = new ProfileStore({
      workspaceProfilesDirectories: [
        {
          folderUri: `file://${workspaceRoot}`,
          folderName: "Broken",
          profilesDirectory,
        },
      ],
    });
    const loaded = await store.loadProfiles("missing");

    expect(loaded.activeProfile.id).toBe("default");
    expect(loaded.profiles).toHaveLength(builtinProfiles.length);
    expect(loaded.errors).toHaveLength(1);
    expect(loaded.errors[0]).toContain("broken.jsonc");
  });

  test("keeps same id profiles in separate namespaces", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "lsp-profile-namespaces-"));
    const workspaceDirectory = createWorkspaceDirectory(workspaceRoot, "Firmware");
    const userProfilesDirectory = await mkdtemp(path.join(tmpdir(), "lsp-user-namespace-"));
    await mkdir(workspaceDirectory.profilesDirectory, { recursive: true });
    await mkdir(userProfilesDirectory, { recursive: true });
    await writeProfile(workspaceDirectory.profilesDirectory, "default", "Workspace Default");
    await writeProfile(userProfilesDirectory, "default", "User Default");

    const store = new ProfileStore({
      userProfilesDirectory,
      workspaceProfilesDirectories: [workspaceDirectory],
    });
    const loaded = await store.loadProfiles();

    expect(loaded.activeProfileKey).toBe("builtin:default");
    expect(loaded.profiles.map((profile) => profile.summary.key)).toEqual([
      createProfileKey({
        scope: "workspace",
        id: "default",
        workspaceFolderUri: workspaceDirectory.folderUri,
      }),
      "user:default",
      ...builtinProfiles.map((profile) => `builtin:${profile.id}`),
    ]);
  });

  test("keeps same id profiles in separate workspace namespaces", async () => {
    const firmwareRoot = await mkdtemp(path.join(tmpdir(), "lsp-profile-firmware-"));
    const dashboardRoot = await mkdtemp(path.join(tmpdir(), "lsp-profile-dashboard-"));
    const firmwareDirectory = createWorkspaceDirectory(firmwareRoot, "Firmware");
    const dashboardDirectory = createWorkspaceDirectory(dashboardRoot, "Dashboard");
    await mkdir(firmwareDirectory.profilesDirectory, { recursive: true });
    await mkdir(dashboardDirectory.profilesDirectory, { recursive: true });
    await writeProfile(firmwareDirectory.profilesDirectory, "sensor", "Firmware Sensor");
    await writeProfile(dashboardDirectory.profilesDirectory, "sensor", "Dashboard Sensor");

    const store = new ProfileStore({
      workspaceProfilesDirectories: [firmwareDirectory, dashboardDirectory],
    });
    const loaded = await store.loadProfiles();

    expect(loaded.profiles.map((profile) => profile.summary)).toEqual([
      expect.objectContaining({
        key: createProfileKey({
          scope: "workspace",
          id: "sensor",
          workspaceFolderUri: firmwareDirectory.folderUri,
        }),
        id: "sensor",
        workspaceName: "Firmware",
      }),
      expect.objectContaining({
        key: createProfileKey({
          scope: "workspace",
          id: "sensor",
          workspaceFolderUri: dashboardDirectory.folderUri,
        }),
        id: "sensor",
        workspaceName: "Dashboard",
      }),
      ...builtinProfiles.map((profile) =>
        expect.objectContaining({ key: `builtin:${profile.id}` }),
      ),
    ]);
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
      workspaceProfilesDirectories: [
        {
          folderUri: `file://${workspaceRoot}`,
          folderName: "Old",
          profilesDirectory,
        },
      ],
    });
    const loaded = await store.loadProfiles("old");

    expect(loaded.activeProfile.id).toBe("default");
    expect(loaded.profiles).toHaveLength(builtinProfiles.length);
    expect(loaded.errors[0]).toContain("must use schemaVersion 2");
  });

  test("saves user profiles and can load them again", async () => {
    const userProfilesDirectory = await mkdtemp(path.join(tmpdir(), "lsp-user-profiles-"));
    const store = new ProfileStore({ userProfilesDirectory });

    const saved = await store.saveProfile({
      target: { label: "User", scope: "user" },
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
      key: "user:saved-user",
      ref: { scope: "user", id: "saved-user" },
      scope: "user",
      filePath: path.join(userProfilesDirectory, "saved-user.jsonc"),
      workspaceFolderUri: undefined,
      workspaceName: undefined,
    });

    const savedText = await readFile(path.join(userProfilesDirectory, "saved-user.jsonc"), "utf8");
    expect(savedText.startsWith(`{\n  "$schema": "${profileSchemaUri}",\n`)).toBe(true);

    const loaded = await store.loadProfiles("user:saved-user");
    expect(loaded.activeProfile.id).toBe("saved-user");
    expect(loaded.activeProfile.export).toEqual({
      mode: "parsed",
      format: "csv",
      includeMetadata: true,
    });
  });

  test("saves workspace profiles and creates the directory", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "lsp-save-workspace-"));
    const workspaceDirectory = createWorkspaceDirectory(workspaceRoot, "Workspace");
    const profilesDirectory = workspaceDirectory.profilesDirectory;
    const store = new ProfileStore({ workspaceProfilesDirectories: [workspaceDirectory] });

    await store.saveProfile({
      target: {
        label: "Workspace: Workspace",
        scope: "workspace",
        workspaceFolderUri: workspaceDirectory.folderUri,
        workspaceName: workspaceDirectory.folderName,
      },
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
    expect(savedText.startsWith(`{\n  "$schema": "${profileSchemaUri}",\n`)).toBe(true);
    expect(savedText).toContain('"id": "workspace-profile"');
    expect(savedText).not.toContain('"connection"');
    expect(savedText).not.toContain('"encoding": "utf8",\n    "delimiter"');
  });

  test("does not overwrite copied profiles in the same namespace", async () => {
    const userProfilesDirectory = await mkdtemp(path.join(tmpdir(), "lsp-user-copy-exists-"));
    const store = new ProfileStore({ userProfilesDirectory });
    const request = {
      target: { label: "User", scope: "user" as const },
      profileId: "copy",
      config: defaultProfile,
    };

    await store.saveProfile(request);

    await expect(store.saveProfile(request)).rejects.toThrow(
      'Profile "copy" already exists in User.',
    );
  });

  test("rejects auto-saving builtin profiles", async () => {
    const store = new ProfileStore();

    await expect(
      store.autoSaveProfile({
        config: defaultProfile,
        source: {
          key: "builtin:default",
          ref: { scope: "builtin", id: "default" },
          scope: "builtin",
        },
      }),
    ).rejects.toThrow("Builtin profiles cannot be auto-saved");
  });
});

describe("profile JSON schema contribution", () => {
  test("registers profile JSONC validation in the extension manifest", () => {
    expect(packageJson.contributes.jsonValidation).toEqual([
      {
        fileMatch: "**/.live-serial-plotter/profiles/*.jsonc",
        url: "./schemas/profile.schema.json",
      },
    ]);
    expect(packageJson.scripts["schema:generate"]).toBe("node scripts/generate-profile-schema.mjs");
    expect(packageJson.scripts["schema:check"]).toBe(
      "node scripts/generate-profile-schema.mjs --check",
    );
  });

  test("ships a schema with the expected id", async () => {
    const schemaText = await readFile(
      path.join(import.meta.dirname, "../../schemas/profile.schema.json"),
      "utf8",
    );
    const schema: unknown = JSON.parse(schemaText);

    expect(isRecord(schema) ? schema.$id : undefined).toBe(profileSchemaUri);
  });

  test("keeps the generated profile schema up to date", async () => {
    await expect(
      execFileAsync(
        process.execPath,
        [path.join(import.meta.dirname, "../../scripts/generate-profile-schema.mjs"), "--check"],
        { cwd: path.join(import.meta.dirname, "../..") },
      ),
    ).resolves.toBeDefined();
  }, 10_000);
});

function createWorkspaceDirectory(
  workspaceRoot: string,
  folderName: string,
): WorkspaceProfilesDirectory {
  return {
    folderUri: `file://${workspaceRoot}`,
    folderName,
    profilesDirectory: getWorkspaceProfilesDirectory(workspaceRoot),
  };
}

async function writeProfile(directory: string, id: string, name: string): Promise<void> {
  await writeFile(
    path.join(directory, `${id}.jsonc`),
    `${JSON.stringify({ ...defaultProfile, id, name }, null, 2)}\n`,
    "utf8",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
