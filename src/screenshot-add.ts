import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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

  // Even --force must not take a file another entry points at: overwriting it
  // swaps the image under that entry while its sizeBytes and viewport keep
  // describing the old one, and validate still passes because the file exists.
  const claimant = manifest.screenshots.find(
    (screenshot) =>
      screenshot.file.normalize("NFC").toLowerCase() === file.normalize("NFC").toLowerCase(),
  );
  if (claimant !== undefined) {
    throw new VrefError(
      "VREF_ASSET_CLAIMED",
      `screenshot "${claimant.id}" already references ${file}`,
    );
  }

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

  // The asset has to land before the manifest can reference it, so if the
  // manifest write then fails the asset is rolled back: either removed, or
  // restored to the bytes --force was about to replace. Otherwise a retry hits
  // VREF_ASSET_EXISTS against a file no manifest entry knows about.
  const replaced = options.dryRun ? undefined : await readReplacedAsset(assetPath);

  let added;
  try {
    // The write is inside the rollback too: --force truncates an existing asset
    // before writing it, so a failure mid-write would otherwise leave a corrupt
    // file that manifest entries still point at.
    if (!options.dryRun) {
      await writeAsset(paths.vrefDir, assetPath, encoded.data);
    }

    added = await addScreenshot({
      cwd: options.cwd,
      dryRun: options.dryRun,
      manifestPath: options.manifestPath,
      screenshot,
    });
  } catch (error) {
    if (!options.dryRun) {
      await restoreAsset(paths.vrefDir, assetPath, replaced);
    }
    throw error;
  }

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

async function readReplacedAsset(assetPath: string): Promise<Buffer | undefined> {
  try {
    return await readFile(assetPath);
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

async function restoreAsset(
  rootPath: string,
  assetPath: string,
  replaced: Buffer | undefined,
): Promise<void> {
  try {
    if (replaced === undefined) {
      await rm(assetPath, { force: true });
      return;
    }

    await writeAsset(rootPath, assetPath, replaced);
  } catch {
    // The original failure is the one worth reporting; a failed rollback must
    // not mask it.
    return;
  }
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

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
