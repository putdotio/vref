import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { writeFileAtomically } from "../src/atomic-write.js";
import { serve } from "../src/serve.js";

// Replaces a file the moment the server first touches it, so a request lands
// in the gap between reading its size and reading its bytes every time.
const replacement = vi.hoisted(() => ({
  pending: undefined as { path: string; run: () => Promise<void> } | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const afterTouch =
    <Args extends [unknown, ...unknown[]], Result>(call: (...args: Args) => Promise<Result>) =>
    async (...args: Args): Promise<Result> => {
      const result = await call(...args);
      const pending = replacement.pending;
      if (pending !== undefined && String(args[0]) === pending.path) {
        replacement.pending = undefined;
        await pending.run();
      }
      return result;
    };

  return { ...actual, open: afterTouch(actual.open), stat: afterTouch(actual.stat) };
});

describe("serve snapshots", () => {
  it("sends the length and body of one version when the gallery is replaced mid-request", async () => {
    const root = await mkdtemp(join(tmpdir(), "vref-snapshot-"));
    await mkdir(join(root, ".vref"));
    const gallery = join(root, ".vref/index.html");
    const previous = "<html>previous gallery</html>";
    await writeFile(gallery, previous);

    const response = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* serve({ cwd: root, dir: ".vref", host: "127.0.0.1", port: 0 });
          const path = yield* Effect.promise(() => realpath(gallery));
          replacement.pending = {
            path,
            // Longer than before, as `vref build` replacing it would be.
            run: () => writeFileAtomically(path, "<html>a rebuilt and longer gallery</html>"),
          };

          return yield* Effect.promise(() => get(result.port, "/index.html"));
        }),
      ),
    );

    expect(replacement.pending).toBeUndefined();
    expect(response.contentLength).toBe(String(Buffer.byteLength(response.body)));
    expect(response.body).toBe(previous);
  });
});

async function get(
  port: number,
  path: string,
): Promise<{ body: string; contentLength: string | undefined }> {
  return await new Promise((resolve, reject) => {
    const call = request({ host: "127.0.0.1", port, path, agent: false }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () =>
        resolve({
          body: Buffer.concat(chunks).toString("utf8"),
          contentLength: response.headers["content-length"],
        }),
      );
    });
    call.on("error", reject);
    call.end();
  });
}
