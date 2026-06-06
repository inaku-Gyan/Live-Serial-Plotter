import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
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
        "schemaVersion": 1,
        "id": "sensor",
        "name": "Sensor",
        "connection": {
          "baudRate": 9600,
        },
        "framing": {
          "kind": "line",
          "encoding": "utf8",
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
    expect(loaded.activeProfile.connection.baudRate).toBe(9600);
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
});
