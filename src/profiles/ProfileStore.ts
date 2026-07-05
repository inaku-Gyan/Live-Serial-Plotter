import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { formatError } from "../shared/formatError";
import { builtinProfiles, defaultProfile } from "./defaultProfile";
import { parseJsonc } from "./jsonc";
import { isPlainObject } from "../shared/tsUtils";
import {
  isParserMode,
  type BuiltinParserConfig,
  type CodecConfig,
  type JsonObject,
  type LineEnding,
  type OutputConfig,
  type ParserConfig,
  type ProfileConfig,
  type ProfileLayoutConfig,
  type ProfileRef,
  type ProfileScope,
  type ProfileSummary,
  type ProfileSourceMetadata,
  type SerialDefaultsConfig,
  type ScriptParserConfig,
} from "../shared/protocol";

export interface LoadedProfile {
  summary: ProfileSummary;
  config: ProfileConfig;
  source: ProfileSource;
}

export type ProfileSource = ProfileSourceMetadata;

export interface LoadedProfiles {
  profiles: LoadedProfile[];
  activeProfile: ProfileConfig;
  activeProfileKey: string;
  activeProfileSource: ProfileSource;
  errors: string[];
}

export interface SaveProfileRequest {
  config: ProfileConfig;
  profileId: string;
  target: ProfileCopyTarget;
}

export interface AutoSaveProfileRequest {
  config: ProfileConfig;
  source: ProfileSource;
}

export interface SavedProfile {
  config: ProfileConfig;
  source: ProfileSource & { filePath: string };
}

export interface ProfileCopyTarget {
  label: string;
  scope: "user" | "workspace";
  workspaceFolderUri?: string;
  workspaceName?: string;
}

export interface ProfileStoreOptions {
  readonly userProfilesDirectory?: string;
  readonly workspaceProfilesDirectories?: readonly WorkspaceProfilesDirectory[];
}

export interface WorkspaceProfilesDirectory {
  readonly folderUri: string;
  readonly folderName?: string;
  readonly profilesDirectory: string;
}

interface ProfileNamespace {
  readonly scope: ProfileScope;
  readonly workspaceFolderUri?: string;
  readonly workspaceName?: string;
}

interface DirectoryProfileLoadResult {
  readonly profiles: LoadedProfile[];
  readonly errors: string[];
}

export class ProfileStore {
  constructor(private readonly options: ProfileStoreOptions = {}) {}

  async loadProfiles(activeProfileKey?: string): Promise<LoadedProfiles> {
    const profiles: LoadedProfile[] = [];
    const errors: string[] = [];

    const workspaceProfileResults = await Promise.all(
      (this.options.workspaceProfilesDirectories ?? []).map((directory) =>
        this.loadDirectoryProfiles(
          createProfileNamespace({
            scope: "workspace",
            workspaceFolderUri: directory.folderUri,
            workspaceName: directory.folderName,
          }),
          directory.profilesDirectory,
        ),
      ),
    );

    for (const result of workspaceProfileResults) {
      profiles.push(...result.profiles);
      errors.push(...result.errors);
    }

    const userProfileResult = await this.loadDirectoryProfiles(
      {
        scope: "user",
      },
      this.options.userProfilesDirectory,
    );
    profiles.push(...userProfileResult.profiles);
    errors.push(...userProfileResult.errors);

    for (const profile of builtinProfiles) {
      profiles.push(createLoadedProfile(profile, { scope: "builtin" }));
    }

    const fallbackProfile =
      profiles.find((profile) => profile.summary.key === getBuiltinProfileKey(defaultProfile.id)) ??
      profiles.at(-1);
    const activeProfile =
      activeProfileKey === undefined
        ? fallbackProfile
        : (profiles.find((profile) => profile.summary.key === activeProfileKey) ?? fallbackProfile);

    return {
      profiles,
      activeProfile: activeProfile?.config ?? defaultProfile,
      activeProfileKey: activeProfile?.summary.key ?? getBuiltinProfileKey(defaultProfile.id),
      activeProfileSource:
        activeProfile?.source ?? createProfileSource({ scope: "builtin", id: defaultProfile.id }),
      errors,
    };
  }

  getCopyTargets(): ProfileCopyTarget[] {
    const targets: ProfileCopyTarget[] = [];

    for (const directory of this.options.workspaceProfilesDirectories ?? []) {
      const target: ProfileCopyTarget = {
        label:
          directory.folderName === undefined ? "Workspace" : `Workspace: ${directory.folderName}`,
        scope: "workspace",
        workspaceFolderUri: directory.folderUri,
      };

      if (directory.folderName !== undefined) {
        target.workspaceName = directory.folderName;
      }

      targets.push(target);
    }

    if (this.options.userProfilesDirectory !== undefined) {
      targets.push({
        label: "User",
        scope: "user",
      });
    }

    return targets;
  }

  async saveProfile(request: SaveProfileRequest): Promise<SavedProfile> {
    const directory = this.resolveTargetDirectory(request.target);
    await mkdir(directory, { recursive: true });

    const config = normalizeProfileConfig(
      {
        ...request.config,
        id: request.profileId,
      },
      request.profileId,
    );
    const filePath = path.join(directory, `${sanitizeProfileId(request.profileId)}.jsonc`);

    if (existsSync(filePath)) {
      throw new Error(`Profile "${request.profileId}" already exists in ${request.target.label}.`);
    }

    await writeProfileFile(filePath, config);
    const source = {
      ...createProfileSource(
        createProfileRef(config.id, request.target.scope, request.target.workspaceFolderUri),
        createSourceOptions(filePath, request.target.workspaceName),
      ),
      filePath,
    };

    return {
      config,
      source,
    };
  }

  async autoSaveProfile(request: AutoSaveProfileRequest): Promise<SavedProfile> {
    if (request.source.scope === "builtin" || request.source.filePath === undefined) {
      throw new Error("Builtin profiles cannot be auto-saved. Copy the profile first.");
    }

    const config = normalizeProfileConfig(
      {
        ...request.config,
        id: request.source.ref.id,
      },
      request.source.filePath,
    );
    await writeProfileFile(request.source.filePath, config);

    return {
      config,
      source: {
        ...request.source,
        filePath: request.source.filePath,
      },
    };
  }

  private async loadDirectoryProfiles(
    namespace: ProfileNamespace,
    directory: string | undefined,
  ): Promise<DirectoryProfileLoadResult> {
    const profiles: LoadedProfile[] = [];
    const errors: string[] = [];

    if (directory === undefined || !existsSync(directory)) {
      return { profiles, errors };
    }

    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    const fileLoadResults = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonc"))
        .map(async (entry) => {
          const filePath = path.join(directory, entry.name);

          try {
            const raw = await readFile(filePath, "utf8");
            const config = normalizeProfileConfig(parseJsonc(raw), filePath);

            return {
              profile: createLoadedProfile(config, namespace, {
                filePath,
              }),
              error: undefined,
            };
          } catch (error) {
            return {
              profile: undefined,
              error: `${filePath}: ${formatError(error)}`,
            };
          }
        }),
    );

    for (const result of fileLoadResults) {
      if (result.profile !== undefined) {
        profiles.push(result.profile);
      }

      if (result.error !== undefined) {
        errors.push(result.error);
      }
    }

    return { profiles, errors };
  }

  private resolveTargetDirectory(target: ProfileCopyTarget): string {
    if (target.scope === "user") {
      if (this.options.userProfilesDirectory === undefined) {
        throw new Error("User profile directory is not configured.");
      }

      return this.options.userProfilesDirectory;
    }

    const directory = this.options.workspaceProfilesDirectories?.find(
      (candidate) => candidate.folderUri === target.workspaceFolderUri,
    )?.profilesDirectory;

    if (directory === undefined) {
      throw new Error("Workspace profile directory is not configured.");
    }

    return directory;
  }
}

export function getWorkspaceProfilesDirectory(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".live-serial-plotter", "profiles");
}

export function getBuiltinProfileKey(profileId = defaultProfile.id): string {
  return createProfileKey({ scope: "builtin", id: profileId });
}

export function createProfileKey(ref: ProfileRef): string {
  if (ref.scope === "workspace") {
    return `workspace:${encodeURIComponent(ref.workspaceFolderUri ?? "")}:${ref.id}`;
  }

  return `${ref.scope}:${ref.id}`;
}

function createProfileNamespace(namespace: {
  scope: ProfileScope;
  workspaceFolderUri?: string | undefined;
  workspaceName?: string | undefined;
}): ProfileNamespace {
  const workspaceFolderUri = namespace.workspaceFolderUri;
  const workspaceName = namespace.workspaceName;

  if (workspaceFolderUri === undefined) {
    if (workspaceName === undefined) {
      return { scope: namespace.scope };
    }

    return { scope: namespace.scope, workspaceName };
  }

  if (workspaceName === undefined) {
    return { scope: namespace.scope, workspaceFolderUri };
  }

  return {
    scope: namespace.scope,
    workspaceFolderUri,
    workspaceName,
  };
}

function createSourceOptions(
  filePath: string | undefined,
  workspaceName: string | undefined,
): { filePath?: string; workspaceName?: string } {
  const options: { filePath?: string; workspaceName?: string } = {};

  if (filePath !== undefined) {
    options.filePath = filePath;
  }

  if (workspaceName !== undefined) {
    options.workspaceName = workspaceName;
  }

  return options;
}

function createLoadedProfile(
  config: ProfileConfig,
  namespace: ProfileNamespace,
  options: { filePath?: string } = {},
): LoadedProfile {
  const ref = createProfileRef(config.id, namespace.scope, namespace.workspaceFolderUri);
  const source = createProfileSource(
    ref,
    createSourceOptions(options.filePath, namespace.workspaceName),
  );
  const summary: ProfileSummary = {
    key: source.key,
    ref,
    id: config.id,
    name: config.name,
    scope: namespace.scope,
  };

  if (namespace.workspaceName !== undefined) {
    summary.workspaceName = namespace.workspaceName;
  }

  return {
    summary,
    config,
    source,
  };
}

function createProfileRef(
  id: string,
  scope: ProfileScope,
  workspaceFolderUri?: string,
): ProfileRef {
  const ref: ProfileRef = { scope, id };

  if (scope === "workspace" && workspaceFolderUri !== undefined) {
    ref.workspaceFolderUri = workspaceFolderUri;
  }

  return ref;
}

function createProfileSource(
  ref: ProfileRef,
  options: { filePath?: string; workspaceName?: string } = {},
): ProfileSource {
  const source: ProfileSource = {
    key: createProfileKey(ref),
    ref,
    scope: ref.scope,
  };

  if (options.filePath !== undefined) {
    source.filePath = options.filePath;
  }

  if (ref.workspaceFolderUri !== undefined) {
    source.workspaceFolderUri = ref.workspaceFolderUri;
  }

  if (options.workspaceName !== undefined) {
    source.workspaceName = options.workspaceName;
  }

  return source;
}

export function normalizeProfileConfig(value: unknown, source = "profile"): ProfileConfig {
  if (!isPlainObject(value)) {
    throw new Error(`${source} must contain a JSON object.`);
  }

  if (value.schemaVersion !== 3) {
    throw new Error(`${source} must use schemaVersion 3.`);
  }

  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new Error(`${source} must define a non-empty id.`);
  }

  if (typeof value.name !== "string" || value.name.length === 0) {
    throw new Error(`${source} must define a non-empty name.`);
  }

  const serialDefaults = normalizeSerialDefaults(value.serialDefaults);
  const layout = normalizeProfileLayout(value.layout, source);
  const codec = normalizeCodec(value.codec, source);
  const framing = normalizeFraming(value.framing, source);
  const parser = normalizeParser(value.parser, source);
  const outputs = normalizeOutputs(value.outputs, source);
  const exportConfig = normalizeExport(value.export);

  const config: ProfileConfig = {
    schemaVersion: 3,
    id: value.id,
    name: value.name,
    layout,
    codec,
    framing,
    parser,
    outputs,
  };

  if (serialDefaults !== undefined) {
    config.serialDefaults = serialDefaults;
  }

  if (exportConfig !== undefined) {
    config.export = exportConfig;
  }

  return config;
}

function normalizeProfileLayout(value: unknown, source: string): ProfileLayoutConfig {
  if (!isPlainObject(value)) {
    throw new Error(`${source} must define layout.`);
  }

  if (typeof value.defaultPreset !== "string" || value.defaultPreset.length === 0) {
    throw new Error(`${source} layout must define defaultPreset.`);
  }

  return {
    defaultPreset: value.defaultPreset,
  };
}

function normalizeSerialDefaults(value: unknown): SerialDefaultsConfig | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const baudRate = typeof value.baudRate === "number" ? value.baudRate : undefined;

  return baudRate === undefined ? undefined : { baudRate };
}

function normalizeCodec(value: unknown, source: string): CodecConfig {
  if (!isPlainObject(value)) {
    throw new Error(`${source} must define codec.`);
  }

  if (value.kind !== "text") {
    throw new Error(`${source} only supports text codec.`);
  }

  if (value.encoding !== "utf8") {
    throw new Error(`${source} text codec only supports utf8 encoding.`);
  }

  return {
    kind: "text",
    encoding: "utf8",
    sendLineEnding: isLineEnding(value.sendLineEnding) ? value.sendLineEnding : "none",
  };
}

function normalizeFraming(value: unknown, source: string): ProfileConfig["framing"] {
  if (!isPlainObject(value)) {
    throw new Error(`${source} must define framing.`);
  }

  if (value.kind !== "line") {
    throw new Error(`${source} only supports line framing.`);
  }

  const framing: ProfileConfig["framing"] = {
    kind: "line",
    delimiter: isDelimiter(value.delimiter) ? value.delimiter : "auto",
  };

  if (typeof value.trim === "boolean") {
    framing.trim = value.trim;
  }

  if (typeof value.maxFrameBytes === "number") {
    framing.maxFrameBytes = value.maxFrameBytes;
  }

  return framing;
}

function normalizeParser(value: unknown, source: string): ParserConfig {
  if (!isPlainObject(value)) {
    throw new Error(`${source} must define parser.`);
  }

  if (value.kind === "script") {
    if (typeof value.path !== "string" || value.path.length === 0) {
      throw new Error(`${source} script parser must define path.`);
    }

    const config: ScriptParserConfig = {
      kind: "script",
      path: value.path,
    };

    if (isJsonObject(value.options)) {
      config.options = value.options;
    }

    return config;
  }

  if (value.kind !== "builtin" || typeof value.mode !== "string" || !isParserMode(value.mode)) {
    throw new Error(`${source} builtin parser must define a valid mode.`);
  }

  const config: BuiltinParserConfig = {
    kind: "builtin",
    mode: value.mode,
  };

  if (isJsonObject(value.options)) {
    config.options = value.options;
  }

  return config;
}

function normalizeOutputs(value: unknown, source: string): OutputConfig[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${source} must define at least one output.`);
  }

  const outputIds = new Set<string>();

  return value.map((output, index) => {
    if (!isOutputConfig(output)) {
      throw new Error(`${source} output at index ${index} is invalid.`);
    }

    if (outputIds.has(output.id)) {
      throw new Error(`${source} output id "${output.id}" is duplicated.`);
    }

    outputIds.add(output.id);

    return output;
  });
}

function isOutputConfig(value: unknown): value is OutputConfig {
  if (!isPlainObject(value) || typeof value.id !== "string") {
    return false;
  }

  if (value.kind === "terminalAppend") {
    return true;
  }

  if (value.kind === "terminalFrame") {
    return typeof value.template === "string";
  }

  if (value.kind === "timeSeriesLine") {
    return isPlainObject(value.time) && isPlainObject(value.series);
  }

  if (value.kind === "framePlot2d") {
    return isPlainObject(value.points);
  }

  return false;
}

function normalizeExport(value: unknown): ProfileConfig["export"] {
  if (!isPlainObject(value)) {
    return undefined;
  }

  if (
    (value.mode === "raw" || value.mode === "parsed" || value.mode === "packets") &&
    (value.format === "txt" || value.format === "csv" || value.format === "jsonl")
  ) {
    const config: NonNullable<ProfileConfig["export"]> = {
      mode: value.mode,
      format: value.format,
    };

    if (typeof value.includeMetadata === "boolean") {
      config.includeMetadata = value.includeMetadata;
    }

    return config;
  }

  return undefined;
}

function isDelimiter(value: unknown): value is ProfileConfig["framing"]["delimiter"] {
  return value === "auto" || value === "lf" || value === "crlf" || value === "cr";
}

function isLineEnding(value: unknown): value is LineEnding {
  return value === "none" || value === "lf" || value === "crlf" || value === "cr";
}

function isJsonObject(value: unknown): value is JsonObject {
  return isPlainObject(value);
}

async function writeProfileFile(filePath: string, config: ProfileConfig): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function sanitizeProfileId(profileId: string): string {
  return profileId.replaceAll(/[^A-Za-z0-9_.-]/g, "-");
}
