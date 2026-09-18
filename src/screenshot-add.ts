import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { VrefError } from "./errors.js";
import { encodeWebp, isWebpFile, WEBP_EXTENSION } from "./image.js";
import { readManifest, screenshotFromJson, type VrefScreenshotDraft } from "./manifest.js";
import { addScreenshot } from "./manifest-edit.js";
import {
  assertNoSymlinkInPath,
  assertSupportedImage,
  safeManifestAssetPath,
  workspacePaths,
} from "./path-safety.js";
import type { VrefScreenshot, VrefScreenshotAddResult } from "./types.js";

export type AddScreenshotFromSourceOptions = {
  cwd: string;
  draft: VrefScreenshotDraft;
  dryRun: boolean;
  force: boolean;
  manifestPath: string;
  quality?: number;
  sourcePath: string;
};

export async function addScreenshotFromSource(
  options: AddScreenshotFromSourceOptions,
): Promise<VrefScreenshotAddResult> {
  const paths = workspacePaths(options.cwd, options.manifestPath);
  await assertNoSymlinkInPath(paths.cwd, paths.manifestPath, "manifest");

  // Check the id before touching the encoder, so a rejected add never leaves an
  // orphaned asset behind in .vref/screenshots/.
  const manifest = await readManifest(paths.manifestPath);
  if (manifest.screenshots.some((screenshot) => screenshot.id === options.draft.id)) {
    throw new VrefError(
      "VREF_MANIFEST_DUPLICATE_ID",
      `manifest already has screenshot id "${options.draft.id}"`,
    );
  }

  const file = targetFile(options.draft);
  const assetPath = join(paths.vrefDir, file);
  await assertNoSymlinkInPath(paths.vrefDir, assetPath, "screenshot asset");
  await assertWritableTarget(assetPath, file, options.force);

  const sourcePath = resolve(options.cwd, options.sourcePath);
  const sourceBytes = await sourceSize(sourcePath);
  const encoded = await encodeWebp({ sourcePath, quality: options.quality });
  const capturedAt = options.draft.capturedAt ?? (await capturedAtFromSource(sourcePath));

  const screenshot = screenshotFromJson(
    {
      id: options.draft.id,
      title: options.draft.title,
      group: options.draft.group,
      platform: options.draft.platform,
      device: options.draft.device,
      viewport: options.draft.viewport ?? { width: encoded.width, height: encoded.height },
      file,
      capturedAt,
      sizeBytes: encoded.data.byteLength,
      tags: options.draft.tags ?? [],
      notes: options.draft.notes ?? [],
    },
    "screenshot",
  ) satisfies VrefScreenshot;

  if (!options.dryRun) {
    await writeAsset(paths.vrefDir, assetPath, encoded.data);
  }

  const added = await addScreenshot({
    cwd: options.cwd,
    dryRun: options.dryRun,
    manifestPath: options.manifestPath,
    screenshot,
  });

  return {
    dryRun: options.dryRun,
    file,
    manifestPath: added.manifestPath,
    reencoded: encoded.reencoded,
    screenshot,
    screenshotCount: added.screenshotCount,
    sourceBytes,
    sourcePath,
  };
}

export async function writeAsset(rootPath: string, assetPath: string, data: Buffer): Promise<void> {
  await assertNoSymlinkInPath(rootPath, assetPath, "screenshot asset");
  await mkdir(dirname(assetPath), { recursive: true });
  await assertNoSymlinkInPath(rootPath, assetPath, "screenshot asset");
  await writeFile(assetPath, data);
}

function targetFile(draft: VrefScreenshotDraft): string {
  const file = safeManifestAssetPath(
    draft.file ?? `screenshots/${draft.id}${WEBP_EXTENSION}`,
    "screenshot file",
  );
  assertSupportedImage(file);

  if (!isWebpFile(file)) {
    throw new VrefError(
      "VREF_UNSUPPORTED_IMAGE",
      `vref writes webp only, so screenshot file must end in ${WEBP_EXTENSION}: ${file}`,
    );
  }

  return file;
}

async function assertWritableTarget(
  assetPath: string,
  file: string,
  force: boolean,
): Promise<void> {
  if (force) {
    return;
  }

  try {
    await stat(assetPath);
  } catch {
    return;
  }

  throw new VrefError(
    "VREF_ASSET_EXISTS",
    `screenshot asset already exists, pass --force to replace it: ${file}`,
  );
}

async function sourceSize(sourcePath: string): Promise<number> {
  try {
    const stats = await stat(sourcePath);

    return stats.size;
  } catch (error) {
    throw new VrefError(
      "VREF_IMAGE_READ_FAILED",
      `could not read source image ${sourcePath}: ${messageFrom(error)}`,
    );
  }
}

async function capturedAtFromSource(sourcePath: string): Promise<string> {
  try {
    const stats = await stat(sourcePath);

    return stats.mtime.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
