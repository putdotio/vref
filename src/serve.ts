import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";
import { pipeline } from "node:stream/promises";
import { Effect } from "effect";
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

type RunningServer = {
  result: ServeResult;
  server: Server;
};

export const serve = Effect.fn("vref.serve")(function* (options: ServeOptions) {
  const root = yield* Effect.try({
    try: () => resolveInsideCwd(options.cwd, options.dir, "serve dir"),
    catch: normalizeServeError,
  });
  const rootStats = yield* Effect.tryPromise({
    try: () => stat(root),
    catch: (cause) =>
      new VrefError(
        "VREF_SERVE_DIR_READ_FAILED",
        `serve dir could not be read: ${messageFrom(cause)}`,
      ),
  });

  if (!rootStats.isDirectory()) {
    return yield* new VrefError(
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
      await pipeline(createReadStream(filePath), response);
    } catch (error) {
      if (error instanceof VrefError && error.code === "VREF_BAD_SERVE_PATH") {
        response.writeHead(400);
        response.end("Bad request");
        return;
      }
      if (response.headersSent) {
        response.destroy();
      } else {
        response.writeHead(404);
        response.end("Not found");
      }
    }
  });

  const running = yield* Effect.acquireRelease(listen(server, root, options), ({ server }) =>
    closeServer(server),
  );

  return running.result;
});

const listen = Effect.fn("vref.serve.listen")(
  (server: Server, root: string, options: ServeOptions) =>
    Effect.callback<RunningServer, VrefError>((resume) => {
      const onError = (cause: Error): void => {
        tryCloseServer(server);
        resume(
          Effect.fail(
            new VrefError("VREF_SERVE_LISTEN_FAILED", `server could not listen: ${cause.message}`),
          ),
        );
      };

      server.once("error", onError);
      server.listen(options.port, options.host, () => {
        server.off("error", onError);
        const address = server.address();
        if (typeof address !== "object" || address === null) {
          server.close();
          resume(
            Effect.fail(
              new VrefError("VREF_SERVE_LISTEN_FAILED", "server did not expose a TCP address"),
            ),
          );
          return;
        }

        const result = {
          dir: root,
          host: options.host,
          port: address.port,
          url: `http://${options.host}:${address.port}/`,
        };
        resume(Effect.succeed({ result, server }));
      });

      return Effect.sync(() => {
        server.off("error", onError);
        tryCloseServer(server);
      });
    }),
);

function closeServer(server: Server): Effect.Effect<void> {
  return Effect.callback<void>((resume) => {
    if (!server.listening) {
      resume(Effect.void);
      return;
    }

    let completed = false;
    const complete = (): void => {
      if (!completed) {
        completed = true;
        resume(Effect.void);
      }
    };

    try {
      server.close(complete);
      server.closeAllConnections();
    } catch {
      complete();
    }
  });
}

function tryCloseServer(server: Server): void {
  try {
    server.close();
  } catch {
    return;
  }
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

function normalizeServeError(error: unknown): VrefError {
  return error instanceof VrefError
    ? error
    : new VrefError("VREF_SERVE_START_FAILED", messageFrom(error));
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
