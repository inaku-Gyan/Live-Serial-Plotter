import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultProfile } from "./defaultProfile";
import { parseJsonc } from "./jsonc";
import {
  isParserMode,
  type JsonObject,
  type OutputConfig,
  type ParserConfig,
  type ProfileConfig,
  type ProfileSummary,
} from "../shared/protocol";

export interface LoadedProfile {
  summary: ProfileSummary;
  config: ProfileConfig;
  source: ProfileSource;
}

export interface ProfileSource {
  scope: ProfileSummary["scope"];
  filePath?: string;
}

export interface LoadedProfiles {
  profiles: LoadedProfile[];
  activeProfile: ProfileConfig;
  activeProfileSource: ProfileSource;
  errors: string[];
}

export interface SaveProfileRequest {
  config: ProfileConfig;
  profileId: string;
  scope: "user" | "workspace";
  workspaceIndex?: number;
}

export interface SavedProfile {
  config: ProfileConfig;
  source: Required<ProfileSource>;
}

export interface ProfileStoreOptions {
  readonly userProfilesDirectory?: string;
  readonly workspaceProfilesDirectories?: readonly string[];
}

export class ProfileStore {
  constructor(private readonly options: ProfileStoreOptions = {}) {}

  async loadProfiles(activeProfileId = defaultProfile.id): Promise<LoadedProfiles> {
    const profiles: LoadedProfile[] = [
      {
        summary: {
          id: defaultProfile.id,
          name: defaultProfile.name,
          scope: "builtin",
        },
        config: defaultProfile,
        source: {
          scope: "builtin",
        },
      },
    ];
    const errors: string[] = [];

    await this.loadDirectoryProfiles("user", this.options.userProfilesDirectory, profiles, errors);

    for (const directory of this.options.workspaceProfilesDirectories ?? []) {
      await this.loadDirectoryProfiles("workspace", directory, profiles, errors);
    }

    const activeProfile =
      profiles.find((profile) => profile.config.id === activeProfileId) ?? profiles[0];

    return {
      profiles,
      activeProfile: activeProfile?.config ?? defaultProfile,
      activeProfileSource: activeProfile?.source ?? { scope: "builtin" },
      errors,
    };
  }

  async saveProfile(request: SaveProfileRequest): Promise<SavedProfile> {
    const directory = this.resolveSaveDirectory(request);
    await mkdir(directory, { recursive: true });

    const config = normalizeProfileConfig(
      {
        ...request.config,
        id: request.profileId,
      },
      request.profileId,
    );
    const filePath = path.join(directory, `${sanitizeProfileId(request.profileId)}.jsonc`);
    await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    return {
      config,
      source: {
        scope: request.scope,
        filePath,
      },
    };
  }

  private async loadDirectoryProfiles(
    scope: ProfileSummary["scope"],
    directory: string | undefined,
    profiles: LoadedProfile[],
    errors: string[],
  ): Promise<void> {
    if (directory === undefined || !existsSync(directory)) {
      return;
    }

    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonc")) {
        continue;
      }

      const filePath = path.join(directory, entry.name);

      try {
        const raw = await readFile(filePath, "utf8");
        const config = normalizeProfileConfig(parseJsonc(raw), filePath);
        profiles.push({
          summary: {
            id: config.id,
            name: config.name,
            scope,
          },
          config,
          source: {
            scope,
            filePath,
          },
        });
      } catch (error) {
        errors.push(`${filePath}: ${formatError(error)}`);
      }
    }
  }

  private resolveSaveDirectory(request: SaveProfileRequest): string {
    if (request.scope === "user") {
      if (this.options.userProfilesDirectory === undefined) {
        throw new Error("User profile directory is not configured.");
      }

      return this.options.userProfilesDirectory;
    }

    const directory = this.options.workspaceProfilesDirectories?.[request.workspaceIndex ?? 0];

    if (directory === undefined) {
      throw new Error("Workspace profile directory is not configured.");
    }

    return directory;
  }
}

export function getWorkspaceProfilesDirectory(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".live-serial-plotter", "profiles");
}

export function normalizeProfileConfig(value: unknown, source = "profile"): ProfileConfig {
  if (!isPlainObject(value)) {
    throw new Error(`${source} must contain a JSON object.`);
  }

  if (value.schemaVersion !== 1) {
    throw new Error(`${source} must use schemaVersion 1.`);
  }

  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new Error(`${source} must define a non-empty id.`);
  }

  if (typeof value.name !== "string" || value.name.length === 0) {
    throw new Error(`${source} must define a non-empty name.`);
  }

  const connection = normalizeConnection(value.connection, source);
  const framing = normalizeFraming(value.framing, source);
  const parser = normalizeParser(value.parser, source);
  const outputs = normalizeOutputs(value.outputs, source);

  return {
    schemaVersion: 1,
    id: value.id,
    name: value.name,
    connection,
    framing,
    parser,
    outputs,
    export: normalizeExport(value.export),
  };
}

function normalizeConnection(value: unknown, source: string): ProfileConfig["connection"] {
  if (!isPlainObject(value)) {
    throw new Error(`${source} must define connection.`);
  }

  const baudRate = typeof value.baudRate === "number" ? value.baudRate : 115200;

  return {
    baudRate,
    path: typeof value.path === "string" ? value.path : undefined,
    lineEnding: isLineEnding(value.lineEnding) ? value.lineEnding : "none",
  };
}

function normalizeFraming(value: unknown, source: string): ProfileConfig["framing"] {
  if (!isPlainObject(value)) {
    throw new Error(`${source} must define framing.`);
  }

  if (value.kind !== "line") {
    throw new Error(`${source} only supports line framing.`);
  }

  return {
    kind: "line",
    encoding: "utf8",
    delimiter: isDelimiter(value.delimiter) ? value.delimiter : "auto",
    trim: typeof value.trim === "boolean" ? value.trim : undefined,
    maxFrameBytes: typeof value.maxFrameBytes === "number" ? value.maxFrameBytes : undefined,
  };
}

function normalizeParser(value: unknown, source: string): ParserConfig {
  if (!isPlainObject(value)) {
    throw new Error(`${source} must define parser.`);
  }

  if (value.kind === "script") {
    if (typeof value.path !== "string" || value.path.length === 0) {
      throw new Error(`${source} script parser must define path.`);
    }

    return {
      kind: "script",
      path: value.path,
      options: isJsonObject(value.options) ? value.options : undefined,
    };
  }

  if (value.kind !== "builtin" || typeof value.mode !== "string" || !isParserMode(value.mode)) {
    throw new Error(`${source} builtin parser must define a valid mode.`);
  }

  return {
    kind: "builtin",
    mode: value.mode,
    options: isJsonObject(value.options) ? value.options : undefined,
  };
}

function normalizeOutputs(value: unknown, source: string): OutputConfig[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${source} must define at least one output.`);
  }

  return value.map((output, index) => {
    if (
      !isPlainObject(output) ||
      typeof output.id !== "string" ||
      typeof output.kind !== "string"
    ) {
      throw new Error(`${source} output at index ${index} is invalid.`);
    }

    return output as unknown as OutputConfig;
  });
}

function normalizeExport(value: unknown): ProfileConfig["export"] {
  if (!isPlainObject(value)) {
    return undefined;
  }

  if (
    (value.mode === "raw" || value.mode === "parsed" || value.mode === "packets") &&
    (value.format === "txt" || value.format === "csv" || value.format === "jsonl")
  ) {
    return {
      mode: value.mode,
      format: value.format,
      includeMetadata:
        typeof value.includeMetadata === "boolean" ? value.includeMetadata : undefined,
    };
  }

  return undefined;
}

function isDelimiter(value: unknown): value is ProfileConfig["framing"]["delimiter"] {
  return value === "auto" || value === "lf" || value === "crlf" || value === "cr";
}

function isLineEnding(
  value: unknown,
): value is NonNullable<ProfileConfig["connection"]["lineEnding"]> {
  return value === "none" || value === "lf" || value === "crlf" || value === "cr";
}

function isJsonObject(value: unknown): value is JsonObject {
  return isPlainObject(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeProfileId(profileId: string): string {
  return profileId.replaceAll(/[^A-Za-z0-9_.-]/g, "-");
}
