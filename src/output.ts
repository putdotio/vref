import { VrefError, errorToJson } from "./errors.js";

export type OutputFormat = "human" | "json";

export type OutputEnvelope = {
  ok: true;
  result: unknown;
  _meta?: {
    agentSafety: {
      untrustedTextPaths: readonly string[];
    };
  };
};

export function renderJsonResult(result: unknown, fields: readonly string[] = []): string {
  const selectedResult = selectTopLevelFields(result, fields);
  const untrustedTextPaths = untrustedTextPathsForResult(selectedResult);
  const envelope: OutputEnvelope = {
    ok: true,
    result: selectedResult,
  };

  if (untrustedTextPaths.length > 0) {
    return JSON.stringify(
      {
        ...envelope,
        _meta: { agentSafety: { untrustedTextPaths } },
      },
      null,
      2,
    );
  }

  return JSON.stringify(envelope, null, 2);
}

export function renderJsonError(error: unknown): string {
  const envelope = errorToJson(error);
  return JSON.stringify(envelope, null, 2);
}

export function parseFields(value: string | undefined): readonly string[] {
  if (value === undefined) {
    return [];
  }

  const fields = value.split(",").map((field) => field.trim());
  if (fields.some((field) => field.length === 0)) {
    throw new VrefError("VREF_INVALID_FIELDS", "--fields must be a comma-separated field list");
  }

  for (const field of fields) {
    if (hasControlCharacter(field) || !/^[A-Za-z0-9_-]+$/u.test(field)) {
      throw new VrefError(
        "VREF_INVALID_FIELDS",
        "--fields only accepts top-level field names without dots, brackets, or slashes",
      );
    }
  }

  return fields;
}

function selectTopLevelFields(value: unknown, fields: readonly string[]): unknown {
  if (fields.length === 0) {
    return value;
  }

  if (!isRecord(value)) {
    return value;
  }

  const selected: Record<string, unknown> = {};
  const unknownFields = fields.filter((field) => !(field in value));
  if (unknownFields.length > 0) {
    throw new VrefError(
      "VREF_UNKNOWN_FIELD",
      `Unknown --fields value: ${unknownFields.join(", ")}`,
    );
  }

  for (const field of fields) {
    selected[field] = value[field];
  }

  return selected;
}

function untrustedTextPathsForResult(result: unknown): readonly string[] {
  const paths: string[] = [];
  collectUntrustedTextPaths(result, "result", paths);
  return paths;
}

function collectUntrustedTextPaths(value: unknown, path: string, paths: string[]): void {
  if (typeof value === "string") {
    if (isUntrustedTextPath(path)) {
      paths.push(path);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectUntrustedTextPaths(item, `${path}[${index}]`, paths));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    collectUntrustedTextPaths(nestedValue, `${path}.${key}`, paths);
  }
}

function isUntrustedTextPath(path: string): boolean {
  if (!path.startsWith("result.screenshot.") && !path.includes(".screenshots[")) {
    return false;
  }

  return (
    path.endsWith(".title") ||
    path.endsWith(".description") ||
    path.endsWith(".group") ||
    path.endsWith(".platform") ||
    path.endsWith(".device") ||
    path.includes(".notes[") ||
    path.includes(".tags[")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);

    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}
