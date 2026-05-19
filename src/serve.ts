import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { VrefError } from "./errors.js";
import { realPathInside, resolveInsideCwd } from "./path-safety.js";

export type ServeOptions = {
  cwd: string;
  dir: string;
  host: string;
  port: number;
};

export type ServeResult = {
  dir: string;
  host: string;
  port: number;
  url: string;
};

export async function serve(options: ServeOptions): Promise<ServeResult> {
  const root = resolveInsideCwd(options.cwd, options.dir, "serve dir");
  const rootStats = await stat(root);

  if (!rootStats.isDirectory()) {
    throw new VrefError(
      "VREF_SERVE_DIR_NOT_DIRECTORY",
      `serve dir is not a directory: ${options.dir}`,
    );
  }

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

    const relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);

    try {
      const filePath = await resolveServableFile(root, relativePath);
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

  const url = `http://${options.host}:${options.port}/`;

  return {
    dir: root,
    host: options.host,
    port: options.port,
    url,
  };
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
