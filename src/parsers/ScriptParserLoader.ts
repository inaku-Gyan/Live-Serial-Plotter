import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { LineParser, ParsedRecordInput } from "./parseLine";
import type { AsyncScriptParserLoader } from "../pipeline/PipelineRunner";
import type { Frame, JsonObject, ScriptParserConfig } from "../shared/protocol";

export interface ScriptParserTrustRequest {
  readonly filePath: string;
  readonly hash: string;
}

export interface ScriptParserTrustStore {
  isWorkspaceTrusted(): boolean;
  isTrusted(request: ScriptParserTrustRequest): boolean;
  confirmTrust(request: ScriptParserTrustRequest): Promise<boolean>;
}

export interface ScriptParserLoaderOptions {
  readonly workspaceRoots: readonly string[];
  readonly trustStore: ScriptParserTrustStore;
}

interface ScriptParserModule {
  createParser?(options: JsonObject | undefined): unknown;
}

interface ScriptParserInstance {
  parseFrame(frame: Frame): unknown;
  reset?(): void;
  dispose?(): void;
}

export class ScriptParserLoader implements AsyncScriptParserLoader {
  constructor(private readonly options: ScriptParserLoaderOptions) {}

  async load(config: ScriptParserConfig): Promise<LineParser> {
    if (!this.options.trustStore.isWorkspaceTrusted()) {
      throw new Error("Script parsers require a trusted workspace.");
    }

    const filePath = this.resolveScriptPath(config.path);
    const source = await readFile(filePath, "utf8");
    const hash = createHash("sha256").update(source).digest("hex");
    const trustRequest = { filePath, hash };

    if (
      !this.options.trustStore.isTrusted(trustRequest) &&
      !(await this.options.trustStore.confirmTrust(trustRequest))
    ) {
      throw new Error(`Script parser was not trusted: ${filePath}`);
    }

    const module = (await import(
      `${pathToFileURL(filePath).href}?sha=${hash}`
    )) as ScriptParserModule;

    if (typeof module.createParser !== "function") {
      throw new Error(`Script parser must export createParser(options): ${filePath}`);
    }

    const instance = module.createParser(config.options);

    if (!isScriptParserInstance(instance)) {
      throw new Error(
        `Script parser createParser() must return an object with parseFrame(): ${filePath}`,
      );
    }

    return new ScriptLineParser(instance);
  }

  private resolveScriptPath(scriptPath: string): string {
    if (path.isAbsolute(scriptPath)) {
      throw new Error("Script parser paths must be relative.");
    }

    if (!scriptPath.endsWith(".mjs")) {
      throw new Error("Script parsers must use .mjs files.");
    }

    const normalizedScriptPath = path.normalize(scriptPath);

    if (normalizedScriptPath.startsWith("..")) {
      throw new Error("Script parser paths must stay inside .live-serial-plotter/parsers.");
    }

    for (const workspaceRoot of this.options.workspaceRoots) {
      const parsersDirectory = path.resolve(workspaceRoot, ".live-serial-plotter", "parsers");
      const candidate = path.resolve(parsersDirectory, normalizedScriptPath);

      if (isSubpath(candidate, parsersDirectory) && existsSync(candidate)) {
        return candidate;
      }
    }

    throw new Error(`Script parser was not found: ${scriptPath}`);
  }
}

class ScriptLineParser implements LineParser {
  constructor(private readonly instance: ScriptParserInstance) {}

  parseFrame(frame: Frame): ParsedRecordInput[] {
    return normalizeParserResult(this.instance.parseFrame(frame));
  }

  reset(): void {
    this.instance.reset?.();
  }

  dispose(): void {
    this.instance.dispose?.();
  }
}

function normalizeParserResult(result: unknown): ParsedRecordInput[] {
  if (result === null || result === undefined) {
    return [];
  }

  const records = Array.isArray(result) ? result : [result];

  return records.flatMap((record) => {
    if (!isRecord(record) || !isRecord(record.fields)) {
      return [];
    }

    return [{ fields: record.fields }];
  });
}

function isScriptParserInstance(value: unknown): value is ScriptParserInstance {
  return isRecord(value) && typeof value.parseFrame === "function";
}

function isSubpath(filePath: string, directory: string): boolean {
  const relative = path.relative(directory, filePath);
  return relative.length === 0 || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
