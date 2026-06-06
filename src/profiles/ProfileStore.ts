import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
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
}

export interface LoadedProfiles {
  profiles: LoadedProfile[];
  activeProfile: ProfileConfig;
  errors: string[];
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
      },
    ];
    const errors: string[] = [];

    await this.loadDirectoryProfiles("user", this.options.userProfilesDirectory, profiles, errors);

    for (const directory of this.options.workspaceProfilesDirectories ?? []) {
      await this.loadDirectoryProfiles("workspace", directory, profiles, errors);
    }

    return {
      profiles,
      activeProfile:
        profiles.find((profile) => profile.config.id === activeProfileId)?.config ?? defaultProfile,
      errors,
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
        });
      } catch (error) {
        errors.push(`${filePath}: ${formatError(error)}`);
      }
    }
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
