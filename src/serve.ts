import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { isIP } from "node:net";
import { extname, join, normalize } from "node:path";
import { pipeline } from "node:stream/promises";
import { Effect } from "effect";
import { VrefError, messageFrom } from "./errors.js";
import { assertNoSymlinkInPath, realPathInside, resolveInsideCwd } from "./path-safety.js";

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
  yield* Effect.tryPromise({
    // resolveInsideCwd is lexical, so it cannot see a symlinked serve root.
    // Without this, stat() follows the link and realPathInside then measures
    // containment against its target, serving whatever lives there.
    try: () => assertNoSymlinkInPath(options.cwd, root, "serve dir"),
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
    // A long-running local server is reachable from any page the developer has
    // open unless it checks who the request thinks it is talking to. The
    // gallery is UI evidence that may carry account state, so refuse a Host
    // this server was not started on.
    if (!isAllowedHost(request.headers.host, options.host)) {
      response.writeHead(403, securityHeaders());
      response.end("Forbidden");
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { ...securityHeaders(), allow: "GET, HEAD" });
      response.end("Method not allowed");
      return;
    }

    let decodedPath: string;
    try {
      // Only pathname is read, so the base host is arbitrary. A fixed one keeps
      // a bare IPv6 literal from producing an unparseable URL whose throw would
      // be caught below and answered as 400 for every request.
      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      decodedPath = decodeURIComponent(requestUrl.pathname);
    } catch {
      response.writeHead(400, securityHeaders());
      response.end("Bad request");
      return;
    }

    const relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);

    try {
      const filePath = await resolveServableFile(root, relativePath);
      const fileStats = await stat(filePath);
      if (!fileStats.isFile()) {
        response.writeHead(404, securityHeaders());
        response.end("Not found");
        return;
      }

      response.writeHead(200, {
        ...securityHeaders(),
        "content-type": contentType(filePath),
        "content-length": String(fileStats.size),
      });

      // HEAD carries the headers and nothing else.
      if (request.method === "HEAD") {
        response.end();
        return;
      }

      await pipeline(createReadStream(filePath), response);
    } catch (error) {
      if (error instanceof VrefError && error.code === "VREF_BAD_SERVE_PATH") {
        response.writeHead(400, securityHeaders());
        response.end("Bad request");
        return;
      }
      if (response.headersSent) {
        response.destroy();
      } else {
        // A missing file lands here rather than in the isFile() branch above,
        // so this is the common 404 and needs the same headers.
        response.writeHead(404, securityHeaders());
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
          url: `http://${formatHost(options.host)}:${address.port}/`,
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

/**
 * Headers every response carries.
 *
 * `nosniff` matters because an unknown extension under the served directory
 * falls back to application/octet-stream, which a browser would otherwise be
 * free to reinterpret. The policy keeps a rendered gallery from reaching the
 * network; it permits inline style and script because that is exactly what
 * `vref build` emits.
 */
function securityHeaders(): Record<string, string> {
  return {
    "x-content-type-options": "nosniff",
    "content-security-policy":
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://static.put.io; font-src https://static.put.io; script-src 'self' 'unsafe-inline'",
  };
}

/**
 * Whether a request's Host names the server we actually started.
 *
 * Anything else is a name that merely resolves here, which is the shape of a
 * rebinding request rather than a developer opening the printed url.
 */
function isAllowedHost(requestHost: string | undefined, boundHost: string): boolean {
  if (requestHost === undefined) {
    return false;
  }

  const hostname = canonicalHost(requestHost.replace(/:\d+$/u, ""));
  const bound = canonicalHost(boundHost);

  // A server bound to every interface has no single name to check against.
  if (bound === "0.0.0.0" || bound === "::" || bound === "") {
    return true;
  }

  const loopback = new Set(["127.0.0.1", "localhost", "::1"]);

  return hostname === bound || (loopback.has(bound) && loopback.has(hostname));
}

/**
 * Fold a host to one spelling.
 *
 * `0:0:0:0:0:0:0:1` and `::1` are the same address, and a URL client sends the
 * canonical form in Host. Comparing the text the user typed would 403 a request
 * to the very url `vref serve` printed.
 */
function canonicalHost(host: string): string {
  const bare = host.replace(/^\[|\]$/gu, "").toLowerCase();

  if (isIP(bare) !== 6) {
    return bare;
  }

  try {
    return new URL(`http://[${bare}]`).hostname.replace(/^\[|\]$/gu, "");
  } catch {
    return bare;
  }
}

/**
 * Bracket an IPv6 literal so it can carry a port.
 *
 * `http://::1:4173/` is not a URL. A hostname or IPv4 address never contains a
 * colon, so the colon is the whole test.
 */
function formatHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
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
