import { lstat, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { VrefError } from "./errors.js";

export type WorkspacePaths = {
  cwd: string;
  manifestPath: string;
  vrefDir: string;
};

export function workspacePaths(cwd: string, manifestPath: string): WorkspacePaths {
  const resolvedCwd = resolve(cwd);
  const resolvedManifest = resolveInsideCwd(resolvedCwd, manifestPath, "manifest");

  return {
    cwd: resolvedCwd,
    manifestPath: resolvedManifest,
    vrefDir: dirname(resolvedManifest),
  };
}

export function resolveInsideCwd(cwd: string, candidatePath: string, label: string): string {
  if (hasControlCharacter(candidatePath)) {
    throw new VrefError("VREF_UNSAFE_PATH", `${label} path contains a control character`);
  }

  const resolved = resolve(cwd, candidatePath);
  const relativePath = relative(cwd, resolved);

  if (relativePath === "" || isSubpath(relativePath)) {
    return resolved;
  }

  throw new VrefError(
    "VREF_PATH_OUTSIDE_CWD",
    `${label} path must stay inside the current working tree`,
  );
}

export function safeManifestAssetPath(filePath: string, label: string): string {
  if (hasControlCharacter(filePath)) {
    throw new VrefError("VREF_UNSAFE_ASSET_PATH", `${label} contains a control character`);
  }

  if (isAbsolute(filePath)) {
    throw new VrefError("VREF_UNSAFE_ASSET_PATH", `${label} must be relative`);
  }

  if (filePath.includes("?") || filePath.includes("#")) {
    throw new VrefError(
      "VREF_UNSAFE_ASSET_PATH",
      `${label} must not contain query strings or hash fragments`,
    );
  }

  if (filePath.includes(":")) {
    throw new VrefError(
      "VREF_UNSAFE_ASSET_PATH",
      `${label} must not contain URL schemes or drive prefixes`,
    );
  }

  const lower = filePath.toLowerCase();
  if (lower.includes("%2e") || lower.includes("%2f") || lower.includes("%5c")) {
    throw new VrefError(
      "VREF_UNSAFE_ASSET_PATH",
      `${label} must not contain encoded traversal segments`,
    );
  }

  const normalized = filePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new VrefError(
      "VREF_UNSAFE_ASSET_PATH",
      `${label} must not contain empty or traversal segments`,
    );
  }

  return normalized;
}

export function assertSupportedImage(filePath: string): void {
  const extension = extname(filePath).toLowerCase();
  if (
    extension !== ".jpg" &&
    extension !== ".jpeg" &&
    extension !== ".png" &&
    extension !== ".webp"
  ) {
    throw new VrefError(
      "VREF_UNSUPPORTED_IMAGE",
      `image must be .jpg, .jpeg, .png, or .webp: ${filePath}`,
    );
  }
}

export async function assertNoSymlinkInPath(
  rootPath: string,
  candidatePath: string,
  label: string,
): Promise<void> {
  const root = resolve(rootPath);
  const candidate = resolve(candidatePath);
  const relativePath = relative(root, candidate);

  if (relativePath !== "" && !isSubpath(relativePath)) {
    throw new VrefError("VREF_PATH_OUTSIDE_ROOT", `${label} must stay inside its root directory`);
  }

  let current = root;
  await rejectSymlink(current, label);

  if (relativePath === "") {
    return;
  }

  for (const segment of relativePath.split(sep)) {
    current = resolve(current, segment);

    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        throw new VrefError("VREF_SYMLINK_PATH", `${label} must not use symlinks`);
      }
      if (current !== candidate && !stats.isDirectory()) {
        throw new VrefError("VREF_PATH_NOT_DIRECTORY", `${label} parent is not a directory`);
      }
    } catch (error) {
      if (error instanceof VrefError) {
        throw error;
      }
      if (hasErrorCode(error, "ENOENT")) {
        return;
      }
      throw new VrefError("VREF_PATH_CHECK_FAILED", `${label} path could not be checked`);
    }
  }
}

export async function realPathInside(rootPath: string, candidatePath: string): Promise<string> {
  const root = await realpath(rootPath);
  const candidate = await realpath(candidatePath);
  const relativePath = relative(root, candidate);

  if (relativePath === "" || isSubpath(relativePath)) {
    return candidate;
  }

  throw new VrefError("VREF_PATH_OUTSIDE_ROOT", "real path must stay inside its root directory");
}

function isSubpath(relativePath: string): boolean {
  return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);

    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

async function rejectSymlink(path: string, label: string): Promise<void> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      throw new VrefError("VREF_SYMLINK_PATH", `${label} must not use symlinks`);
    }
  } catch (error) {
    if (error instanceof VrefError) {
      throw error;
    }
    if (hasErrorCode(error, "ENOENT")) {
      return;
    }
    throw new VrefError("VREF_PATH_CHECK_FAILED", `${label} path could not be checked`);
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
