import { stat } from "node:fs/promises";
import { join } from "node:path";
import { VrefError, hasErrorCode, messageFrom } from "./errors.js";
import {
  readManifestDocument,
  screenshotDraftFromJson,
  screenshotFromJson,
  touchUpdatedAt,
  writeManifestDocument,
} from "./manifest.js";
import { assertNoSymlinkInPath, workspacePaths } from "./path-safety.js";
import { rawScreenshots, screenshotById } from "./screenshot-select.js";
import type {
  VrefManifestAddResult,
  VrefManifestUpdateResult,
  VrefScreenshot,
  VrefScreenshotDraft,
} from "./types.js";

export type AddScreenshotOptions = {
  cwd: string;
  dryRun: boolean;
  manifestPath: string;
  screenshot: VrefScreenshot;
};

export async function addScreenshot(options: AddScreenshotOptions): Promise<VrefManifestAddResult> {
  const paths = workspacePaths(options.cwd, options.manifestPath);
  await assertNoSymlinkInPath(paths.cwd, paths.manifestPath, "manifest");
  const { document, manifest } = await readManifestDocument(paths.manifestPath);

  if (manifest.screenshots.some((screenshot) => screenshot.id === options.screenshot.id)) {
    throw new VrefError(
      "VREF_MANIFEST_DUPLICATE_ID",
      `manifest already has screenshot id "${options.screenshot.id}"`,
    );
  }

  const assetPath = join(paths.manifestDir, options.screenshot.file);
  const assetExists = await screenshotAssetExists(paths.manifestDir, assetPath);
  const nextScreenshots = [...rawScreenshots(document), options.screenshot];
  const nextDocument = {
    ...document,
    screenshots: nextScreenshots,
  };

  if (!options.dryRun) {
    await writeManifestDocument(paths.manifestPath, touchUpdatedAt(nextDocument));
  }

  return {
    assetExists,
    dryRun: options.dryRun,
    manifestPath: paths.manifestPath,
    screenshot: options.screenshot,
    screenshotCount: nextScreenshots.length,
  };
}

export type UpdateScreenshotOptions = {
  cwd: string;
  dryRun: boolean;
  id: string;
  manifestPath: string;
  patch: Record<string, unknown>;
};

/**
 * JSON with object keys in a fixed order, so equality does not depend on the
 * order they were written in. Arrays keep their order: `tags` and `notes` are
 * sequences, and reordering one is a real change.
 */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`);

    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}

/** Schema fields an update may set. id, file and sizeBytes are refused separately. */
const MUTABLE_FIELDS = new Set([
  "title",
  "group",
  "platform",
  "device",
  "viewport",
  "capturedAt",
  "tags",
  "notes",
]);

/** Fields an update refuses, with what to reach for instead. */
const IMMUTABLE_FIELDS: Record<string, string> = {
  id: "`id` selects the entry. Rename with `vref screenshot remove` then `vref screenshot add`.",
  file: "`file` names the asset, and sizeBytes and viewport describe it. Replace with `vref screenshot remove` then `vref screenshot add`.",
  sizeBytes:
    "`sizeBytes` is measured from the asset. Replace with `vref screenshot remove` then `vref screenshot add`.",
};

/**
 * Merge named fields into one entry, leaving the rest as authored.
 *
 * Only what the patch names changes, so an edit is the fields it mentions
 * rather than a whole entry resent. The merged result is decoded before it is
 * written, so a patch cannot leave the manifest in a shape `validate` rejects.
 */
export async function updateScreenshot(
  options: UpdateScreenshotOptions,
): Promise<VrefManifestUpdateResult> {
  const paths = workspacePaths(options.cwd, options.manifestPath);
  await assertNoSymlinkInPath(paths.cwd, paths.manifestPath, "manifest");
  const { document, manifest } = await readManifestDocument(paths.manifestPath);
  screenshotById(manifest.screenshots, options.id);

  for (const [field, reason] of Object.entries(IMMUTABLE_FIELDS)) {
    if (field in options.patch) {
      throw new VrefError("VREF_FIELD_IMMUTABLE", `--json cannot change ${field}. ${reason}`);
    }
  }

  const entries = rawScreenshots(document);
  const index = entries.findIndex(
    (entry) =>
      typeof entry === "object" && entry !== null && (entry as { id?: unknown }).id === options.id,
  );
  const current = entries[index] as Record<string, unknown>;

  // A key that is neither a known mutable field nor already on the entry is a
  // typo: the schema tolerates excess properties, so `titel` would be written
  // as inert data, `title` would keep its old value, and the command would
  // report success. Fields already present stay editable, so a manifest
  // carrying its own extra data is still maintainable.
  const unknownFields = Object.keys(options.patch)
    .filter((field) => !MUTABLE_FIELDS.has(field) && !(field in current))
    .sort();
  if (unknownFields.length > 0) {
    throw new VrefError(
      "VREF_UNKNOWN_PATCH_FIELD",
      `--json names no field of screenshot "${options.id}": ${unknownFields.join(", ")}. ` +
        `Editable fields are ${[...MUTABLE_FIELDS].sort().join(", ")}, plus any the entry already carries.`,
    );
  }

  const merged = { ...current, ...options.patch };
  const screenshot = screenshotFromJson(merged, "--json");
  const changedFields = Object.keys(options.patch)
    .filter((field) => stableJson(current[field]) !== stableJson(options.patch[field]))
    .sort();

  const nextEntries = [...entries];
  nextEntries[index] = merged;

  // A patch that resends existing values is a no-op, so it must not move
  // updatedAt: that is the date the gallery displays, and dirtying the owning
  // repo while reporting "nothing changed" is a contradiction.
  if (!options.dryRun && changedFields.length > 0) {
    await writeManifestDocument(
      paths.manifestPath,
      touchUpdatedAt({ ...document, screenshots: nextEntries }),
    );
  }

  return {
    changedFields,
    dryRun: options.dryRun,
    manifestPath: paths.manifestPath,
    screenshot,
    screenshotCount: entries.length,
  };
}

export function decodePatchJson(rawJson: string): Record<string, unknown> {
  const parsed = parseJson(rawJson);

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new VrefError("VREF_JSON_INVALID", "--json must contain a screenshot object");
  }

  return parsed as Record<string, unknown>;
}

export function decodeScreenshotJson(rawJson: string): VrefScreenshot {
  return screenshotFromJson(parseJson(rawJson), "--json");
}

export function decodeScreenshotDraftJson(rawJson: string): VrefScreenshotDraft {
  return screenshotDraftFromJson(parseJson(rawJson), "--json");
}

function parseJson(rawJson: string): unknown {
  try {
    return JSON.parse(rawJson);
  } catch (error) {
    throw new VrefError(
      "VREF_JSON_INVALID",
      `--json must contain valid screenshot JSON: ${messageFrom(error)}`,
    );
  }
}

async function screenshotAssetExists(rootPath: string, assetPath: string): Promise<boolean> {
  await assertNoSymlinkInPath(rootPath, assetPath, "screenshot asset");

  try {
    const assetStats = await stat(assetPath);
    return assetStats.isFile();
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return false;
    }
    throw new VrefError("VREF_ASSET_CHECK_FAILED", "screenshot asset could not be checked");
  }
}
