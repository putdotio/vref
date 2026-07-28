import { stat } from "node:fs/promises";
import { VrefError } from "./errors.js";
import { readManifestDocument, screenshotFromJson, writeManifestDocument } from "./manifest.js";
import { assertNoSymlinkInPath, resolveManifestAssetPath, workspacePaths } from "./path-safety.js";
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
  const { document, manifest } = await readManifestDocument(paths.manifestPath);

  if (manifest.screenshots.some((screenshot) => screenshot.id === options.screenshot.id)) {
    throw new VrefError(
      "VREF_MANIFEST_DUPLICATE_ID",
      `manifest already has screenshot id "${options.screenshot.id}"`,
    );
  }

  const assetPath = resolveManifestAssetPath(
    paths.cwd,
    paths.vrefDir,
    options.screenshot.file,
    "screenshot asset",
  );
  const assetExists = await screenshotAssetExists(paths.cwd, assetPath);
  const nextScreenshots = [...readRawScreenshots(document), options.screenshot];
  const nextDocument = {
    ...document,
    screenshots: nextScreenshots,
  };

  if (!options.dryRun) {
    await writeManifestDocument(paths.manifestPath, nextDocument);
  }

  return {
    assetExists,
    dryRun: options.dryRun,
    manifestPath: paths.manifestPath,
    screenshot: options.screenshot,
    screenshotCount: nextScreenshots.length,
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

function readRawScreenshots(document: Record<string, unknown>): unknown[] {
  if (Array.isArray(document.screenshots)) {
    return document.screenshots;
  }

  throw new VrefError("VREF_MANIFEST_SCHEMA_INVALID", "manifest:screenshots must be an array");
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
