import { stat, unlink } from "node:fs/promises";
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

  if (!options.dryRun && pending.length > 0) {
    for (const item of assets.values()) {
      await writeAsset(paths.vrefDir, item.targetAssetPath, item.data);
    }

    for (const item of pending) {
      patchScreenshot(document, item.conversion);
    }

    await writeManifestDocument(paths.manifestPath, document);

    // Only after the manifest points at the webp files is it safe to drop the
    // originals: a failure before this leaves every entry resolvable.
    if (!options.keepSource) {
      await removeConvertedSources(paths.vrefDir, assets, document);
    }
  }

  const conversions = pending.map((item) => item.conversion);

  return {
    conversions,
    convertedCount: conversions.length,
    dryRun: options.dryRun,
    manifestPath: paths.manifestPath,
    // Signed, and counted per file rather than per entry. Re-encoding a lossy
    // jpeg to lossless webp legitimately grows it, and hiding that behind a
    // clamp would sell a migration that costs bytes as one that saves them.
    savedBytes: [...assets.values()].reduce(
      (total, item) => total + item.conversion.fromBytes - item.conversion.toBytes,
      0,
    ),
    skippedCount,
  };
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
  if (!options.force) {
    await assertTargetFree(targetAssetPath, targetFile);
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
    sourceAssetPath,
    targetAssetPath,
  };
}

function isSelected(only: readonly string[] | undefined, id: string): boolean {
  return only === undefined || only.includes(id);
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
    const claimed = assets.get(item.targetAssetPath);

    if (claimed === undefined) {
      assets.set(item.targetAssetPath, item);
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

/**
 * Delete an original only once nothing points at it any more.
 *
 * With `--only`, an unselected entry can still reference a source that a
 * selected entry just migrated. Deleting it would leave that entry dangling
 * while the command reported success, so the surviving manifest decides.
 */
async function removeConvertedSources(
  vrefDir: string,
  assets: Map<string, PendingConversion>,
  document: Record<string, unknown>,
): Promise<void> {
  const referenced = new Set(
    (Array.isArray(document.screenshots) ? document.screenshots : [])
      .filter((raw) => Predicate.isObject(raw) && typeof raw.file === "string")
      .map((raw) => join(vrefDir, (raw as { file: string }).file)),
  );

  for (const item of assets.values()) {
    if (!referenced.has(item.sourceAssetPath)) {
      await unlink(item.sourceAssetPath);
    }
  }
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

async function assertTargetFree(targetAssetPath: string, targetFile: string): Promise<void> {
  try {
    await stat(targetAssetPath);
  } catch {
    return;
  }

  throw new VrefError(
    "VREF_ASSET_EXISTS",
    `webp asset already exists, pass --force to replace it: ${targetFile}`,
  );
}
