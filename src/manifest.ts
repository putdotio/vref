import { readFile, writeFile } from "node:fs/promises";
import { DateTime, Option, Predicate, Schema } from "effect";
import { VrefError } from "./errors.js";
import { assertSupportedImage, safeManifestAssetPath } from "./path-safety.js";
import type { VrefManifest, VrefScreenshot } from "./types.js";

const Identifier = Schema.NonEmptyString.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9._-]*$/u, {
    expected: "lowercase letters, numbers, dots, underscores, or hyphens",
  }),
);
const NonBlankString = Schema.String.check(
  Schema.makeFilter((value) => value.trim().length > 0, {
    expected: "a non-empty string",
  }),
);
const PositiveFinite = Schema.Finite.check(Schema.isGreaterThan(0));
const DateString = NonBlankString.check(
  Schema.makeFilter((value) => Option.isSome(DateTime.make(value)), { expected: "a date string" }),
);
const VrefViewportSchema = Schema.Struct({
  width: PositiveFinite,
  height: PositiveFinite,
});
const VrefScreenshotSchema = Schema.Struct({
  id: Identifier,
  title: NonBlankString,
  group: NonBlankString,
  platform: NonBlankString,
  device: NonBlankString,
  viewport: VrefViewportSchema,
  file: NonBlankString,
  capturedAt: DateString,
  sizeBytes: PositiveFinite,
  tags: Schema.Array(Identifier),
  notes: Schema.Array(NonBlankString),
});
const VrefManifestSchema = Schema.Struct({
  version: Schema.Literal(1),
  title: NonBlankString,
  description: NonBlankString,
  updatedAt: DateString,
  screenshots: Schema.Array(VrefScreenshotSchema),
});

const decodeManifest = Schema.decodeUnknownSync(VrefManifestSchema);
const decodeScreenshot = Schema.decodeUnknownSync(VrefScreenshotSchema);

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
  if (Predicate.isObject(value) && typeof value.version === "number" && value.version !== 1) {
    throw new VrefError("VREF_MANIFEST_UNSUPPORTED_VERSION", `${path}:version must be 1`);
  }

  let decoded: typeof VrefManifestSchema.Type;
  try {
    decoded = decodeManifest(value, { errors: "all" });
  } catch (error) {
    throw new VrefError("VREF_MANIFEST_SCHEMA_INVALID", `${path}: ${messageFrom(error)}`);
  }

  const screenshots = decoded.screenshots.map((screenshot, index) =>
    validatedScreenshot(screenshot, `${path}:screenshots[${index}]`),
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
    title: decoded.title,
    description: decoded.description,
    updatedAt: decoded.updatedAt,
    screenshots,
  };
}

function screenshotFromUnknown(value: unknown, path: string): VrefScreenshot {
  let decoded: typeof VrefScreenshotSchema.Type;
  try {
    decoded = decodeScreenshot(value, { errors: "all" });
  } catch (error) {
    throw new VrefError("VREF_MANIFEST_SCHEMA_INVALID", `${path}: ${messageFrom(error)}`);
  }

  return validatedScreenshot(decoded, path);
}

function validatedScreenshot(
  screenshot: typeof VrefScreenshotSchema.Type,
  path: string,
): VrefScreenshot {
  const file = safeManifestAssetPath(screenshot.file, `${path}:file`);
  assertSupportedImage(file);

  return {
    id: screenshot.id,
    title: screenshot.title,
    group: screenshot.group,
    platform: screenshot.platform,
    device: screenshot.device,
    viewport: { width: screenshot.viewport.width, height: screenshot.viewport.height },
    file,
    capturedAt: screenshot.capturedAt,
    sizeBytes: screenshot.sizeBytes,
    tags: [...screenshot.tags],
    notes: [...screenshot.notes],
  };
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (Predicate.isObject(value)) {
    return value;
  }

  throw new VrefError("VREF_MANIFEST_SCHEMA_INVALID", `${path} must be an object`);
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
