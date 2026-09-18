import { readFile, rm, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Predicate } from "effect";
import { VrefError } from "./errors.js";
import { encodeWebp, isWebpFile, webpSiblingPath } from "./image.js";
import { readManifestDocument, writeManifestDocument } from "./manifest.js";
import { writeAsset } from "./screenshot-add.js";
import { assertNoSymlinkInPath, safeManifestAssetPath, workspacePaths } from "./path-safety.js";
import type { VrefConversion, VrefConvertResult } from "./types.js";

export type ConvertOptions = {
  cwd: string;
  dryRun: boolean;
  force: boolean;
  keepSource: boolean;
  manifestPath: string;
  only?: readonly string[];
  quality?: number;
};

type PendingConversion = {
  conversion: VrefConversion;
  data: Buffer;
  replacedBytes: number;
  sourceAssetPath: string;
  targetAssetPath: string;
};

export async function convertGallery(options: ConvertOptions): Promise<VrefConvertResult> {
  const paths = workspacePaths(options.cwd, options.manifestPath);
  await assertNoSymlinkInPath(paths.cwd, paths.manifestPath, "manifest");
  const { document, manifest } = await readManifestDocument(paths.manifestPath);

  const pending: PendingConversion[] = [];
  let skippedCount = 0;

  for (const screenshot of manifest.screenshots) {
    if (isWebpFile(screenshot.file) || !isSelected(options.only, screenshot.id)) {
      skippedCount += 1;
      continue;
    }

    pending.push(await prepareConversion(paths.vrefDir, screenshot, options));
  }

  const assets = collectAssets(pending);
  assertTargetsUnclaimed(paths.vrefDir, assets, pending, document);

  // Patch in memory first so the removal decision and the reported delta both
  // see the manifest as it will finally read. Nothing is written on a dry run.
  for (const item of pending) {
    patchScreenshot(document, item.conversion);
  }

  const removable = options.keepSource
    ? []
    : [...assets.values()].filter((item) => !isStillReferenced(paths.vrefDir, item, document));

  if (!options.dryRun && pending.length > 0) {
    await writeConvertedAssets(paths, assets, document);

    // Only once the manifest points at the webp files is it safe to drop the
    // originals: a failure before this leaves every entry resolvable.
    for (const item of removable) {
      await unlink(item.sourceAssetPath);
    }
  }

  const conversions = pending.map((item) => item.conversion);
  const addedBytes = [...assets.values()].reduce(
    (total, item) => total + item.conversion.toBytes,
    0,
  );
  const removedBytes = removable.reduce((total, item) => total + item.conversion.fromBytes, 0);
  // A target being overwritten frees its old bytes, so they count as reclaimed
  // too; ignoring them made a forced re-run understate the change.
  const replacedBytes = [...assets.values()].reduce((total, item) => total + item.replacedBytes, 0);

  return {
    conversions,
    convertedCount: conversions.length,
    dryRun: options.dryRun,
    manifestPath: paths.manifestPath,
    // Bytes reclaimed minus bytes added, counted only over files that are
    // actually removed. Under --keep-source nothing is reclaimed, so a
    // migration that grows the tree reports a negative number rather than
    // crediting originals that are still sitting on disk.
    savedBytes: removedBytes + replacedBytes - addedBytes,
    skippedCount,
  };
}

/**
 * Write every converted asset and the manifest, or leave the tree as it was.
 *
 * A failure partway through — ENOSPC, a read-only manifest — would otherwise
 * strand webp files that no manifest entry references, so a later retry trips
 * over VREF_ASSET_EXISTS against output from the run that failed.
 */
async function writeConvertedAssets(
  paths: { manifestPath: string; vrefDir: string },
  assets: Map<string, PendingConversion>,
  document: Record<string, unknown>,
): Promise<void> {
  const written: { previous: Buffer | undefined; targetAssetPath: string }[] = [];

  try {
    for (const item of assets.values()) {
      // Registered before the write, not after: a write that fails partway has
      // already truncated the target, and only a registered target gets restored.
      const previous = await readIfExists(item.targetAssetPath);
      written.push({ previous, targetAssetPath: item.targetAssetPath });
      await writeAsset(paths.vrefDir, item.targetAssetPath, item.data);
    }

    await writeManifestDocument(paths.manifestPath, document);
  } catch (error) {
    // The manifest needs no rollback: writeManifestDocument replaces it
    // atomically, so it is either untouched or fully written.
    for (const item of written) {
      try {
        if (item.previous === undefined) {
          await rm(item.targetAssetPath, { force: true });
        } else {
          await writeAsset(paths.vrefDir, item.targetAssetPath, item.previous);
        }
      } catch {
        // The original failure is the one worth reporting.
      }
    }

    throw error;
  }
}

/**
 * Refuse a target that an entry outside this conversion already points at.
 *
 * `--force` skips the "does it exist" check, which is fine for replacing your
 * own output but not when another manifest entry references that exact file:
 * overwriting it swaps the image under that entry while its sizeBytes and
 * viewport keep describing the old one, and `validate` still passes because the
 * file exists.
 */
function assertTargetsUnclaimed(
  vrefDir: string,
  assets: Map<string, PendingConversion>,
  pending: PendingConversion[],
  document: Record<string, unknown>,
): void {
  const converting = new Set(pending.map((item) => item.conversion.id));
  const screenshots = Array.isArray(document.screenshots) ? document.screenshots : [];

  for (const item of assets.values()) {
    const target = pathKey(item.targetAssetPath);

    for (const raw of screenshots) {
      if (!Predicate.isObject(raw) || typeof raw.file !== "string" || typeof raw.id !== "string") {
        continue;
      }
      if (converting.has(raw.id)) {
        continue;
      }
      if (pathKey(join(vrefDir, raw.file.replaceAll("\\", "/"))) === target) {
        throw new VrefError(
          "VREF_TARGET_CLAIMED",
          `"${item.conversion.from}" converts to ${item.conversion.to}, which screenshot "${raw.id}" already references`,
        );
      }
    }
  }
}

function isStillReferenced(
  vrefDir: string,
  item: PendingConversion,
  document: Record<string, unknown>,
): boolean {
  const screenshots = Array.isArray(document.screenshots) ? document.screenshots : [];

  // Case-insensitive for the same reason as collectAssets, and erring toward
  // keeping a file: a source that might still be referenced must not be
  // deleted.
  const source = pathKey(item.sourceAssetPath);

  return screenshots.some(
    (raw) =>
      Predicate.isObject(raw) &&
      typeof raw.file === "string" &&
      pathKey(join(vrefDir, raw.file.replaceAll("\\", "/"))) === source,
  );
}

async function readIfExists(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    // Only a missing file means there is nothing to put back. Any other read
    // failure must abort before the target is registered or touched, or the
    // rollback would delete a file that was already there.
    if (hasErrorCode(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }
}

async function prepareConversion(
  vrefDir: string,
  screenshot: { file: string; id: string },
  options: ConvertOptions,
): Promise<PendingConversion> {
  const sourceAssetPath = join(vrefDir, screenshot.file);
  await assertNoSymlinkInPath(vrefDir, sourceAssetPath, "screenshot asset");

  const targetFile = safeManifestAssetPath(webpSiblingPath(screenshot.file), "screenshot file");
  const targetAssetPath = join(vrefDir, targetFile);
  await assertNoSymlinkInPath(vrefDir, targetAssetPath, "screenshot asset");

  const fromBytes = await assetSize(sourceAssetPath, screenshot.file);
  const target = await targetState(targetAssetPath, targetFile);
  if (!options.force && target.exists) {
    throw new VrefError(
      "VREF_ASSET_EXISTS",
      `webp asset already exists, pass --force to replace it: ${targetFile}`,
    );
  }

  const encoded = await encodeWebp({ sourcePath: sourceAssetPath, quality: options.quality });

  return {
    conversion: {
      id: screenshot.id,
      from: screenshot.file,
      fromBytes,
      to: targetFile,
      toBytes: encoded.data.byteLength,
    },
    data: encoded.data,
    replacedBytes: target.size,
    sourceAssetPath,
    targetAssetPath,
  };
}

function isSelected(only: readonly string[] | undefined, id: string): boolean {
  return only === undefined || only.includes(id);
}

/**
 * Compare paths the way the filesystem will.
 *
 * macOS and Windows fold case, and macOS also folds Unicode normalization, so
 * `café.png` typed as NFC and as NFD are one file there and two on Linux.
 * `.vref/` is committed and checked out on all of them, so comparisons use the
 * most forgiving form and any ambiguity is refused rather than resolved.
 */
function pathKey(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

/**
 * Reduce the per-entry plan to one job per output file.
 *
 * Two entries may legitimately name the same asset, in which case they share a
 * single encode. Two *different* assets landing on one target is another matter:
 * `home.png` and `home.jpg` both resolve to `home.webp`, and writing them in
 * sequence would leave one reference silently overwritten by the other. Nothing
 * has been written yet at this point, so refuse the whole run instead.
 */
function collectAssets(pending: PendingConversion[]): Map<string, PendingConversion> {
  const assets = new Map<string, PendingConversion>();

  for (const item of pending) {
    // Keyed case-insensitively because `.vref/` is committed and checked out on
    // both case-sensitive and case-insensitive filesystems. `home.png` and
    // `HOME.jpg` are two files on Linux but one on macOS and Windows, so
    // comparing raw strings would let the second write swallow the first on
    // exactly the machines most of these galleries are authored on.
    const key = pathKey(item.targetAssetPath);
    const claimed = assets.get(key);

    if (claimed === undefined) {
      assets.set(key, item);
      continue;
    }

    if (claimed.conversion.from !== item.conversion.from) {
      throw new VrefError(
        "VREF_CONVERT_TARGET_COLLISION",
        `"${claimed.conversion.from}" and "${item.conversion.from}" both convert to ${item.conversion.to}; rename one before converting`,
      );
    }
  }

  return assets;
}

function patchScreenshot(document: Record<string, unknown>, conversion: VrefConversion): void {
  const screenshots = document.screenshots;
  if (!Array.isArray(screenshots)) {
    throw new VrefError("VREF_MANIFEST_SCHEMA_INVALID", "manifest:screenshots must be an array");
  }

  for (const raw of screenshots) {
    if (Predicate.isObject(raw) && raw.id === conversion.id) {
      raw.file = conversion.to;
      raw.sizeBytes = conversion.toBytes;
      return;
    }
  }

  throw new VrefError(
    "VREF_MANIFEST_SCHEMA_INVALID",
    `manifest:screenshots is missing id "${conversion.id}"`,
  );
}

async function assetSize(assetPath: string, file: string): Promise<number> {
  try {
    const stats = await stat(assetPath);

    return stats.size;
  } catch {
    throw new VrefError("VREF_ASSET_MISSING", `screenshot asset is missing: ${file}`);
  }
}

/**
 * Whether a target is already taken, kept separate from how big it is.
 *
 * An empty file is still a file: collapsing the two would let a zero-byte
 * target — exactly what an interrupted write leaves behind — be overwritten
 * without `--force`. A directory is refused outright, since no `--force` makes
 * that writable and deferring it turns a clear preflight error into an EISDIR
 * at write time, after a dry run has already promised the plan works.
 */
async function targetState(
  targetAssetPath: string,
  targetFile: string,
): Promise<{ exists: boolean; size: number }> {
  try {
    const stats = await stat(targetAssetPath);

    if (!stats.isFile()) {
      throw new VrefError(
        "VREF_TARGET_NOT_FILE",
        `conversion target exists and is not a file: ${targetFile}`,
      );
    }

    return { exists: true, size: stats.size };
  } catch (error) {
    if (error instanceof VrefError) {
      throw error;
    }

    return { exists: false, size: 0 };
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
