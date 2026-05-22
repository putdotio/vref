import { stat } from "node:fs/promises";
import { join } from "node:path";
import { VrefError } from "./errors.js";
import { readManifest, screenshotFromJson, writeManifest } from "./manifest.js";
import { assertNoSymlinkInPath, workspacePaths } from "./path-safety.js";
import type { VrefManifestAddResult, VrefScreenshot } from "./types.js";

export type AddScreenshotOptions = {
  cwd: string;
  dryRun: boolean;
  manifestPath: string;
  screenshot: VrefScreenshot;
};

export async function addScreenshot(options: AddScreenshotOptions): Promise<VrefManifestAddResult> {
  const paths = workspacePaths(options.cwd, options.manifestPath);
  await assertNoSymlinkInPath(paths.cwd, paths.manifestPath, "manifest");
  const manifest = await readManifest(paths.manifestPath);

  if (manifest.screenshots.some((screenshot) => screenshot.id === options.screenshot.id)) {
    throw new VrefError(
      "VREF_MANIFEST_DUPLICATE_ID",
      `manifest already has screenshot id "${options.screenshot.id}"`,
    );
  }

  const assetPath = join(paths.vrefDir, options.screenshot.file);
  const assetExists = await screenshotAssetExists(paths.vrefDir, assetPath);
  const nextManifest = {
    ...manifest,
    screenshots: [...manifest.screenshots, options.screenshot],
  };

  if (!options.dryRun) {
    await writeManifest(paths.manifestPath, nextManifest);
  }

  return {
    assetExists,
    dryRun: options.dryRun,
    manifestPath: paths.manifestPath,
    screenshot: options.screenshot,
    screenshotCount: nextManifest.screenshots.length,
  };
}

export function decodeScreenshotJson(rawJson: string): VrefScreenshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    throw new VrefError(
      "VREF_JSON_INVALID",
      `--json must contain valid screenshot JSON: ${messageFrom(error)}`,
    );
  }

  return screenshotFromJson(parsed, "--json");
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

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
