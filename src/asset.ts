import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { hasErrorCode } from "./errors.js";
import { assertNoSymlinkInPath } from "./path-safety.js";

/**
 * Write a screenshot asset inside its root.
 *
 * The symlink check runs on both sides of the mkdir: the directory may not
 * exist yet on the first pass, and creating it is the moment a planted link
 * could appear.
 */
export async function writeAsset(rootPath: string, assetPath: string, data: Buffer): Promise<void> {
  await assertNoSymlinkInPath(rootPath, assetPath, "screenshot asset");
  await mkdir(dirname(assetPath), { recursive: true });
  await assertNoSymlinkInPath(rootPath, assetPath, "screenshot asset");
  await writeFile(assetPath, data);
}

/**
 * The bytes currently at a path, or undefined when nothing is there.
 *
 * Only a missing file means there is nothing to put back. Any other read
 * failure must abort before the target is registered or touched, or a rollback
 * would delete a file that was already there.
 */
export async function readAssetIfExists(assetPath: string): Promise<Buffer | undefined> {
  try {
    return await readFile(assetPath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }
}

/**
 * Put a registered asset back the way it was.
 *
 * A failed rollback must not mask the original error, which is the one worth
 * reporting, so every failure here is swallowed.
 */
export async function restoreAsset(
  rootPath: string,
  assetPath: string,
  previous: Buffer | undefined,
): Promise<void> {
  try {
    if (previous === undefined) {
      await rm(assetPath, { force: true });
      return;
    }

    await writeAsset(rootPath, assetPath, previous);
  } catch {
    return;
  }
}

/**
 * Compare paths the way the filesystem will.
 *
 * macOS and Windows fold case, and macOS also folds Unicode normalization, so
 * `café.png` typed as NFC and as NFD are one file there and two on Linux.
 * `.vref/` is committed and checked out on all of them, so comparisons use the
 * most forgiving form and any ambiguity is refused rather than resolved.
 */
export function pathKey(path: string): string {
  return path.normalize("NFC").toLowerCase();
}
