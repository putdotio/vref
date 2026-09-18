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

  if (!options.dryRun && pending.length > 0) {
    for (const item of pending) {
      await writeAsset(paths.vrefDir, item.targetAssetPath, item.data);
      patchScreenshot(document, item.conversion);
    }

    await writeManifestDocument(paths.manifestPath, document);

    // Only after the manifest points at the webp files is it safe to drop the
    // originals: a failure before this leaves every entry resolvable.
    if (!options.keepSource) {
      for (const item of pending) {
        await unlink(item.sourceAssetPath);
      }
    }
  }

  const conversions = pending.map((item) => item.conversion);

  return {
    conversions,
    convertedCount: conversions.length,
    dryRun: options.dryRun,
    manifestPath: paths.manifestPath,
    savedBytes: conversions.reduce((total, item) => total + item.fromBytes - item.toBytes, 0),
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
