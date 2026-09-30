import { chmod, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { hasErrorCode } from "./errors.js";

/**
 * Replace a file in one step.
 *
 * A direct write truncates before it writes, so a failure partway — ENOSPC, an
 * I/O error — leaves the file empty or half-written, and a reader such as
 * `vref serve` can open it in that state. Writing a sibling and renaming means
 * the file is either the old one or the new one, never a fragment, and removes
 * any need to keep a copy around to restore.
 */
export async function writeFileAtomically(path: string, contents: string): Promise<void> {
  const mode = await existingMode(path);
  // Unpredictable name plus an exclusive create: a guessable sibling could be
  // pre-planted as a symlink, and a plain write would follow it out of the
  // workspace and then rename the link itself into place as the target.
  const temporaryPath = `${path}.${randomBytes(8).toString("hex")}.tmp`;

  try {
    // Created at its final mode, not widened and tightened afterwards: the
    // gap between the two would hold a complete private file that anyone
    // reading the directory could open.
    await writeFile(temporaryPath, contents, { flag: "wx", mode: mode ?? 0o666 });
    if (mode !== undefined) {
      // umask can only clear bits at creation, so restore the exact mode.
      await chmod(temporaryPath, mode);
    }
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function existingMode(path: string): Promise<number | undefined> {
  try {
    const stats = await stat(path);

    return stats.mode & 0o777;
  } catch (error) {
    // Only a missing file has no mode to carry over. Guessing after any other
    // failure risks publishing a private file at the default mode.
    if (hasErrorCode(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }
}
