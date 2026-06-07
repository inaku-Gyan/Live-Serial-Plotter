import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGenerator } from "ts-json-schema-generator";

const profileSchemaId =
  "https://inaku-Gyan.github.io/Live-Serial-Plotter/schemas/profile.schema.json";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(repoRoot, "schemas/profile.schema.json");

const schema = createProfileSchema();
const serialized = await formatJson(`${JSON.stringify(schema, null, 2)}\n`);

if (process.argv.includes("--check")) {
  const current = await readFile(schemaPath, "utf8");

  if (current !== serialized) {
    console.error(
      "schemas/profile.schema.json is out of date. Run `pnpm schema:generate` and commit the result.",
    );
    process.exitCode = 1;
  }
} else {
  await writeFile(schemaPath, serialized, "utf8");
}

function createProfileSchema() {
  const generator = createGenerator({
    path: path.join(repoRoot, "src/profiles/profileSchemaTypes.ts"),
    tsconfig: path.join(repoRoot, "tsconfig.json"),
    type: "ProfileConfigFile",
    expose: "export",
    topRef: true,
    jsDoc: "extended",
    extraTags: ["exclusiveMinimum", "minItems", "minLength", "minimum"],
    additionalProperties: false,
    discriminatorType: "open-api",
    sortProps: true,
  });

  const generated = generator.createSchema("ProfileConfigFile");
  const generatedSchema = preferOneOf(generated);

  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: profileSchemaId,
    title: "Live Serial Plotter Profile",
    description: "Schema for Live Serial Plotter profile JSONC files.",
    ...generatedSchema,
  };
}

function preferOneOf(value) {
  if (Array.isArray(value)) {
    return value.map(preferOneOf);
  }

  if (!isRecord(value)) {
    return value;
  }

  const next = {};

  for (const [key, child] of Object.entries(value)) {
    if (key === "anyOf") {
      next.oneOf = preferOneOf(child);
    } else {
      next[key] = preferOneOf(child);
    }
  }

  return next;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function formatJson(text) {
  const child = spawn("pnpm", ["exec", "oxfmt", "--stdin-filepath", schemaPath], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdin.end(text);

  await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }

      reject(new Error(`oxfmt failed with exit code ${code}.\n${stderr}`));
    });
  });

  return stdout;
}
