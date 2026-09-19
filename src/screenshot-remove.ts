import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { pathKey } from "./asset.js";
import { VrefError } from "./errors.js";
import { readManifestDocument, touchUpdatedAt, writeManifestDocument } from "./manifest.js";
import { assertNoSymlinkInPath, safeManifestAssetPath, workspacePaths } from "./path-safety.js";
import { rawScreenshots, screenshotById } from "./screenshot-select.js";
import type { VrefScreenshotRemoveResult } from "./types.js";

export type RemoveScreenshotOptions = {
  cwd: string;
  dryRun: boolean;
  id: string;
  keepAsset: boolean;
  manifestPath: string;
};

/**
 * Drop a screenshot entry and, unless `keepAsset`, the file it points at.
 *
 * The manifest is written before the asset is unlinked, matching `convert`: an
 * interrupted run leaves every surviving entry resolvable, and the worst case
 * is a file no entry references, which `validate` already reports as an orphan.
 */
export async function removeScreenshot(
  options: RemoveScreenshotOptions,
): Promise<VrefScreenshotRemoveResult> {
  const paths = workspacePaths(options.cwd, options.manifestPath);
  await assertNoSymlinkInPath(paths.cwd, paths.manifestPath, "manifest");
  const { document, manifest } = await readManifestDocument(paths.manifestPath);
  const screenshot = screenshotById(manifest.screenshots, options.id);

  const remaining = manifest.screenshots.filter((entry) => entry.id !== options.id);
  const claimants = remaining
    .filter((entry) => pathKey(entry.file) === pathKey(screenshot.file))
    .map((entry) => entry.id);

  // Deleting a file another entry still points at would leave that entry
  // unresolvable, so the ambiguity is refused rather than resolved.
  if (!options.keepAsset && claimants.length > 0) {
    throw new VrefError(
      "VREF_ASSET_CLAIMED",
      `${screenshot.file} is also referenced by ${claimants.join(", ")}. ` +
        "Pass --keep-asset to remove only the entry.",
    );
  }

  // Resolved and checked before the manifest is written, and on a dry run too:
  // a refusal has to leave nothing behind, and an unsafe asset path discovered
  // after the write would report a durable change as a failure.
  let assetPath: string | undefined;
  if (!options.keepAsset) {
    assetPath = join(paths.manifestDir, safeManifestAssetPath(screenshot.file, "file"));

    // A manifest named with an image extension can be referenced as its own
    // asset, and nothing upstream rejects that: the document parses, the file
    // exists, and validate passes. Unlinking it would delete every other entry
    // too while reporting a successful removal.
    if (pathKey(assetPath) === pathKey(paths.manifestPath)) {
      throw new VrefError(
        "VREF_UNSAFE_ASSET_PATH",
        `${screenshot.file} resolves to the manifest itself. Pass --keep-asset to remove only the entry.`,
      );
    }

    await assertNoSymlinkInPath(paths.manifestDir, assetPath, "screenshot asset");
  }

  const nextDocument = {
    ...document,
    screenshots: rawScreenshots(document).filter((entry) => !isEntryWithId(entry, options.id)),
  };

  let assetDeleted = false;

  if (!options.dryRun) {
    await writeManifestDocument(paths.manifestPath, touchUpdatedAt(nextDocument));

    if (assetPath !== undefined) {
      // An asset that will not unlink is reported, not fatal: the entry is
      // already gone, so failing here would report a durable change as an error.
      try {
        await unlink(assetPath);
        assetDeleted = true;
      } catch {
        assetDeleted = false;
      }
    }
  }

  return {
    assetDeleted,
    dryRun: options.dryRun,
    file: screenshot.file,
    manifestPath: paths.manifestPath,
    screenshot,
    screenshotCount: remaining.length,
  };
}

function isEntryWithId(entry: unknown, id: string): boolean {
  return typeof entry === "object" && entry !== null && (entry as { id?: unknown }).id === id;
}
