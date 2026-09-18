import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathKey } from "./asset.js";
import { VrefError } from "./errors.js";
import { readManifest } from "./manifest.js";
import {
  assertNoSymlinkInPath,
  isSupportedImage,
  resolveInsideCwd,
  workspacePaths,
} from "./path-safety.js";
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
  // The per-asset check below covers the manifest directory, but only once the
  // loop runs: an empty screenshots array would otherwise skip every check.
  await assertNoSymlinkInPath(paths.cwd, paths.manifestPath, "manifest");
  const manifest = await readManifest(paths.manifestPath);

  const referenced = new Set<string>();

  for (const screenshot of manifest.screenshots) {
    const assetPath = join(paths.manifestDir, screenshot.file);
    await assertNoSymlinkInPath(paths.manifestDir, assetPath, "screenshot asset");
    referenced.add(screenshot.file.replaceAll("\\", "/"));
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
    orphanAssets: await findOrphanAssets(paths.manifestDir, referenced),
  };
}

/**
 * Image files under the manifest directory that no entry references.
 *
 * Reported rather than refused: a repo mid-curation legitimately holds a
 * capture it has not written an entry for yet, and failing would turn that into
 * a red build. Deleting an entry and leaving its webp behind is the case worth
 * naming, because nothing else ever will.
 */
async function findOrphanAssets(
  manifestDir: string,
  referenced: ReadonlySet<string>,
): Promise<string[]> {
  const found: string[] = [];

  const walk = async (relativeDir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(join(manifestDir, relativeDir), { withFileTypes: true });
    } catch {
      // An unreadable directory is not evidence of an orphan, and validate
      // already fails on any asset an entry actually names.
      return;
    }

    for (const entry of entries) {
      const relativePath = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;

      // readdir does not follow links, so a symlinked directory answers false
      // here and is never walked out of the manifest directory.
      if (entry.isDirectory()) {
        await walk(relativePath);
        continue;
      }

      if (!entry.isFile() || !isSupportedImage(relativePath)) {
        continue;
      }

      found.push(relativePath);
    }
  };

  await walk("");

  const present = new Set(found);
  const claims = new Map([...referenced].map((file) => [pathKey(file), file] as const));

  return found.filter((file) => isOrphan(file, present, referenced, claims)).sort();
}

/**
 * Whether a file on disk is claimed by no entry.
 *
 * An exact match settles it. A match that only holds once case and Unicode
 * normalization are folded is the hard case, and which answer is right depends
 * on the filesystem: `home.webp` and `HOME.webp` are two files on Linux and one
 * on macOS. Rather than probe the filesystem, ask whether the entry's own
 * spelling is in the listing. If it is, the entry means that file and this one
 * is a genuine leftover; if it is not, this file is what the entry resolves to.
 */
function isOrphan(
  file: string,
  present: ReadonlySet<string>,
  referenced: ReadonlySet<string>,
  claims: ReadonlyMap<string, string>,
): boolean {
  if (referenced.has(file)) {
    return false;
  }

  const claim = claims.get(pathKey(file));

  return claim === undefined || present.has(claim);
}
