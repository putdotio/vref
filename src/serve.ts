import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { VrefError } from "./errors.js";
import { readManifest } from "./manifest.js";
import {
  assertNoSymlinkInPath,
  realPathInside,
  resolveInsideCwd,
  resolveManifestAssetPath,
  workspacePaths,
} from "./path-safety.js";

export type ServeOptions = {
  cwd: string;
  dir: string;
  host: string;
  manifestPath: string;
  port: number;
};

export type ServeResult = {
  dir: string;
  host: string;
  port: number;
  url: string;
  /** Stop listening. Not part of the CLI's JSON output. */
  close: () => Promise<void>;
};

export async function serve(options: ServeOptions): Promise<ServeResult> {
  const serveDir = resolveInsideCwd(options.cwd, options.dir, "serve dir");
  const rootStats = await stat(serveDir);

  if (!rootStats.isDirectory()) {
    throw new VrefError(
      "VREF_SERVE_DIR_NOT_DIRECTORY",
      `serve dir is not a directory: ${options.dir}`,
    );
  }

  // Assets may live outside the serve directory. When they do, serve from the
  // working tree instead and allow exactly the manifest's assets through — a
  // narrower surface than the serve directory itself, which is served wholesale.
  const assets = await manifestAssets(options.cwd, options.manifestPath);
  const escapingAssets = assets.filter((asset) => !isInside(serveDir, asset));
  const root = escapingAssets.length > 0 ? resolveInsideCwd(options.cwd, ".", "cwd") : serveDir;
  const indexPath = join(serveDir, "index.html");
  const indexUrl = root === serveDir ? "/" : `/${toUrlPath(relative(root, indexPath))}`;

  // Served paths come back canonicalised, so canonicalise what we compare them
  // against — otherwise every check fails wherever the tree sits behind a
  // symlink, as macOS temp directories do.
  const realServeDir = await realpathOrSelf(serveDir);
  const allowedAssets = new Set(
    await Promise.all(escapingAssets.map((asset) => realpathOrSelf(asset))),
  );

  const server = createServer(async (request, response) => {
    let decodedPath: string;
    try {
      const requestUrl = new URL(request.url ?? "/", `http://${options.host}:${options.port}`);
      decodedPath = decodeURIComponent(requestUrl.pathname);
    } catch {
      response.writeHead(400);
      response.end("Bad request");
      return;
    }

    // A gallery whose assets sit above the serve directory only resolves its
    // relative hrefs from the real index URL, so send visitors there.
    if (decodedPath === "/" && indexUrl !== "/") {
      response.writeHead(302, { location: indexUrl });
      response.end();
      return;
    }

    const relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);

    try {
      const filePath = await resolveServableFile(root, relativePath);
      if (!isInside(realServeDir, filePath) && !allowedAssets.has(filePath)) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      const fileStats = await stat(filePath);
      if (!fileStats.isFile()) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      response.writeHead(200, { "content-type": contentType(filePath) });
      createReadStream(filePath).pipe(response);
    } catch (error) {
      if (error instanceof VrefError && error.code === "VREF_BAD_SERVE_PATH") {
        response.writeHead(400);
        response.end("Bad request");
        return;
      }
      response.writeHead(404);
      response.end("Not found");
    }
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(options.port, options.host, () => {
      server.off("error", rejectPromise);
      resolvePromise();
    });
  });

  // Port 0 asks the OS to pick a free port; report what it actually bound.
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : options.port;

  return {
    dir: root,
    host: options.host,
    port,
    url: `http://${options.host}:${port}${indexUrl}`,
    close: () =>
      new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => {
          if (error) {
            rejectPromise(error);
            return;
          }
          resolvePromise();
        });
      }),
  };
}

async function manifestAssets(cwd: string, manifestPath: string): Promise<string[]> {
  let paths: ReturnType<typeof workspacePaths>;
  try {
    paths = workspacePaths(cwd, manifestPath);
  } catch {
    return [];
  }

  let manifest: Awaited<ReturnType<typeof readManifest>>;
  try {
    manifest = await readManifest(paths.manifestPath);
  } catch {
    // `serve` is allowed to serve a plain directory; an absent or unreadable
    // manifest is `build` and `validate`'s problem to report, not this one's.
    return [];
  }

  const assets: string[] = [];

  for (const screenshot of manifest.screenshots) {
    const assetPath = resolveManifestAssetPath(
      paths.cwd,
      paths.vrefDir,
      screenshot.file,
      "screenshot asset",
    );
    // An unsafe path is not a tolerable manifest defect: without this, a
    // manifest entry symlinked at, say, `.env` would put that file's canonical
    // path in the allowlist and serve it. Refuse to start instead.
    await assertNoSymlinkInPath(paths.cwd, assetPath, "screenshot asset");
    assets.push(assetPath);
  }

  return assets;
}

async function realpathOrSelf(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

function isInside(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);

  if (relativePath === "" || isAbsolute(relativePath)) {
    return false;
  }

  // Only a real parent segment escapes; a name that merely starts with two dots
  // (`..assets/`) is an ordinary child.
  return relativePath !== ".." && !relativePath.startsWith(`..${sep}`);
}

/** Percent-encode each segment so path characters cannot become URL syntax. */
function toUrlPath(value: string): string {
  return value
    .split(sep)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export async function resolveServableFile(root: string, relativePath: string): Promise<string> {
  const normalizedPath = normalize(relativePath);

  if (normalizedPath.startsWith("..") || normalizedPath.includes("/../")) {
    throw new VrefError("VREF_BAD_SERVE_PATH", "serve path must stay inside the serve root");
  }

  try {
    return await realPathInside(root, join(root, normalizedPath));
  } catch (error) {
    if (error instanceof VrefError && error.code === "VREF_PATH_OUTSIDE_ROOT") {
      throw new VrefError("VREF_BAD_SERVE_PATH", "serve path must stay inside the serve root");
    }
    throw error;
  }
}

function contentType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}
