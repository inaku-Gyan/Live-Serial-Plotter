import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { builtinLayouts, defaultLayout } from "./defaultLayout";
import { parseJsonc } from "./jsonc";
import {
  type FramePlot2dViewLayoutConfig,
  type LayoutConfig,
  type LayoutRef,
  type LayoutSaveTarget,
  type LayoutSourceMetadata,
  type LayoutSummary,
  type MonitorPageLayoutConfig,
  type OutputLayoutConfig,
  type OutputPanelLayoutConfig,
  type OutputViewLayoutConfig,
  type ProfileScope,
  type TerminalViewLayoutConfig,
  type TimeSeriesViewLayoutConfig,
} from "../shared/protocol";

export interface LoadedLayout {
  summary: LayoutSummary;
  config: LayoutConfig;
  source: LayoutSource;
}

export type LayoutSource = LayoutSourceMetadata;

export interface LoadedLayouts {
  layouts: LoadedLayout[];
  errors: string[];
}

export interface ResolvedLayout {
  layout: LayoutConfig;
  layoutKey: string;
  layouts: LoadedLayout[];
  layoutTargets: LayoutSaveTarget[];
  errors: string[];
}

export interface SaveLayoutResult {
  layout: LayoutConfig;
  layoutKey: string;
  source: LayoutSource & { filePath: string };
}

export interface SaveLayoutAsRequest {
  layout: LayoutConfig;
  layoutId: string;
  target: LayoutSaveTarget;
}

export interface LayoutStoreOptions {
  readonly userLayoutsDirectory?: string;
  readonly workspaceLayoutsDirectories?: readonly WorkspaceLayoutsDirectory[];
}

export interface WorkspaceLayoutsDirectory {
  readonly folderUri: string;
  readonly folderName?: string;
  readonly layoutsDirectory: string;
}

interface LayoutNamespace {
  readonly scope: ProfileScope;
  readonly workspaceFolderUri?: string;
  readonly workspaceName?: string;
}

interface DirectoryLayoutLoadResult {
  readonly layouts: LoadedLayout[];
  readonly errors: string[];
}

export class LayoutStore {
  constructor(private readonly options: LayoutStoreOptions = {}) {}

  async loadLayouts(): Promise<LoadedLayouts> {
    const layouts: LoadedLayout[] = [];
    const errors: string[] = [];

    const workspaceLayoutResults = await Promise.all(
      (this.options.workspaceLayoutsDirectories ?? []).map((directory) =>
        this.loadDirectoryLayouts(
          {
            scope: "workspace",
            workspaceFolderUri: directory.folderUri,
            workspaceName: directory.folderName,
          },
          directory.layoutsDirectory,
        ),
      ),
    );

    for (const result of workspaceLayoutResults) {
      layouts.push(...result.layouts);
      errors.push(...result.errors);
    }

    const userLayoutResult = await this.loadDirectoryLayouts(
      { scope: "user" },
      this.options.userLayoutsDirectory,
    );
    layouts.push(...userLayoutResult.layouts);
    errors.push(...userLayoutResult.errors);

    for (const layout of builtinLayouts) {
      layouts.push(createLoadedLayout(layout, { scope: "builtin" }));
    }

    return { layouts, errors };
  }

  async resolveLayout(layoutKey: string): Promise<ResolvedLayout> {
    const loaded = await this.loadLayouts();
    const selected =
      loaded.layouts.find((layout) => layout.summary.key === layoutKey) ??
      loaded.layouts.find((layout) => layout.summary.key === getBuiltinLayoutKey(defaultLayout.id));
    const errors = [...loaded.errors];

    if (selected === undefined) {
      errors.push(`Layout "${layoutKey}" was not found.`);
    } else if (selected.summary.key !== layoutKey) {
      errors.push(`Layout "${layoutKey}" was not found. Using "${selected.summary.key}".`);
    }

    return {
      layout: selected?.config ?? defaultLayout,
      layoutKey: selected?.summary.key ?? getBuiltinLayoutKey(defaultLayout.id),
      layouts: loaded.layouts,
      layoutTargets: this.getSaveTargets(),
      errors,
    };
  }

  getSaveTargets(): LayoutSaveTarget[] {
    const targets: LayoutSaveTarget[] = [];

    for (const directory of this.options.workspaceLayoutsDirectories ?? []) {
      targets.push({
        label:
          directory.folderName === undefined ? "Workspace" : `Workspace: ${directory.folderName}`,
        scope: "workspace",
        workspaceFolderUri: directory.folderUri,
        workspaceName: directory.folderName,
      });
    }

    if (this.options.userLayoutsDirectory !== undefined) {
      targets.push({ label: "User", scope: "user" });
    }

    return targets;
  }

  async saveLayout(layoutKey: string, layout: LayoutConfig): Promise<SaveLayoutResult> {
    const loaded = await this.loadLayouts();
    const selected = loaded.layouts.find((candidate) => candidate.summary.key === layoutKey);

    if (selected === undefined) {
      throw new Error(`Layout "${layoutKey}" was not found.`);
    }

    if (selected.source.scope === "builtin" || selected.source.filePath === undefined) {
      throw new Error("Builtin layouts cannot be overwritten. Save As a user or workspace layout.");
    }

    const config = normalizeLayoutConfig(
      {
        ...layout,
        id: selected.source.ref.id,
      },
      selected.source.filePath,
    );
    await writeLayoutFile(selected.source.filePath, config);

    return {
      layout: config,
      layoutKey,
      source: {
        ...selected.source,
        filePath: selected.source.filePath,
      },
    };
  }

  async saveLayoutAs(request: SaveLayoutAsRequest): Promise<SaveLayoutResult> {
    const directory = this.resolveTargetDirectory(request.target);
    await mkdir(directory, { recursive: true });

    const config = normalizeLayoutConfig(
      {
        ...request.layout,
        id: request.layoutId,
      },
      request.layoutId,
    );
    const filePath = path.join(directory, `${sanitizeLayoutId(request.layoutId)}.jsonc`);

    if (existsSync(filePath)) {
      throw new Error(`Layout "${request.layoutId}" already exists in ${request.target.label}.`);
    }

    await writeLayoutFile(filePath, config);
    const ref = createLayoutRef(config.id, request.target.scope, request.target.workspaceFolderUri);
    const source = {
      ...createLayoutSource(ref, { filePath, workspaceName: request.target.workspaceName }),
      filePath,
    };

    return {
      layout: config,
      layoutKey: source.key,
      source,
    };
  }

  private async loadDirectoryLayouts(
    namespace: LayoutNamespace,
    directory: string | undefined,
  ): Promise<DirectoryLayoutLoadResult> {
    const layouts: LoadedLayout[] = [];
    const errors: string[] = [];

    if (directory === undefined || !existsSync(directory)) {
      return { layouts, errors };
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
            const config = normalizeLayoutConfig(parseJsonc(raw), filePath);

            return {
              layout: createLoadedLayout(config, namespace, { filePath }),
              error: undefined,
            };
          } catch (error) {
            return {
              layout: undefined,
              error: `${filePath}: ${formatError(error)}`,
            };
          }
        }),
    );

    for (const result of fileLoadResults) {
      if (result.layout !== undefined) {
        layouts.push(result.layout);
      }

      if (result.error !== undefined) {
        errors.push(result.error);
      }
    }

    return { layouts, errors };
  }

  private resolveTargetDirectory(target: LayoutSaveTarget): string {
    if (target.scope === "user") {
      if (this.options.userLayoutsDirectory === undefined) {
        throw new Error("User layout directory is not configured.");
      }

      return this.options.userLayoutsDirectory;
    }

    const directory = this.options.workspaceLayoutsDirectories?.find(
      (candidate) => candidate.folderUri === target.workspaceFolderUri,
    )?.layoutsDirectory;

    if (directory === undefined) {
      throw new Error("Workspace layout directory is not configured.");
    }

    return directory;
  }
}

export function getWorkspaceLayoutsDirectory(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".live-serial-plotter", "layouts");
}

export function getBuiltinLayoutKey(layoutId = defaultLayout.id): string {
  return createLayoutKey({ scope: "builtin", id: layoutId });
}

export function createLayoutKey(ref: LayoutRef): string {
  if (ref.scope === "workspace") {
    return `workspace:${encodeURIComponent(ref.workspaceFolderUri ?? "")}:${ref.id}`;
  }

  return `${ref.scope}:${ref.id}`;
}

export function normalizeLayoutConfig(value: unknown, source = "layout"): LayoutConfig {
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

  return {
    schemaVersion: 1,
    id: value.id,
    name: value.name,
    page: normalizePageLayout(value.page),
    outputs: normalizeOutputLayouts(value.outputs),
  };
}

function normalizePageLayout(value: unknown): MonitorPageLayoutConfig {
  if (!isPlainObject(value) || value.mode !== "grid") {
    return { mode: "grid", columns: "auto", density: "normal" };
  }

  return {
    mode: "grid",
    columns: isColumns(value.columns) ? value.columns : "auto",
    density: isDensity(value.density) ? value.density : "normal",
  };
}

function normalizeOutputLayouts(value: unknown): Record<string, OutputLayoutConfig> {
  if (!isPlainObject(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([outputId]) => outputId.length > 0)
      .map(([outputId, outputLayout]) => [outputId, normalizeOutputLayout(outputLayout)]),
  );
}

function normalizeOutputLayout(value: unknown): OutputLayoutConfig {
  if (!isPlainObject(value)) {
    return {};
  }

  return {
    panel: normalizePanelLayout(value.panel),
    view: normalizeViewLayout(value.view),
  };
}

function normalizePanelLayout(value: unknown): OutputPanelLayoutConfig | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  return {
    order: getFiniteNumber(value.order),
    columnSpan: getPositiveInteger(value.columnSpan),
    minHeight: getPositiveInteger(value.minHeight),
    collapsed: typeof value.collapsed === "boolean" ? value.collapsed : undefined,
    maximized: typeof value.maximized === "boolean" ? value.maximized : undefined,
  };
}

function normalizeViewLayout(value: unknown): OutputViewLayoutConfig | undefined {
  if (!isPlainObject(value) || typeof value.kind !== "string") {
    return undefined;
  }

  if (value.kind === "timeSeriesLine") {
    return normalizeTimeSeriesViewLayout(value);
  }

  if (value.kind === "terminalAppend" || value.kind === "terminalFrame") {
    return normalizeTerminalViewLayout(value);
  }

  if (value.kind === "framePlot2d") {
    return normalizeFramePlot2dViewLayout(value);
  }

  return undefined;
}

function normalizeTimeSeriesViewLayout(value: Record<string, unknown>): TimeSeriesViewLayoutConfig {
  return {
    kind: "timeSeriesLine",
    showLegend: typeof value.showLegend === "boolean" ? value.showLegend : undefined,
    autoFollow: typeof value.autoFollow === "boolean" ? value.autoFollow : undefined,
    zoom: normalizeAxisRange(value.zoom),
  };
}

function normalizeTerminalViewLayout(value: Record<string, unknown>): TerminalViewLayoutConfig {
  return {
    kind: value.kind === "terminalFrame" ? "terminalFrame" : "terminalAppend",
    autoScroll: typeof value.autoScroll === "boolean" ? value.autoScroll : undefined,
  };
}

function normalizeFramePlot2dViewLayout(
  value: Record<string, unknown>,
): FramePlot2dViewLayoutConfig {
  return {
    kind: "framePlot2d",
    bounds: normalizeBounds(value.bounds),
  };
}

function normalizeAxisRange(value: unknown): TimeSeriesViewLayoutConfig["zoom"] {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const x = normalizeRange(value.x);
  const y =
    isPlainObject(value.y) &&
    Object.values(value.y).every((range) => normalizeRange(range) !== undefined)
      ? Object.fromEntries(
          Object.entries(value.y).flatMap(([key, range]) => {
            const normalized = normalizeRange(range);
            return normalized === undefined ? [] : [[key, normalized]];
          }),
        )
      : undefined;

  return x === undefined && y === undefined ? undefined : { x, y };
}

function normalizeRange(value: unknown): { min: number; max: number } | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const min = getFiniteNumber(value.min);
  const max = getFiniteNumber(value.max);

  return min === undefined || max === undefined ? undefined : { min, max };
}

function normalizeBounds(value: unknown): FramePlot2dViewLayoutConfig["bounds"] {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const xMin = getFiniteNumber(value.xMin);
  const xMax = getFiniteNumber(value.xMax);
  const yMin = getFiniteNumber(value.yMin);
  const yMax = getFiniteNumber(value.yMax);

  return xMin === undefined || xMax === undefined || yMin === undefined || yMax === undefined
    ? undefined
    : { xMin, xMax, yMin, yMax };
}

function createLoadedLayout(
  config: LayoutConfig,
  namespace: LayoutNamespace,
  options: { filePath?: string } = {},
): LoadedLayout {
  const ref = createLayoutRef(config.id, namespace.scope, namespace.workspaceFolderUri);
  const source = createLayoutSource(ref, {
    filePath: options.filePath,
    workspaceName: namespace.workspaceName,
  });

  return {
    summary: {
      key: source.key,
      ref,
      id: config.id,
      name: config.name,
      scope: namespace.scope,
      workspaceName: namespace.workspaceName,
    },
    config,
    source,
  };
}

function createLayoutRef(id: string, scope: ProfileScope, workspaceFolderUri?: string): LayoutRef {
  return scope === "workspace"
    ? { scope, id, workspaceFolderUri }
    : {
        scope,
        id,
      };
}

function createLayoutSource(
  ref: LayoutRef,
  options: { filePath?: string; workspaceName?: string } = {},
): LayoutSource {
  return {
    key: createLayoutKey(ref),
    ref,
    scope: ref.scope,
    filePath: options.filePath,
    workspaceFolderUri: ref.workspaceFolderUri,
    workspaceName: options.workspaceName,
  };
}

function isColumns(value: unknown): value is MonitorPageLayoutConfig["columns"] {
  return value === "auto" || value === "single" || value === "two";
}

function isDensity(value: unknown): value is MonitorPageLayoutConfig["density"] {
  return value === "compact" || value === "normal" || value === "comfortable";
}

function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function writeLayoutFile(filePath: string, config: LayoutConfig): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function sanitizeLayoutId(layoutId: string): string {
  return layoutId.replaceAll(/[^A-Za-z0-9_.-]/g, "-");
}
