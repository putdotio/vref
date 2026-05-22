import { readFile, writeFile } from "node:fs/promises";
import { VrefError } from "./errors.js";
import { assertSupportedImage, safeManifestAssetPath } from "./path-safety.js";
import type { VrefManifest, VrefScreenshot, VrefViewport } from "./types.js";

export async function readManifest(path: string): Promise<VrefManifest> {
  const { manifest } = await readManifestDocument(path);
  return manifest;
}

export async function readManifestDocument(
  path: string,
): Promise<{ manifest: VrefManifest; document: Record<string, unknown> }> {
  let raw: string;

  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new VrefError(
      "VREF_MANIFEST_READ_FAILED",
      `Could not read manifest at ${path}: ${messageFrom(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new VrefError(
      "VREF_MANIFEST_JSON_INVALID",
      `Manifest JSON is invalid at ${path}: ${messageFrom(error)}`,
    );
  }

  const document = requireRecord(parsed, path);
  return {
    document,
    manifest: manifestFromUnknown(document, path),
  };
}

export async function writeManifest(path: string, manifest: VrefManifest): Promise<void> {
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function writeManifestDocument(
  path: string,
  document: Record<string, unknown>,
): Promise<void> {
  await writeFile(path, `${JSON.stringify(document, null, 2)}\n`);
}

export function screenshotFromJson(value: unknown, path: string): VrefScreenshot {
  return screenshotFromUnknown(value, path);
}

function manifestFromUnknown(value: unknown, path: string): VrefManifest {
  const record = requireRecord(value, path);
  const version = requireNumber(record.version, `${path}:version`);

  if (version !== 1) {
    throw new VrefError("VREF_MANIFEST_UNSUPPORTED_VERSION", `${path}:version must be 1`);
  }

  const screenshots = requireArray(record.screenshots, `${path}:screenshots`).map(
    (screenshot, index) => screenshotFromUnknown(screenshot, `${path}:screenshots[${index}]`),
  );
  const ids = new Set<string>();
  for (const screenshot of screenshots) {
    if (ids.has(screenshot.id)) {
      throw new VrefError(
        "VREF_MANIFEST_DUPLICATE_ID",
        `${path}:screenshots has duplicate id "${screenshot.id}"`,
      );
    }
    ids.add(screenshot.id);
  }

  return {
    version: 1,
    title: requireString(record.title, `${path}:title`),
    description: requireString(record.description, `${path}:description`),
    updatedAt: requireIsoDateString(record.updatedAt, `${path}:updatedAt`),
    screenshots,
  };
}

function screenshotFromUnknown(value: unknown, path: string): VrefScreenshot {
  const record = requireRecord(value, path);
  const file = safeManifestAssetPath(requireString(record.file, `${path}:file`), `${path}:file`);
  assertSupportedImage(file);

  return {
    id: requireIdentifier(record.id, `${path}:id`),
    title: requireString(record.title, `${path}:title`),
    group: requireString(record.group, `${path}:group`),
    platform: requireString(record.platform, `${path}:platform`),
    device: requireString(record.device, `${path}:device`),
    viewport: viewportFromUnknown(record.viewport, `${path}:viewport`),
    file,
    capturedAt: requireIsoDateString(record.capturedAt, `${path}:capturedAt`),
    sizeBytes: requirePositiveNumber(record.sizeBytes, `${path}:sizeBytes`),
    tags: requireStringArray(record.tags, `${path}:tags`).map((tag, index) =>
      requireTag(tag, `${path}:tags[${index}]`),
    ),
    notes: requireStringArray(record.notes, `${path}:notes`),
  };
}

function viewportFromUnknown(value: unknown, path: string): VrefViewport {
  const record = requireRecord(value, path);

  return {
    width: requirePositiveNumber(record.width, `${path}:width`),
    height: requirePositiveNumber(record.height, `${path}:height`),
  };
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }

  throw new VrefError("VREF_MANIFEST_SCHEMA_INVALID", `${path} must be an object`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireArray(value: unknown, path: string): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  throw new VrefError("VREF_MANIFEST_SCHEMA_INVALID", `${path} must be an array`);
}

function requireStringArray(value: unknown, path: string): string[] {
  return requireArray(value, path).map((item, index) => requireString(item, `${path}[${index}]`));
}

function requireString(value: unknown, path: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  throw new VrefError("VREF_MANIFEST_SCHEMA_INVALID", `${path} must be a non-empty string`);
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  throw new VrefError("VREF_MANIFEST_SCHEMA_INVALID", `${path} must be a finite number`);
}

function requirePositiveNumber(value: unknown, path: string): number {
  const numberValue = requireNumber(value, path);

  if (numberValue > 0) {
    return numberValue;
  }

  throw new VrefError("VREF_MANIFEST_SCHEMA_INVALID", `${path} must be greater than 0`);
}

function requireIsoDateString(value: unknown, path: string): string {
  const stringValue = requireString(value, path);
  const parsed = Date.parse(stringValue);

  if (Number.isFinite(parsed)) {
    return stringValue;
  }

  throw new VrefError("VREF_MANIFEST_SCHEMA_INVALID", `${path} must be an ISO date string`);
}

function requireIdentifier(value: unknown, path: string): string {
  const stringValue = requireString(value, path);

  if (/^[a-z0-9][a-z0-9._-]*$/u.test(stringValue)) {
    return stringValue;
  }

  throw new VrefError(
    "VREF_MANIFEST_SCHEMA_INVALID",
    `${path} must use lowercase letters, numbers, dots, underscores, or hyphens`,
  );
}

function requireTag(value: string, path: string): string {
  if (/^[a-z0-9][a-z0-9._-]*$/u.test(value)) {
    return value;
  }

  throw new VrefError(
    "VREF_MANIFEST_SCHEMA_INVALID",
    `${path} must use lowercase letters, numbers, dots, underscores, or hyphens`,
  );
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
