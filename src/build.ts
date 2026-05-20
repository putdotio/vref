import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { VrefError } from "./errors.js";
import { readManifest } from "./manifest.js";
import { assertNoSymlinkInPath, resolveInsideCwd, workspacePaths } from "./path-safety.js";
import { renderGallery } from "./render.js";
import type { VrefBuildResult, VrefValidateResult } from "./types.js";

export type BuildGalleryOptions = {
  cwd: string;
  manifestPath: string;
  outputPath: string;
};

export async function buildGallery(options: BuildGalleryOptions): Promise<VrefBuildResult> {
  const paths = workspacePaths(options.cwd, options.manifestPath);
  const outputPath = resolveInsideCwd(paths.cwd, options.outputPath, "output");
  const validation = await validateGallery({
    cwd: options.cwd,
    manifestPath: options.manifestPath,
  });
  const manifest = await readManifest(paths.manifestPath);

  await assertNoSymlinkInPath(paths.cwd, outputPath, "output");
  await mkdir(dirname(outputPath), { recursive: true });
  await assertNoSymlinkInPath(paths.cwd, outputPath, "output");
  await writeFile(outputPath, renderGallery(manifest, { manifestLabel: options.manifestPath }));

  return {
    manifestPath: validation.manifestPath,
    outputPath,
    screenshotCount: validation.screenshotCount,
    groupCount: validation.groupCount,
    deviceCount: validation.deviceCount,
  };
}

export async function validateGallery(options: {
  cwd: string;
  manifestPath: string;
}): Promise<VrefValidateResult> {
  const paths = workspacePaths(options.cwd, options.manifestPath);
  const manifest = await readManifest(paths.manifestPath);

  for (const screenshot of manifest.screenshots) {
    const assetPath = join(paths.vrefDir, screenshot.file);
    await assertNoSymlinkInPath(paths.vrefDir, assetPath, "screenshot asset");
    try {
      const assetStats = await stat(assetPath);
      if (!assetStats.isFile()) {
        throw new VrefError(
          "VREF_ASSET_NOT_FILE",
          `screenshot asset is not a file: ${screenshot.file}`,
        );
      }
    } catch (error) {
      if (error instanceof VrefError) {
        throw error;
      }
      throw new VrefError("VREF_ASSET_MISSING", `screenshot asset is missing: ${screenshot.file}`);
    }
  }

  return {
    manifestPath: paths.manifestPath,
    screenshotCount: manifest.screenshots.length,
    groupCount: new Set(manifest.screenshots.map((screenshot) => screenshot.group)).size,
    deviceCount: new Set(manifest.screenshots.map((screenshot) => screenshot.device)).size,
  };
}
