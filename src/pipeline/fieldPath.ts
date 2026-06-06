export function getFieldValue(fields: Record<string, unknown>, path: string): unknown {
  if (Object.hasOwn(fields, path)) {
    return fields[path];
  }

  const parts = path.split(".");
  let current: unknown = fields;

  for (const part of parts) {
    if (!isRecord(current) || !Object.hasOwn(current, part)) {
      return undefined;
    }

    current = current[part];
  }

  return current;
}

export function getNumberField(fields: Record<string, unknown>, path: string): number | null {
  const value = getFieldValue(fields, path);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
