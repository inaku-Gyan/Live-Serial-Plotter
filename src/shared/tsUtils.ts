export function assertNever(value: never, message = "Unexpected value"): never {
  throw new Error(`${message}: ${formatUnexpectedValue(value)}`);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stripTrailingCarriageReturn(value: string): string {
  return value.endsWith("\r") ? value.slice(0, -1) : value;
}

function formatUnexpectedValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  const json = JSON.stringify(value);
  return json === undefined ? String(value) : json;
}
