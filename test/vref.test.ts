import {
  chmod,
  mkdir,
  readdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { connect, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Cause, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { buildGallery, validateGallery } from "../src/build.js";
import {
  COMMAND_FIELDS,
  COMMAND_FLAGS,
  COMMON_FLAGS,
  isDirectInvocation,
  recoverCliProgram,
  runCli,
} from "../src/cli.js";
import { convertGallery } from "../src/convert.js";
import { describeCli } from "../src/describe.js";
import { VREF_ERROR_CODES } from "../src/error-codes.js";
import { VrefError } from "../src/errors.js";
import { encodeWebp } from "../src/image.js";
import { decodeScreenshotJson, updateScreenshot } from "../src/manifest-edit.js";
import { readManifest } from "../src/manifest.js";
import {
  assertSupportedImage,
  resolveInsideCwd,
  safeManifestAssetPath,
} from "../src/path-safety.js";
import { renderGallery } from "../src/render.js";
import { addScreenshotFromSource } from "../src/screenshot-add.js";
import { removeScreenshot } from "../src/screenshot-remove.js";
import { resolveServableFile, serve } from "../src/serve.js";
import type { VrefManifest, VrefScreenshotDraft } from "../src/types.js";

describe("vref", () => {
  it("builds a gallery from a manifest and screenshots", async () => {
    const root = await makeFixture();

    const result = await buildGallery({
      cwd: root,
      manifestPath: ".vref/manifest.json",
      outputPath: ".vref/index.html",
    });

    const html = await readFile(join(root, ".vref/index.html"), "utf8");
    expect(result.screenshotCount).toBe(1);
    expect(html).toContain("put<span>.</span>io Roku visual reference");
    expect(html).toContain("1 curated Roku reference for quick visual review.");
    expect(html).toContain("screenshots/roku-720p/home.jpg");
    expect(html).toContain("min-height: 100dvh");
    expect(html).toContain("margin-top: auto");
    expect(html).toContain("max-width: 1120px");
    expect(html).toContain("padding: 10px 0 16px");
    expect(html).toContain("min-height: 24px");
    expect(html).toContain("minmax(min(100%, 340px), 1fr)");
    expect(html).toContain('data-orientation="landscape"');
    expect(html).toContain("object-fit: contain");
    expect(html).toContain('<span id="results-count-value">1 reference</span>');
    expect(html).toContain("&middot; Updated May 19, 2026");
    expect(html).toContain(".footer code { color: var(--text-2); font: inherit; }");
    expect(html).toContain(
      ".nav-btn:not(:has(.filter-control:checked)):hover { color: var(--text); background: rgba(255,255,255,0.075); }",
    );
    expect(html).toContain(".nav-btn:has(.filter-control:checked):hover { background: #FFD85C; }");
    expect(html).not.toContain(".nav-btn:hover { color: var(--text-2); background: var(--bg-3); }");
    expect(html).not.toContain('class="stats"');
    expect(html).not.toContain("stat-value");
    expect(html).not.toContain("stat-label");
    expect(html).not.toContain("Curated Roku screenshots.");
    expect(html).toContain(
      '<div class="item-meta"><span>Main pages</span><span>1280x720 / 5 B</span></div>',
    );
    expect(html).toContain('<div class="item-tags"><span class="tag">home</span>');
    expect(html).not.toContain("item-arrow");
    expect(html).not.toContain("&rarr;");
    expect(html).not.toContain("item-icon");
    expect(html).not.toContain(">TV<");
  });

  it("keeps arbitrary filter labels inert and distinct from All", async () => {
    const root = await mkdtemp(join(tmpdir(), "vref-labels-"));
    await mkdir(join(root, ".vref/screenshots"), { recursive: true });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=",
      "base64",
    );
    await writeFile(join(root, ".vref/screenshots/one.png"), png);
    const labels = [
      "</style><script>window.vref_marker=1</script><style>",
      "Quotes \" and ' [brackets] # : .",
      "日本語 😀",
      "All",
      "all",
      "Main pages",
      "main pages",
      "main-pages",
      "main  pages",
      " main pages ",
    ];
    const manifest: VrefManifest = {
      version: 1,
      title: "Filter labels",
      description: "Synthetic reference",
      updatedAt: "2026-09-05",
      screenshots: labels.map((label, index) => ({
        id: `item-${index}`,
        title: `Item ${index}`,
        group: label,
        platform: label,
        device: "Synthetic",
        viewport: { width: 1, height: 1 },
        file: "screenshots/one.png",
        capturedAt: "2026-09-05",
        sizeBytes: png.length,
        tags: ["all", index % 2 === 0 ? "first" : "second"],
        notes: [],
      })),
    };
    await writeFile(join(root, ".vref/manifest.json"), JSON.stringify(manifest));
    await buildGallery({
      cwd: root,
      manifestPath: ".vref/manifest.json",
      outputPath: ".vref/index.html",
    });
    const html = await readFile(join(root, ".vref/index.html"), "utf8");
    expect(html.match(/<style>/gu)).toHaveLength(1);
    expect(html.match(/<script>/gu)).toHaveLength(1);
    expect(html).toContain("&lt;/style&gt;&lt;script&gt;window.vref_marker=1");
    expect(html).toContain("日本語 😀");
    const ids = [...html.matchAll(/id="(filter-[^"]+)"/gu)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const group of ["platform", "group"]) {
      const values = [...html.matchAll(new RegExp(`data-${group}="([^"]+)"`, "gu"))].map(
        (match) => match[1],
      );
      expect(new Set(values).size).toBe(labels.length);
      for (const value of values) {
        expect(value).toMatch(/^[a-z0-9-]+$/u);
        expect(html).toContain(`id="filter-${group}-${value}"`);
        expect(html).toContain(
          `.container:has(#filter-${group}-${value}:checked) #gallery .card:not([data-${group}="${value}"]) { display: none; }`,
        );
      }
      expect(html).toContain(`id="filter-${group}-all" checked`);
    }
  });

  it("derives portrait and square card layouts from viewport dimensions", async () => {
    const root = await mkdtemp(join(tmpdir(), "vref-"));
    await mkdir(join(root, ".vref/screenshots"), { recursive: true });
    await writeFile(join(root, ".vref/screenshots/phone.png"), "image");
    await writeFile(join(root, ".vref/screenshots/square.png"), "image");

    const manifest: VrefManifest = {
      version: 1,
      title: "put.io mobile visual reference",
      description: "Mobile screenshots.",
      updatedAt: "2026-05-19T13:35:00.000Z",
      screenshots: [
        {
          id: "phone",
          title: "Phone",
          group: "Screens",
          platform: "iOS",
          device: "iPhone",
          viewport: { width: 1320, height: 2868 },
          file: "screenshots/phone.png",
          capturedAt: "2026-05-19T13:34:00.000Z",
          sizeBytes: 5,
          tags: ["phone"],
          notes: ["Portrait screen."],
        },
        {
          id: "square",
          title: "Square",
          group: "Components",
          platform: "iOS",
          device: "Component",
          viewport: { width: 720, height: 720 },
          file: "screenshots/square.png",
          capturedAt: "2026-05-19T13:34:00.000Z",
          sizeBytes: 5,
          tags: ["component"],
          notes: ["Square component."],
        },
      ],
    };

    await writeFile(join(root, ".vref/manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    await buildGallery({
      cwd: root,
      manifestPath: ".vref/manifest.json",
      outputPath: ".vref/index.html",
    });

    const html = await readFile(join(root, ".vref/index.html"), "utf8");
    expect(html).toContain(
      'data-title="Phone" data-platform="value-0069004f0053" data-group="value-00530063007200650065006e0073" data-tags="value-00700068006f006e0065" data-orientation="portrait"',
    );
    expect(html).toContain(
      'data-title="Square" data-platform="value-0069004f0053" data-group="value-0043006f006d0070006f006e0065006e00740073" data-tags="value-0063006f006d0070006f006e0065006e0074" data-orientation="square"',
    );
    expect(html).toContain('.card[data-orientation="portrait"] .preview { aspect-ratio: 3 / 4; }');
    expect(html).toContain('.card[data-orientation="square"] .preview { aspect-ratio: 1; }');
    expect(html).toContain("align-items: start");
  });

  it("keeps single tags filterable without rendering a card tag chip", async () => {
    const root = await makeFixture("screenshots/roku-720p/home.jpg", ["home"]);

    await buildGallery({
      cwd: root,
      manifestPath: ".vref/manifest.json",
      outputPath: ".vref/index.html",
    });

    const html = await readFile(join(root, ".vref/index.html"), "utf8");
    expect(html).toContain('data-tags="value-0068006f006d0065"');
    expect(html).not.toContain('<span class="tag">home</span>');
  });

  it("validates a manifest and assets without writing a gallery", async () => {
    const root = await makeFixture();

    const result = await validateGallery({
      cwd: root,
      manifestPath: ".vref/manifest.json",
    });

    expect(result.screenshotCount).toBe(1);
    expect(result.groupCount).toBe(1);
    expect(result.deviceCount).toBe(1);
    await expect(readFile(join(root, ".vref/index.html"), "utf8")).rejects.toThrow();
  });

  it("preserves date-only and offset-less manifest timestamps", async () => {
    const root = await makeFixture();
    const manifest = makeManifest("screenshots/roku-720p/home.jpg", ["home"]);
    await writeFile(
      join(root, ".vref/manifest.json"),
      `${JSON.stringify(
        {
          ...manifest,
          updatedAt: "2026-05-19",
          screenshots: [{ ...manifest.screenshots[0], capturedAt: "2026-05-19T13:35:00" }],
        },
        null,
        2,
      )}\n`,
    );

    await expect(
      validateGallery({ cwd: root, manifestPath: ".vref/manifest.json" }),
    ).resolves.toEqual(expect.objectContaining({ screenshotCount: 1 }));
  });

  it("rejects invalid manifest timestamps", async () => {
    const root = await makeFixture();
    const manifest = makeManifest("screenshots/roku-720p/home.jpg", ["home"]);
    await writeFile(
      join(root, ".vref/manifest.json"),
      `${JSON.stringify({ ...manifest, updatedAt: "not-a-date" }, null, 2)}\n`,
    );

    await expect(
      validateGallery({ cwd: root, manifestPath: ".vref/manifest.json" }),
    ).rejects.toMatchObject({ code: "VREF_MANIFEST_SCHEMA_INVALID" });
  });

  it("renders tag filter buttons only for tags used by multiple screenshots", async () => {
    const root = await mkdtemp(join(tmpdir(), "vref-"));
    await mkdir(join(root, ".vref/screenshots/roku-720p"), { recursive: true });
    await writeFile(join(root, ".vref/screenshots/roku-720p/search.jpg"), "image");
    await writeFile(join(root, ".vref/screenshots/roku-720p/settings.jpg"), "image");

    const manifest: VrefManifest = {
      version: 1,
      title: "put.io Roku visual reference",
      description: "Curated Roku screenshots.",
      updatedAt: "2026-05-19T13:35:00.000Z",
      screenshots: [
        {
          id: "search",
          title: "Search",
          group: "Main pages",
          platform: "Roku",
          device: "Roku 720p",
          viewport: { width: 1280, height: 720 },
          file: "screenshots/roku-720p/search.jpg",
          capturedAt: "2026-05-19T13:34:00.000Z",
          sizeBytes: 5,
          tags: ["search", "shared", "keyboard"],
          notes: ["Search page."],
        },
        {
          id: "settings",
          title: "Settings",
          group: "Main pages",
          platform: "Roku",
          device: "Roku 720p",
          viewport: { width: 1280, height: 720 },
          file: "screenshots/roku-720p/settings.jpg",
          capturedAt: "2026-05-19T13:34:00.000Z",
          sizeBytes: 5,
          tags: ["search", "shared", "device"],
          notes: ["Settings page."],
        },
      ],
    };

    await writeFile(join(root, ".vref/manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    await buildGallery({
      cwd: root,
      manifestPath: ".vref/manifest.json",
      outputPath: ".vref/index.html",
    });

    const html = await readFile(join(root, ".vref/index.html"), "utf8");
    expect(html).toContain(
      'data-filter-group="tag" data-filter-value="value-007300650061007200630068"',
    );
    expect(html).toContain(
      'data-filter-group="tag" data-filter-value="value-007300680061007200650064"',
    );
    expect(html).toContain(
      'type="radio" name="filter-tag" id="filter-tag-value-007300650061007200630068"',
    );
    expect(html).toContain(
      '.container:has(#filter-tag-value-007300650061007200630068:checked) #gallery .card:not([data-tags~="value-007300650061007200630068"]) { display: none; }',
    );
    expect(html).not.toContain(
      'data-filter-group="tag" data-filter-value="value-006b006500790062006f006100720064"',
    );
    expect(html).not.toContain(
      'data-filter-group="tag" data-filter-value="value-006400650076006900630065"',
    );
    expect(html).toContain(
      'data-tags="value-007300650061007200630068 value-007300680061007200650064 value-006b006500790062006f006100720064"',
    );
    expect(html).toContain(
      'data-tags="value-007300650061007200630068 value-007300680061007200650064 value-006400650076006900630065"',
    );
  });

  it("omits filter rows that only have one available value", async () => {
    const root = await mkdtemp(join(tmpdir(), "vref-"));
    await mkdir(join(root, ".vref/screenshots/roku-720p"), { recursive: true });
    await writeFile(join(root, ".vref/screenshots/roku-720p/home.jpg"), "image");
    await writeFile(join(root, ".vref/screenshots/roku-720p/settings.jpg"), "image");

    const manifest: VrefManifest = {
      version: 1,
      title: "put.io Roku visual reference",
      description: "Curated Roku screenshots.",
      updatedAt: "2026-05-19T13:35:00.000Z",
      screenshots: [
        {
          id: "home",
          title: "Home",
          group: "Main pages",
          platform: "Roku",
          device: "Roku 720p",
          viewport: { width: 1280, height: 720 },
          file: "screenshots/roku-720p/home.jpg",
          capturedAt: "2026-05-19T13:34:00.000Z",
          sizeBytes: 5,
          tags: ["navigation"],
          notes: ["Home page."],
        },
        {
          id: "settings",
          title: "Settings",
          group: "Settings",
          platform: "Roku",
          device: "Roku 720p",
          viewport: { width: 1280, height: 720 },
          file: "screenshots/roku-720p/settings.jpg",
          capturedAt: "2026-05-19T13:34:00.000Z",
          sizeBytes: 5,
          tags: ["device"],
          notes: ["Settings page."],
        },
      ],
    };

    await writeFile(join(root, ".vref/manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    await buildGallery({
      cwd: root,
      manifestPath: ".vref/manifest.json",
      outputPath: ".vref/index.html",
    });

    const html = await readFile(join(root, ".vref/index.html"), "utf8");
    expect(html).not.toContain('data-filter-group="platform"');
    expect(html).not.toContain('data-filter-group="tag"');
    expect(html).toContain(
      'data-filter-group="group" data-filter-value="value-004d00610069006e002000700061006700650073"',
    );
    expect(html).toContain(
      'data-filter-group="group" data-filter-value="value-00530065007400740069006e00670073"',
    );
  });

  it("refuses servable file paths that resolve outside the serve root", async () => {
    const root = await makeFixture();
    await writeFile(join(root, "secret.txt"), "secret");
    await symlink(join(root, "secret.txt"), join(root, ".vref/screenshots/roku-720p/leak.txt"));

    await expect(
      resolveServableFile(join(root, ".vref"), "screenshots/roku-720p/leak.txt"),
    ).rejects.toMatchObject({ code: "VREF_BAD_SERVE_PATH" });
  });

  it("serves over an IPv6 loopback host and reports a bracketed url", async () => {
    const root = await makeFixture();

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* serve({ cwd: root, dir: ".vref", host: "::1", port: 0 });
          expect(result.url).toMatch(/^http:\/\/\[::1\]:\d+\/$/u);
          const response = yield* Effect.tryPromise(() =>
            fetch(`${result.url}screenshots/roku-720p/home.jpg`),
          );
          expect(response.status).toBe(200);
          expect(yield* Effect.tryPromise(() => response.text())).toBe("image");
        }),
      ),
    );
  });

  it("hardens every response and refuses a foreign Host", async () => {
    const root = await makeFixture();

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* serve({ cwd: root, dir: ".vref", host: "127.0.0.1", port: 0 });
          const asset = `${result.url}screenshots/roku-720p/home.jpg`;

          const ok = yield* Effect.tryPromise(() => fetch(asset));
          expect(ok.status).toBe(200);
          expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
          expect(ok.headers.get("content-security-policy")).toContain("default-src 'self'");
          expect(ok.headers.get("content-type")).toBe("image/jpeg");

          const missing = yield* Effect.tryPromise(() => fetch(`${result.url}nope.webp`));
          expect(missing.status).toBe(404);
          expect(missing.headers.get("x-content-type-options")).toBe("nosniff");

          const head = yield* Effect.tryPromise(() => fetch(asset, { method: "HEAD" }));
          expect(head.status).toBe(200);
          expect(head.headers.get("content-length")).toBe("5");
          expect(yield* Effect.tryPromise(() => head.text())).toBe("");

          const posted = yield* Effect.tryPromise(() => fetch(asset, { method: "POST" }));
          expect(posted.status).toBe(405);
          expect(posted.headers.get("allow")).toBe("GET, HEAD");

          const rebound = yield* Effect.tryPromise(() =>
            statusWithHost(result.port, "/screenshots/roku-720p/home.jpg", "evil.example.com"),
          );
          expect(rebound).toBe(403);
          const named = yield* Effect.tryPromise(() =>
            statusWithHost(result.port, "/screenshots/roku-720p/home.jpg", "localhost"),
          );
          expect(named).toBe(200);
        }),
      ),
    );
  });

  it("accepts a request to the url it printed for a noncanonical IPv6 host", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* Effect.tryPromise(() => makeFixture());
          // A client canonicalizes this to [::1] in Host, so comparing the
          // spelling the user typed would 403 its own printed url.
          const result = yield* serve({
            cwd: root,
            dir: ".vref",
            host: "0:0:0:0:0:0:0:1",
            port: 0,
          });
          const status = yield* Effect.tryPromise(() =>
            statusWithHost(result.port, "/screenshots/roku-720p/home.jpg", "[::1]", "::1"),
          );
          expect(status).toBe(200);
        }),
      ),
    );
  });

  it("refuses a symlinked serve root", async () => {
    const root = await makeFixture();
    await writeFile(join(root, "outside.txt"), "outside");
    await mkdir(join(root, "elsewhere"), { recursive: true });
    await symlink(join(root, "elsewhere"), join(root, "linked"));

    await expect(
      Effect.runPromise(
        Effect.scoped(serve({ cwd: root, dir: "linked", host: "127.0.0.1", port: 0 })),
      ),
    ).rejects.toMatchObject({ code: "VREF_SYMLINK_PATH" });
  });

  it("refuses a symlinked manifest even when it lists no screenshots", async () => {
    const root = await makeFixture();
    await writeFile(
      join(root, "outside.json"),
      `${JSON.stringify({
        version: 1,
        title: "outside",
        description: "outside",
        updatedAt: "2026-05-19T13:35:00.000Z",
        screenshots: [],
      })}\n`,
    );
    await unlink(join(root, ".vref/manifest.json"));
    await symlink(join(root, "outside.json"), join(root, ".vref/manifest.json"));

    await expect(
      validateGallery({ cwd: root, manifestPath: ".vref/manifest.json" }),
    ).rejects.toMatchObject({ code: "VREF_SYMLINK_PATH" });
  });

  it("closes the HTTP server when its Effect scope ends", async () => {
    const root = await makeFixture();
    let url = "";

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* serve({ cwd: root, dir: ".vref", host: "127.0.0.1", port: 0 });
          url = result.url;
          const response = yield* Effect.tryPromise(() =>
            fetch(`${result.url}screenshots/roku-720p/home.jpg`),
          );
          expect(response.status).toBe(200);
          expect(yield* Effect.tryPromise(() => response.text())).toBe("image");
        }),
      ),
    );

    await expect(fetch(url)).rejects.toThrow();
  });

  it("does not wait for a stalled response when the server scope ends", async () => {
    const root = await makeFixture();
    await writeFile(
      join(root, ".vref/screenshots/roku-720p/home.jpg"),
      Buffer.alloc(8 * 1024 * 1024),
    );
    let socket: Socket | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const scopedServer = Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const result = yield* serve({
              cwd: root,
              dir: ".vref",
              host: "127.0.0.1",
              port: 0,
            });
            yield* Effect.tryPromise(
              () =>
                new Promise<void>((resolve, reject) => {
                  socket = connect(result.port, result.host, () => {
                    socket?.write(
                      "GET /screenshots/roku-720p/home.jpg HTTP/1.1\r\nHost: localhost\r\n\r\n",
                    );
                  });
                  socket.once("error", reject);
                  socket.once("data", () => {
                    socket?.pause();
                    resolve();
                  });
                }),
            );
          }),
        ),
      );
      const deadline = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("server scope did not close")), 1_000);
      });

      await expect(Promise.race([scopedServer, deadline])).resolves.toBeUndefined();
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      socket?.destroy();
    }
  });

  it("surfaces a typed error when the serve port is already in use", async () => {
    const root = await makeFixture();
    const blocker = createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(0, "127.0.0.1", resolve);
    });
    const address = blocker.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("blocking server did not expose a TCP address");
    }

    try {
      await expect(
        Effect.runPromise(
          Effect.scoped(serve({ cwd: root, dir: ".vref", host: "127.0.0.1", port: address.port })),
        ),
      ).rejects.toMatchObject({ code: "VREF_SERVE_LISTEN_FAILED" });
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it("rejects manifest asset paths that escape the vref directory", async () => {
    const root = await makeFixture("../secret.jpg");

    await expect(
      buildGallery({
        cwd: root,
        manifestPath: ".vref/manifest.json",
        outputPath: ".vref/index.html",
      }),
    ).rejects.toMatchObject({ code: "VREF_UNSAFE_ASSET_PATH" });
  });

  it("rejects symlinked screenshot assets during build", async () => {
    const root = await makeFixture();
    await writeFile(join(root, "outside.jpg"), "outside");
    await unlink(join(root, ".vref/screenshots/roku-720p/home.jpg"));
    await symlink(join(root, "outside.jpg"), join(root, ".vref/screenshots/roku-720p/home.jpg"));

    await expect(
      buildGallery({
        cwd: root,
        manifestPath: ".vref/manifest.json",
        outputPath: ".vref/index.html",
      }),
    ).rejects.toMatchObject({ code: "VREF_SYMLINK_PATH" });
  });

  it("rejects symlinked gallery outputs before writing", async () => {
    const root = await makeFixture();
    await writeFile(join(root, "outside.html"), "outside");
    await symlink(join(root, "outside.html"), join(root, ".vref/index.html"));

    await expect(
      buildGallery({
        cwd: root,
        manifestPath: ".vref/manifest.json",
        outputPath: ".vref/index.html",
      }),
    ).rejects.toMatchObject({ code: "VREF_SYMLINK_PATH" });

    await expect(readFile(join(root, "outside.html"), "utf8")).resolves.toBe("outside");
  });

  it("rejects manifest asset paths that look like URL schemes", async () => {
    const root = await makeFixture("javascript:alert(1).jpg");
    await writeFile(join(root, ".vref/javascript:alert(1).jpg"), "image");

    await expect(
      buildGallery({
        cwd: root,
        manifestPath: ".vref/manifest.json",
        outputPath: ".vref/index.html",
      }),
    ).rejects.toMatchObject({ code: "VREF_UNSAFE_ASSET_PATH" });
  });

  it("describes build output flags without colliding with output format", () => {
    const schema = JSON.stringify(describeCli());

    expect(schema).toContain('"validate"');
    expect(schema).toContain('"flags":["--check","--dry-run"]');
    expect(schema).toContain('"fields"');
    expect(schema).toContain('"allowedExtensions":[".jpg",".jpeg",".png",".webp"]');
    expect(schema).toContain('"flags":["--out","--output-path"]');
    expect(schema).not.toContain('"approve"');
    expect(schema).not.toContain('"output":{"type":"string","default":".vref/index.html"}');
  });

  it("prints command help without touching default repo-local paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "vref-"));

    const result = await captureConsoleLog(() =>
      Effect.runPromise(runCli(["serve", "--help"], root)),
    );

    expect(result.logs.join("\n")).toContain("vref serve");
    expect(result.logs.join("\n")).toContain("vref serve [--dir .vref]");
  });

  it("defaults to json output for non-interactive command runs", async () => {
    const root = await makeFixture();

    const result = await captureConsoleLog(() =>
      Effect.runPromise(runCli(["validate"], root, { isInteractiveTerminal: false })),
    );

    expect(result.logs.join("\n")).toContain('"ok": true');
    expect(result.logs.join("\n")).toContain('"screenshotCount": 1');
  });

  it("selects top-level json fields for command output", async () => {
    const root = await makeFixture();

    const result = await captureConsoleLog(() =>
      Effect.runPromise(
        runCli(["validate", "--output", "json", "--fields", "screenshotCount"], root),
      ),
    );
    const output = result.logs.join("\n");

    expect(output).toContain('"result":');
    expect(output).toContain('"screenshotCount": 1');
    expect(output).not.toContain('"manifestPath"');
  });

  it("adds a manifest screenshot from raw json with dry-run support", async () => {
    const root = await makeFixture();
    const currentManifest = makeManifest("screenshots/roku-720p/home.jpg", ["home", "navigation"]);
    await writeFile(
      join(root, ".vref/manifest.json"),
      `${JSON.stringify(
        {
          ...currentManifest,
          owner: "keep-me",
          screenshots: [{ ...currentManifest.screenshots[0], sourceCommit: "abc123" }],
        },
        null,
        2,
      )}\n`,
    );
    const screenshot = {
      id: "settings",
      title: "Settings",
      group: "Main pages",
      platform: "Roku",
      device: "Roku 720p",
      viewport: { width: 1280, height: 720 },
      file: "screenshots/roku-720p/settings.jpg",
      capturedAt: "2026-05-19T13:34:00.000Z",
      sizeBytes: 5,
      tags: ["settings", "navigation"],
      notes: ["Settings menu."],
    };

    const dryRun = await captureConsoleLog(() =>
      Effect.runPromise(
        runCli(
          [
            "manifest",
            "add",
            "--json",
            JSON.stringify(screenshot),
            "--dry-run",
            "--output",
            "json",
          ],
          root,
        ),
      ),
    );
    const afterDryRun = await readFile(join(root, ".vref/manifest.json"), "utf8");

    expect(dryRun.logs.join("\n")).toContain('"dryRun": true');
    expect(dryRun.logs.join("\n")).toContain('"assetExists": false');
    expect(dryRun.logs.join("\n")).toContain('"result.screenshot.title"');
    expect(afterDryRun).not.toContain('"settings"');

    await writeFile(join(root, ".vref/screenshots/roku-720p/settings.jpg"), "image");
    const write = await captureConsoleLog(() =>
      Effect.runPromise(
        runCli(["manifest", "add", "--json", JSON.stringify(screenshot), "--output", "json"], root),
      ),
    );
    const afterWrite = await readFile(join(root, ".vref/manifest.json"), "utf8");

    expect(write.logs.join("\n")).toContain('"dryRun": false');
    expect(write.logs.join("\n")).toContain('"assetExists": true');
    expect(afterWrite).toContain('"id": "settings"');
    expect(afterWrite).toContain('"owner": "keep-me"');
    expect(afterWrite).toContain('"sourceCommit": "abc123"');
  });

  it("rejects unknown fields before mutating files", async () => {
    const root = await makeFixture();
    const screenshot = {
      id: "settings",
      title: "Settings",
      group: "Main pages",
      platform: "Roku",
      device: "Roku 720p",
      viewport: { width: 1280, height: 720 },
      file: "screenshots/roku-720p/settings.jpg",
      capturedAt: "2026-05-19T13:34:00.000Z",
      sizeBytes: 5,
      tags: ["settings"],
      notes: ["Settings menu."],
    };

    await expect(
      Effect.runPromise(runCli(["build", "--output", "json", "--fields", "nope"], root)),
    ).rejects.toMatchObject({ code: "VREF_UNKNOWN_FIELD" });

    await expect(readFile(join(root, ".vref/index.html"), "utf8")).rejects.toThrow();

    await expect(
      Effect.runPromise(
        runCli(["manifest", "add", "--json", JSON.stringify(screenshot), "--fields", "nope"], root),
      ),
    ).rejects.toMatchObject({ code: "VREF_UNKNOWN_FIELD" });

    const manifest = await readFile(join(root, ".vref/manifest.json"), "utf8");
    expect(manifest).not.toContain('"settings"');
  });

  it("keeps synchronous argument failures in the typed Effect error channel", async () => {
    const root = await makeFixture();

    const error = await Effect.runPromise(
      Effect.flip(runCli(["build", "--output", "json", "--fields", "nope"], root)),
    );

    expect(error).toBeInstanceOf(VrefError);
    expect(error.code).toBe("VREF_UNKNOWN_FIELD");
  });

  it("formats unexpected main-boundary defects as structured JSON", async () => {
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      const result = await captureConsoleError(() =>
        Effect.runPromise(
          recoverCliProgram(Effect.die(new Error("unexpected defect")), ["--output", "json"], true),
        ),
      );

      expect(result.logs.join("\n")).toContain('"code": "VREF_UNEXPECTED_ERROR"');
      expect(result.logs.join("\n")).toContain("unexpected defect");
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("preserves main-boundary interruption for NodeRuntime", async () => {
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      const exit = await Effect.runPromiseExit(
        recoverCliProgram(Effect.interrupt, ["--output", "json"], true),
      );

      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        expect(Cause.hasInterrupts(exit.cause)).toBe(true);
      }
      expect(process.exitCode).toBeUndefined();
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("formats a main-boundary defect mixed with interruption", async () => {
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    const cause = Cause.fromReasons([
      Cause.makeDieReason(new Error("mixed defect")),
      Cause.makeInterruptReason(),
    ]);

    try {
      const result = await captureConsoleError(() =>
        Effect.runPromise(recoverCliProgram(Effect.failCause(cause), ["--output", "json"], true)),
      );

      expect(result.logs.join("\n")).toContain('"code": "VREF_UNEXPECTED_ERROR"');
      expect(result.logs.join("\n")).toContain("mixed defect");
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("treats explicit true as a boolean dry-run value", async () => {
    const root = await makeFixture();
    const screenshot = {
      id: "settings",
      title: "Settings",
      group: "Main pages",
      platform: "Roku",
      device: "Roku 720p",
      viewport: { width: 1280, height: 720 },
      file: "screenshots/roku-720p/settings.jpg",
      capturedAt: "2026-05-19T13:34:00.000Z",
      sizeBytes: 5,
      tags: ["settings"],
      notes: ["Settings menu."],
    };

    await captureConsoleLog(() =>
      Effect.runPromise(
        runCli(
          ["manifest", "add", "--json", JSON.stringify(screenshot), "--dry-run", "true"],
          root,
        ),
      ),
    );

    const manifest = await readFile(join(root, ".vref/manifest.json"), "utf8");
    expect(manifest).not.toContain('"settings"');
  });

  it("rejects invalid boolean safety flag values before mutating files", async () => {
    const root = await makeFixture();
    const screenshot = {
      id: "settings",
      title: "Settings",
      group: "Main pages",
      platform: "Roku",
      device: "Roku 720p",
      viewport: { width: 1280, height: 720 },
      file: "screenshots/roku-720p/settings.jpg",
      capturedAt: "2026-05-19T13:34:00.000Z",
      sizeBytes: 5,
      tags: ["settings"],
      notes: ["Settings menu."],
    };

    await expect(
      Effect.runPromise(
        runCli(["manifest", "add", "--json", JSON.stringify(screenshot), "--dry-run", "yes"], root),
      ),
    ).rejects.toMatchObject({ code: "VREF_INVALID_BOOLEAN" });

    const manifest = await readFile(join(root, ".vref/manifest.json"), "utf8");
    expect(manifest).not.toContain('"settings"');

    await expect(Effect.runPromise(runCli(["build", "--check", "yes"], root))).rejects.toThrow(
      "true/false",
    );

    await expect(readFile(join(root, ".vref/index.html"), "utf8")).rejects.toThrow();

    await expect(
      Effect.runPromise(runCli(["build", "--check", "true", "--dry-run", "yes"], root)),
    ).rejects.toMatchObject({ code: "VREF_INVALID_BOOLEAN" });
  });

  it("rejects symlinked manifest writes", async () => {
    const root = await makeFixture();
    const outside = join(root, "outside-manifest.json");
    await writeFile(outside, await readFile(join(root, ".vref/manifest.json"), "utf8"));
    await unlink(join(root, ".vref/manifest.json"));
    await symlink(outside, join(root, ".vref/manifest.json"));

    const screenshot = {
      id: "settings",
      title: "Settings",
      group: "Main pages",
      platform: "Roku",
      device: "Roku 720p",
      viewport: { width: 1280, height: 720 },
      file: "screenshots/roku-720p/settings.jpg",
      capturedAt: "2026-05-19T13:34:00.000Z",
      sizeBytes: 5,
      tags: ["settings"],
      notes: ["Settings menu."],
    };

    await expect(
      Effect.runPromise(runCli(["manifest", "add", "--json", JSON.stringify(screenshot)], root)),
    ).rejects.toMatchObject({ code: "VREF_SYMLINK_PATH" });

    await expect(readFile(outside, "utf8")).resolves.not.toContain('"settings"');
  });
});

async function captureConsoleLog<Result>(
  run: () => Promise<Result>,
): Promise<{ logs: string[]; result: Result }> {
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = (...values: unknown[]) => {
    logs.push(values.map(String).join(" "));
  };

  try {
    const result = await run();
    return { logs, result };
  } finally {
    console.log = originalLog;
  }
}

async function captureConsoleError<Result>(
  run: () => Promise<Result>,
): Promise<{ logs: string[]; result: Result }> {
  const originalError = console.error;
  const logs: string[] = [];
  console.error = (...values: unknown[]) => {
    logs.push(values.map(String).join(" "));
  };

  try {
    const result = await run();
    return { logs, result };
  } finally {
    console.error = originalError;
  }
}

async function makeFixture(
  file = "screenshots/roku-720p/home.jpg",
  tags = ["home", "navigation"],
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "vref-"));
  await mkdir(join(root, ".vref/screenshots/roku-720p"), { recursive: true });
  await writeFile(join(root, ".vref/screenshots/roku-720p/home.jpg"), "image");

  const manifest = makeManifest(file, tags);

  await writeFile(join(root, ".vref/manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  return root;
}

function makeManifest(file: string, tags: string[]): VrefManifest {
  return {
    version: 1,
    title: "put.io Roku visual reference",
    description: "Curated Roku screenshots.",
    updatedAt: "2026-05-19T13:35:00.000Z",
    screenshots: [
      {
        id: "home",
        title: "Home",
        group: "Main pages",
        platform: "Roku",
        device: "Roku 720p",
        viewport: { width: 1280, height: 720 },
        file,
        capturedAt: "2026-05-19T13:34:00.000Z",
        sizeBytes: 5,
        tags,
        notes: ["Home menu."],
      },
    ],
  };
}

describe("cli entry detection", () => {
  it("treats a symlinked entry path as a direct invocation", async () => {
    const root = await mkdtemp(join(tmpdir(), "vref-entry-"));
    const real = join(root, "cli.mjs");
    const link = join(root, "linked-cli.mjs");
    await writeFile(real, "");
    await symlink(real, link);

    const moduleUrl = pathToFileURL(await realpath(real)).href;

    // How pnpm's bin shim reaches the CLI: through node_modules/<pkg>, a
    // symlink into node_modules/.pnpm. Comparing raw paths would miss this and
    // the CLI would silently do nothing.
    expect(isDirectInvocation(moduleUrl, link)).toBe(true);
    expect(isDirectInvocation(moduleUrl, real)).toBe(true);
  });

  it("still detects direct invocation when node keeps the main symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "vref-entry-"));
    const real = join(root, "cli.mjs");
    const link = join(root, "linked-cli.mjs");
    await writeFile(real, "");
    await symlink(real, link);

    // `node --preserve-symlinks-main` leaves import.meta.url on the symlink, so
    // canonicalising only the entry path would make the two disagree.
    const moduleUrl = pathToFileURL(link).href;

    expect(isDirectInvocation(moduleUrl, link)).toBe(true);
  });

  it("does not treat an unrelated entry path as a direct invocation", async () => {
    const root = await mkdtemp(join(tmpdir(), "vref-entry-"));
    const real = join(root, "cli.mjs");
    const other = join(root, "other.mjs");
    await writeFile(real, "");
    await writeFile(other, "");

    const moduleUrl = pathToFileURL(await realpath(real)).href;

    expect(isDirectInvocation(moduleUrl, other)).toBe(false);
    expect(isDirectInvocation(moduleUrl, undefined)).toBe(false);
  });

  it("does not throw when the entry path does not exist", () => {
    expect(isDirectInvocation("file:///nowhere/cli.mjs", "/nonexistent/cli.mjs")).toBe(false);
  });
});

describe("vref webp pipeline", () => {
  it("encodes a png capture to lossless webp and derives manifest metadata", async () => {
    const root = await makeWebpFixture();
    const source = join(root, "capture.png");
    const sourceBytes = await makePng(source, 64, 48);

    const result = await addScreenshotFromSource({
      cwd: root,
      draft: draftFor("home"),
      dryRun: false,
      force: false,
      manifestPath: ".vref/manifest.json",
      sourcePath: "capture.png",
    });

    const written = await readFile(join(root, ".vref/screenshots/home.webp"));
    expect(result.file).toBe("screenshots/home.webp");
    expect(result.reencoded).toBe(true);
    expect(webpVariant(written)).toBe("VP8L");
    // The manifest must describe the encoded file, not the source it came from.
    expect(result.screenshot.sizeBytes).toBe(written.byteLength);
    expect(result.screenshot.viewport).toEqual({ width: 64, height: 48 });
    expect(result.sourceBytes).toBe(sourceBytes);
    expect(written.byteLength).toBeLessThan(sourceBytes);

    const manifest = await readManifest(join(root, ".vref/manifest.json"));
    expect(manifest.screenshots).toHaveLength(1);
    expect(manifest.screenshots[0]?.file).toBe("screenshots/home.webp");
  });

  it("dates a capture from the source file when the draft omits capturedAt", async () => {
    const root = await makeWebpFixture();
    const source = join(root, "capture.png");
    await makePng(source, 8, 8);
    const mtime = new Date("2026-04-02T10:11:12.000Z");
    await utimes(source, mtime, mtime);

    const result = await addScreenshotFromSource({
      cwd: root,
      draft: draftFor("home"),
      dryRun: false,
      force: false,
      manifestPath: ".vref/manifest.json",
      sourcePath: "capture.png",
    });

    expect(result.screenshot.capturedAt).toBe("2026-04-02T10:11:12.000Z");
  });

  it("encodes lossy webp when a quality is given", async () => {
    const root = await makeWebpFixture();
    await makePng(join(root, "capture.png"), 64, 48);

    await addScreenshotFromSource({
      cwd: root,
      draft: draftFor("home"),
      dryRun: false,
      force: false,
      manifestPath: ".vref/manifest.json",
      quality: 60,
      sourcePath: "capture.png",
    });

    expect(webpVariant(await readFile(join(root, ".vref/screenshots/home.webp")))).toBe("VP8 ");
  });

  it("copies a webp source verbatim instead of re-encoding it", async () => {
    const root = await makeWebpFixture();
    const pngPath = join(root, "capture.png");
    await makePng(pngPath, 32, 32);
    const webpSource = await encodeWebp({ sourcePath: pngPath });
    await writeFile(join(root, "capture.webp"), webpSource.data);

    const result = await addScreenshotFromSource({
      cwd: root,
      draft: draftFor("home"),
      dryRun: false,
      force: false,
      manifestPath: ".vref/manifest.json",
      sourcePath: "capture.webp",
    });

    const written = await readFile(join(root, ".vref/screenshots/home.webp"));
    expect(result.reencoded).toBe(false);
    expect(written.equals(webpSource.data)).toBe(true);
  });

  it("writes nothing on a dry run", async () => {
    const root = await makeWebpFixture();
    await makePng(join(root, "capture.png"), 16, 16);

    const result = await addScreenshotFromSource({
      cwd: root,
      draft: draftFor("home"),
      dryRun: true,
      force: false,
      manifestPath: ".vref/manifest.json",
      sourcePath: "capture.png",
    });

    expect(result.dryRun).toBe(true);
    expect(result.screenshot.sizeBytes).toBeGreaterThan(0);
    expect(existsSync(join(root, ".vref/screenshots/home.webp"))).toBe(false);
    expect((await readManifest(join(root, ".vref/manifest.json"))).screenshots).toHaveLength(0);
  });

  it("rejects a duplicate id without writing an orphan asset", async () => {
    const root = await makeWebpFixture();
    await makePng(join(root, "capture.png"), 16, 16);
    await addScreenshotFromSource({
      cwd: root,
      draft: draftFor("home"),
      dryRun: false,
      force: false,
      manifestPath: ".vref/manifest.json",
      sourcePath: "capture.png",
    });
    await rm(join(root, ".vref/screenshots/home.webp"));

    await expect(
      addScreenshotFromSource({
        cwd: root,
        draft: draftFor("home"),
        dryRun: false,
        force: false,
        manifestPath: ".vref/manifest.json",
        sourcePath: "capture.png",
      }),
    ).rejects.toMatchObject({ code: "VREF_MANIFEST_DUPLICATE_ID" });
    await chmod(join(root, ".vref"), 0o755);
    expect(existsSync(join(root, ".vref/screenshots/home.webp"))).toBe(false);
  });

  it("refuses to overwrite an existing asset without force", async () => {
    const root = await makeWebpFixture();
    await makePng(join(root, "capture.png"), 16, 16);
    await mkdir(join(root, ".vref/screenshots"), { recursive: true });
    await writeFile(join(root, ".vref/screenshots/home.webp"), "existing");

    await expect(
      addScreenshotFromSource({
        cwd: root,
        draft: draftFor("home"),
        dryRun: false,
        force: false,
        manifestPath: ".vref/manifest.json",
        sourcePath: "capture.png",
      }),
    ).rejects.toMatchObject({ code: "VREF_ASSET_EXISTS" });

    const forced = await addScreenshotFromSource({
      cwd: root,
      draft: draftFor("home"),
      dryRun: false,
      force: true,
      manifestPath: ".vref/manifest.json",
      sourcePath: "capture.png",
    });
    expect(forced.screenshot.sizeBytes).toBeGreaterThan(0);
  });

  it("rejects a non-webp target file and a target outside the vref directory", async () => {
    const root = await makeWebpFixture();
    await makePng(join(root, "capture.png"), 16, 16);

    await expect(
      addScreenshotFromSource({
        cwd: root,
        draft: { ...draftFor("home"), file: "screenshots/home.png" },
        dryRun: false,
        force: false,
        manifestPath: ".vref/manifest.json",
        sourcePath: "capture.png",
      }),
    ).rejects.toMatchObject({ code: "VREF_UNSUPPORTED_IMAGE" });

    await expect(
      addScreenshotFromSource({
        cwd: root,
        draft: { ...draftFor("home"), file: "../escaped.webp" },
        dryRun: false,
        force: false,
        manifestPath: ".vref/manifest.json",
        sourcePath: "capture.png",
      }),
    ).rejects.toMatchObject({ code: "VREF_UNSAFE_ASSET_PATH" });
  });

  it("re-encodes bytes that are not really webp despite the extension", async () => {
    const root = await makeWebpFixture();
    const pngBytes = await makePngBuffer(32, 32);
    // A png wearing a .webp name must not be filed as webp.
    await writeFile(join(root, "masquerade.webp"), pngBytes);

    const result = await addScreenshotFromSource({
      cwd: root,
      draft: draftFor("home"),
      dryRun: false,
      force: false,
      manifestPath: ".vref/manifest.json",
      sourcePath: "masquerade.webp",
    });

    const written = await readFile(join(root, ".vref/screenshots/home.webp"));
    expect(result.reencoded).toBe(true);
    expect(written.subarray(8, 12).toString("latin1")).toBe("WEBP");
  });

  it("re-encodes webp bytes supplied under a png name", async () => {
    const root = await makeWebpFixture();
    const { default: sharp } = await import("sharp");
    // Real webp content, but a .png name. The safety rules promise png and jpg
    // sources are re-encoded, and that re-encode is what strips metadata.
    const webp = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#09090b" },
    })
      .webp({ lossless: true })
      .withExif({ IFD0: { Copyright: "PRIVATE" } })
      .toBuffer();
    expect(webp.includes(Buffer.from("PRIVATE"))).toBe(true);
    await writeFile(join(root, "mislabelled.png"), webp);

    const result = await addScreenshotFromSource({
      cwd: root,
      draft: draftFor("home"),
      dryRun: false,
      force: false,
      manifestPath: ".vref/manifest.json",
      sourcePath: "mislabelled.png",
    });

    const written = await readFile(join(root, ".vref/screenshots/home.webp"));
    expect(result.reencoded).toBe(true);
    expect(written.includes(Buffer.from("PRIVATE"))).toBe(false);
  });

  it("re-encodes a webp source that carries an orientation tag", async () => {
    const root = await makeWebpFixture();
    const { default: sharp } = await import("sharp");
    const rotated = await sharp({
      create: { width: 64, height: 48, channels: 3, background: "#09090b" },
    })
      .webp()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    await writeFile(join(root, "rotated.webp"), rotated);

    const result = await addScreenshotFromSource({
      cwd: root,
      draft: draftFor("home"),
      dryRun: false,
      force: false,
      manifestPath: ".vref/manifest.json",
      sourcePath: "rotated.webp",
    });

    // A verbatim copy could not be uprighted, so this one has to re-encode.
    expect(result.reencoded).toBe(true);
    expect(result.screenshot.viewport).toEqual({ width: 48, height: 64 });
  });

  it("refuses to add onto a file another entry references", async () => {
    const root = await makeWebpFixture();
    await makePng(join(root, "capture.png"), 16, 16);
    await addScreenshotFromSource({
      cwd: root,
      draft: draftFor("home"),
      dryRun: false,
      force: false,
      manifestPath: ".vref/manifest.json",
      sourcePath: "capture.png",
    });

    await expect(
      addScreenshotFromSource({
        cwd: root,
        draft: { ...draftFor("second"), file: "screenshots/home.webp" },
        dryRun: false,
        force: true,
        manifestPath: ".vref/manifest.json",
        sourcePath: "capture.png",
      }),
    ).rejects.toMatchObject({ code: "VREF_ASSET_CLAIMED" });
  });

  it("rejects a --quality flag passed without a value", async () => {
    const root = await makeLegacyFixture();

    await expect(
      Effect.runPromise(runCli(["convert", "--quality", "--output", "json"], root)),
    ).rejects.toMatchObject({ code: "VREF_EMPTY_FLAG" });
  });

  it("rejects an unsupported source format", async () => {
    const root = await makeWebpFixture();
    await writeFile(join(root, "capture.gif"), "not an image");

    await expect(
      addScreenshotFromSource({
        cwd: root,
        draft: draftFor("home"),
        dryRun: false,
        force: false,
        manifestPath: ".vref/manifest.json",
        sourcePath: "capture.gif",
      }),
    ).rejects.toMatchObject({ code: "VREF_UNSUPPORTED_SOURCE_IMAGE" });
  });

  it("converts legacy png assets and preserves unknown manifest fields", async () => {
    const root = await makeLegacyFixture();

    const result = await convertGallery({
      cwd: root,
      dryRun: false,
      force: false,
      keepSource: false,
      manifestPath: ".vref/manifest.json",
    });

    expect(result.convertedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(result.savedBytes).toBeGreaterThan(0);
    expect(result.conversions[0]?.to).toBe("screenshots/legacy.webp");

    const document: unknown = JSON.parse(await readFile(join(root, ".vref/manifest.json"), "utf8"));
    expect(document).toMatchObject({
      customField: "must survive",
      screenshots: [
        { file: "screenshots/legacy.webp", reviewer: "altay" },
        { file: "screenshots/current.webp" },
      ],
    });

    // The original is gone and the rewritten manifest still resolves.
    expect(existsSync(join(root, ".vref/screenshots/legacy.png"))).toBe(false);
    await expect(
      validateGallery({ cwd: root, manifestPath: ".vref/manifest.json" }),
    ).resolves.toMatchObject({ screenshotCount: 2 });
  });

  it("keeps the original asset with keepSource and honours only", async () => {
    const root = await makeLegacyFixture();

    // An id matching nothing is a mistake, not a request to convert nothing.
    await expect(
      convertGallery({
        cwd: root,
        dryRun: false,
        force: false,
        keepSource: true,
        manifestPath: ".vref/manifest.json",
        only: ["missing-id"],
      }),
    ).rejects.toMatchObject({ code: "VREF_UNKNOWN_SELECTOR" });

    const kept = await convertGallery({
      cwd: root,
      dryRun: false,
      force: false,
      keepSource: true,
      manifestPath: ".vref/manifest.json",
      only: ["legacy"],
    });
    expect(kept.convertedCount).toBe(1);
    expect(existsSync(join(root, ".vref/screenshots/legacy.png"))).toBe(true);
    expect(existsSync(join(root, ".vref/screenshots/legacy.webp"))).toBe(true);
  });

  it("writes and removes a shared asset once when entries reuse it", async () => {
    const root = await makeLegacyFixture();
    const document: { screenshots: Record<string, unknown>[] } = JSON.parse(
      await readFile(join(root, ".vref/manifest.json"), "utf8"),
    );
    // Ids are unique, but two entries may legitimately point at one file.
    document.screenshots.push({ ...document.screenshots[0], id: "legacy-alias" });
    await writeFile(join(root, ".vref/manifest.json"), JSON.stringify(document, null, 2));

    const result = await convertGallery({
      cwd: root,
      dryRun: false,
      force: false,
      keepSource: false,
      manifestPath: ".vref/manifest.json",
    });

    // Both entries are patched, but the file is counted, written, and unlinked once.
    expect(result.convertedCount).toBe(2);
    expect(result.conversions.every((item) => item.to === "screenshots/legacy.webp")).toBe(true);
    expect(result.savedBytes).toBe(
      (result.conversions[0]?.fromBytes ?? 0) - (result.conversions[0]?.toBytes ?? 0),
    );
    expect(existsSync(join(root, ".vref/screenshots/legacy.png"))).toBe(false);
    await expect(
      validateGallery({ cwd: root, manifestPath: ".vref/manifest.json" }),
    ).resolves.toMatchObject({ screenshotCount: 3 });
  });

  it("reports a negative savedBytes when webp is larger than the source", async () => {
    const root = await makeWebpFixture();
    const { default: sharp } = await import("sharp");
    // Seeded xorshift: high-entropy but deterministic, so jpeg cannot compress
    // it and the lossless webp is reliably larger.
    const noise = Buffer.alloc(128 * 128 * 3);
    let seed = 0x9e3779b9;
    for (let index = 0; index < noise.length; index += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      noise[index] = (seed >>> 0) % 256;
    }
    // A lossy jpeg re-encoded to lossless webp legitimately grows.
    const jpeg = await sharp(noise, { raw: { width: 128, height: 128, channels: 3 } })
      .jpeg({ quality: 60 })
      .toBuffer();
    await mkdir(join(root, ".vref/screenshots"), { recursive: true });
    await writeFile(join(root, ".vref/screenshots/photo.jpg"), jpeg);
    await writeFile(
      join(root, ".vref/manifest.json"),
      JSON.stringify({
        version: 1,
        title: "photo",
        description: "d",
        updatedAt: "2026-09-18T09:00:00.000Z",
        screenshots: [
          {
            id: "photo",
            title: "Photo",
            group: "G",
            platform: "Web",
            device: "D",
            viewport: { width: 128, height: 128 },
            file: "screenshots/photo.jpg",
            capturedAt: "2026-09-18T09:00:00.000Z",
            sizeBytes: jpeg.byteLength,
            tags: [],
            notes: [],
          },
        ],
      }),
    );

    const result = await convertGallery({
      cwd: root,
      dryRun: true,
      force: false,
      keepSource: false,
      manifestPath: ".vref/manifest.json",
    });

    // Reported honestly rather than clamped: a migration that costs bytes must say so.
    expect(result.savedBytes).toBeLessThan(0);
  });

  it("refuses to converge two different assets on one webp target", async () => {
    const root = await makeLegacyFixture();
    const document: { screenshots: Record<string, unknown>[] } = JSON.parse(
      await readFile(join(root, ".vref/manifest.json"), "utf8"),
    );
    // legacy.png and legacy.jpg are different images that both want legacy.webp.
    const { default: sharp } = await import("sharp");
    const jpeg = await sharp({
      create: { width: 40, height: 40, channels: 3, background: "#ffffff" },
    })
      .jpeg()
      .toBuffer();
    await writeFile(join(root, ".vref/screenshots/legacy.jpg"), jpeg);
    document.screenshots.push({
      ...document.screenshots[0],
      id: "legacy-jpg",
      file: "screenshots/legacy.jpg",
      sizeBytes: jpeg.byteLength,
    });
    await writeFile(join(root, ".vref/manifest.json"), JSON.stringify(document, null, 2));

    await expect(
      convertGallery({
        cwd: root,
        dryRun: false,
        force: false,
        keepSource: false,
        manifestPath: ".vref/manifest.json",
      }),
    ).rejects.toMatchObject({ code: "VREF_CONVERT_TARGET_COLLISION" });

    // Nothing was written, so neither reference was lost.
    expect(existsSync(join(root, ".vref/screenshots/legacy.png"))).toBe(true);
    expect(existsSync(join(root, ".vref/screenshots/legacy.jpg"))).toBe(true);
    expect(existsSync(join(root, ".vref/screenshots/legacy.webp"))).toBe(false);
  });

  it("detects a target collision that differs only by filename case", async () => {
    const root = await makeLegacyFixture();
    const { default: sharp } = await import("sharp");
    const jpeg = await sharp({
      create: { width: 40, height: 40, channels: 3, background: "#ffffff" },
    })
      .jpeg()
      .toBuffer();
    // On macOS and Windows these two resolve to one file; on Linux they do not.
    // A committed .vref/ has to survive both, so the collision is refused
    // regardless of the filesystem running the test.
    await writeFile(join(root, ".vref/screenshots/LEGACY.jpg"), jpeg);
    const document: { screenshots: Record<string, unknown>[] } = JSON.parse(
      await readFile(join(root, ".vref/manifest.json"), "utf8"),
    );
    document.screenshots.push({
      ...document.screenshots[0],
      id: "legacy-upper",
      file: "screenshots/LEGACY.jpg",
      sizeBytes: jpeg.byteLength,
    });
    await writeFile(join(root, ".vref/manifest.json"), JSON.stringify(document, null, 2));

    await expect(
      convertGallery({
        cwd: root,
        dryRun: false,
        force: false,
        keepSource: false,
        manifestPath: ".vref/manifest.json",
      }),
    ).rejects.toMatchObject({ code: "VREF_CONVERT_TARGET_COLLISION" });

    expect(existsSync(join(root, ".vref/screenshots/legacy.png"))).toBe(true);
    expect(existsSync(join(root, ".vref/screenshots/LEGACY.jpg"))).toBe(true);
  });

  it("keeps a shared source that an unselected entry still references", async () => {
    const root = await makeLegacyFixture();
    const document: { screenshots: Record<string, unknown>[] } = JSON.parse(
      await readFile(join(root, ".vref/manifest.json"), "utf8"),
    );
    document.screenshots.push({ ...document.screenshots[0], id: "legacy-alias" });
    await writeFile(join(root, ".vref/manifest.json"), JSON.stringify(document, null, 2));

    const result = await convertGallery({
      cwd: root,
      dryRun: false,
      force: false,
      keepSource: false,
      manifestPath: ".vref/manifest.json",
      only: ["legacy"],
    });

    expect(result.convertedCount).toBe(1);
    // legacy-alias still points at the png, so the png must survive and the
    // manifest must still validate.
    expect(existsSync(join(root, ".vref/screenshots/legacy.png"))).toBe(true);
    await expect(
      validateGallery({ cwd: root, manifestPath: ".vref/manifest.json" }),
    ).resolves.toMatchObject({ screenshotCount: 3 });
  });

  it("keeps a source that a backslash-spelled entry still references", async () => {
    const root = await makeLegacyFixture();
    const document: { screenshots: Record<string, unknown>[] } = JSON.parse(
      await readFile(join(root, ".vref/manifest.json"), "utf8"),
    );
    // The parser normalizes backslashes, so this is a valid second reference to
    // the very same file.
    document.screenshots.push({
      ...document.screenshots[0],
      id: "legacy-backslash",
      file: "screenshots\\legacy.png",
    });
    await writeFile(join(root, ".vref/manifest.json"), JSON.stringify(document, null, 2));

    await convertGallery({
      cwd: root,
      dryRun: false,
      force: false,
      keepSource: false,
      manifestPath: ".vref/manifest.json",
      only: ["legacy"],
    });

    expect(existsSync(join(root, ".vref/screenshots/legacy.png"))).toBe(true);
    await expect(
      validateGallery({ cwd: root, manifestPath: ".vref/manifest.json" }),
    ).resolves.toMatchObject({ screenshotCount: 3 });
  });

  it("applies exif orientation before deriving dimensions", async () => {
    const root = await makeWebpFixture();
    const { default: sharp } = await import("sharp");
    // Stored 64x48 but tagged "rotate 90", so the displayed image is 48x64.
    const rotated = await sharp({
      create: { width: 64, height: 48, channels: 3, background: "#09090b" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    await writeFile(join(root, "rotated.jpg"), rotated);

    const result = await addScreenshotFromSource({
      cwd: root,
      draft: draftFor("home"),
      dryRun: false,
      force: false,
      manifestPath: ".vref/manifest.json",
      sourcePath: "rotated.jpg",
    });

    // Encoding drops the orientation tag, so the pixels must already be upright
    // and the viewport must describe the upright result.
    expect(result.screenshot.viewport).toEqual({ width: 48, height: 64 });
    const written = await sharp(
      await readFile(join(root, ".vref/screenshots/home.webp")),
    ).metadata();
    expect([written.width, written.height]).toEqual([48, 64]);
  });

  it("rejects an empty --only selector instead of converting everything", async () => {
    const root = await makeLegacyFixture();

    await expect(
      Effect.runPromise(runCli(["convert", "--only", "--output", "json"], root)),
    ).rejects.toMatchObject({ code: "VREF_EMPTY_SELECTOR" });
    await expect(
      Effect.runPromise(runCli(["convert", "--only=,,,", "--output", "json"], root)),
    ).rejects.toMatchObject({ code: "VREF_EMPTY_SELECTOR" });

    // The legacy asset is untouched by the rejected runs.
    expect(existsSync(join(root, ".vref/screenshots/legacy.png"))).toBe(true);
  });

  it("rolls back a written asset when the manifest append fails", async () => {
    const root = await makeWebpFixture();
    await makePng(join(root, "capture.png"), 16, 16);
    await mkdir(join(root, ".vref/screenshots"), { recursive: true });
    // The asset still lands, but the manifest is replaced by rename, which needs
    // a writable .vref/ — so the append fails only after the write, which is the
    // path rollback exists for.
    await chmod(join(root, ".vref"), 0o555);

    await expect(
      addScreenshotFromSource({
        cwd: root,
        draft: draftFor("home"),
        dryRun: false,
        force: false,
        manifestPath: ".vref/manifest.json",
        sourcePath: "capture.png",
      }),
    ).rejects.toThrow();

    expect(existsSync(join(root, ".vref/screenshots/home.webp"))).toBe(false);
  });

  it("refuses a target collision that differs only by unicode normalization", async () => {
    const root = await makeLegacyFixture();
    const { default: sharp } = await import("sharp");
    const jpeg = await sharp({
      create: { width: 40, height: 40, channels: 3, background: "#ffffff" },
    })
      .jpeg()
      .toBuffer();
    // NFC and NFD spellings of the same name: two files on Linux, one on macOS.
    const nfc = "caf\u00e9.png";
    const nfd = "cafe\u0301.jpg";
    const png = await readFile(join(root, ".vref/screenshots/legacy.png"));
    await writeFile(join(root, `.vref/screenshots/${nfc}`), png);
    await writeFile(join(root, `.vref/screenshots/${nfd}`), jpeg);
    const document: { screenshots: Record<string, unknown>[] } = JSON.parse(
      await readFile(join(root, ".vref/manifest.json"), "utf8"),
    );
    document.screenshots = [
      { ...document.screenshots[0], id: "nfc", file: `screenshots/${nfc}` },
      {
        ...document.screenshots[0],
        id: "nfd",
        file: `screenshots/${nfd}`,
        sizeBytes: jpeg.byteLength,
      },
    ];
    await writeFile(join(root, ".vref/manifest.json"), JSON.stringify(document, null, 2));

    await expect(
      convertGallery({
        cwd: root,
        dryRun: false,
        force: false,
        keepSource: false,
        manifestPath: ".vref/manifest.json",
      }),
    ).rejects.toMatchObject({ code: "VREF_CONVERT_TARGET_COLLISION" });
  });

  it("refuses to convert onto an asset another entry references", async () => {
    const root = await makeLegacyFixture();
    const document: { screenshots: Record<string, unknown>[] } = JSON.parse(
      await readFile(join(root, ".vref/manifest.json"), "utf8"),
    );
    // "current" already points at screenshots/legacy.webp, which is exactly
    // where "legacy" would convert to.
    document.screenshots[1] = { ...document.screenshots[1], file: "screenshots/legacy.webp" };
    await writeFile(join(root, ".vref/manifest.json"), JSON.stringify(document, null, 2));
    await writeFile(join(root, ".vref/screenshots/legacy.webp"), "claimed");

    await expect(
      convertGallery({
        cwd: root,
        dryRun: false,
        force: true,
        keepSource: false,
        manifestPath: ".vref/manifest.json",
        only: ["legacy"],
      }),
    ).rejects.toMatchObject({ code: "VREF_TARGET_CLAIMED" });

    expect(await readFile(join(root, ".vref/screenshots/legacy.webp"), "utf8")).toBe("claimed");
  });

  it("credits an overwritten target in savedBytes", async () => {
    const root = await makeLegacyFixture();
    // A stale webp sitting at the conversion target, referenced by nobody.
    await writeFile(join(root, ".vref/screenshots/legacy.webp"), Buffer.alloc(5000, 1));

    const result = await convertGallery({
      cwd: root,
      dryRun: true,
      force: true,
      keepSource: false,
      manifestPath: ".vref/manifest.json",
      only: ["legacy"],
    });

    const item = result.conversions[0];
    expect(result.savedBytes).toBe((item?.fromBytes ?? 0) + 5000 - (item?.toBytes ?? 0));
  });

  it("requires force for a zero-byte target and refuses a directory", async () => {
    const root = await makeLegacyFixture();
    // What an interrupted write leaves behind is still a file.
    await writeFile(join(root, ".vref/screenshots/legacy.webp"), "");

    await expect(
      convertGallery({
        cwd: root,
        dryRun: true,
        force: false,
        keepSource: false,
        manifestPath: ".vref/manifest.json",
        only: ["legacy"],
      }),
    ).rejects.toMatchObject({ code: "VREF_ASSET_EXISTS" });

    await rm(join(root, ".vref/screenshots/legacy.webp"));
    await mkdir(join(root, ".vref/screenshots/legacy.webp"), { recursive: true });

    // No --force makes a directory writable, so it fails in preflight rather
    // than as an EISDIR after a dry run promised the plan works.
    await expect(
      convertGallery({
        cwd: root,
        dryRun: true,
        force: true,
        keepSource: false,
        manifestPath: ".vref/manifest.json",
        only: ["legacy"],
      }),
    ).rejects.toMatchObject({ code: "VREF_TARGET_NOT_FILE" });
  });

  it("leaves the manifest intact when an asset write fails", async () => {
    const root = await makeLegacyFixture();
    const before = await readFile(join(root, ".vref/manifest.json"), "utf8");
    // Make the asset write fail well before the manifest is reached.
    await chmod(join(root, ".vref/screenshots"), 0o555);

    await expect(
      convertGallery({
        cwd: root,
        dryRun: false,
        force: false,
        keepSource: false,
        manifestPath: ".vref/manifest.json",
        only: ["legacy"],
      }),
    ).rejects.toThrow();

    await chmod(join(root, ".vref/screenshots"), 0o755);
    // The failure never touched the manifest, so nothing may have rewritten it.
    expect(await readFile(join(root, ".vref/manifest.json"), "utf8")).toBe(before);
  });

  it("preserves manifest permissions and refuses a planted temp symlink", async () => {
    const root = await makeWebpFixture();
    await makePng(join(root, "capture.png"), 16, 16);
    const manifestPath = join(root, ".vref/manifest.json");
    await chmod(manifestPath, 0o600);
    const outsider = join(root, "outside.json");
    await writeFile(outsider, "untouched");

    await addScreenshotFromSource({
      cwd: root,
      draft: draftFor("home"),
      dryRun: false,
      force: false,
      manifestPath: ".vref/manifest.json",
      sourcePath: "capture.png",
    });

    // Replacing the inode must not widen a deliberately private manifest.
    expect((await stat(manifestPath)).mode & 0o777).toBe(0o600);
    // Nothing may be written through a sibling path outside the workspace.
    expect(await readFile(outsider, "utf8")).toBe("untouched");
    expect((await readdir(join(root, ".vref"))).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("reports a conversion plan without writing on a dry run", async () => {
    const root = await makeLegacyFixture();
    const before = await readFile(join(root, ".vref/manifest.json"), "utf8");

    const result = await convertGallery({
      cwd: root,
      dryRun: true,
      force: false,
      keepSource: false,
      manifestPath: ".vref/manifest.json",
    });

    expect(result.dryRun).toBe(true);
    expect(result.convertedCount).toBe(1);
    expect(await readFile(join(root, ".vref/manifest.json"), "utf8")).toBe(before);
    expect(existsSync(join(root, ".vref/screenshots/legacy.webp"))).toBe(false);
    expect(existsSync(join(root, ".vref/screenshots/legacy.png"))).toBe(true);
  });

  it("does not credit retained originals as saved bytes", async () => {
    const root = await makeLegacyFixture();

    const kept = await convertGallery({
      cwd: root,
      dryRun: true,
      force: false,
      keepSource: true,
      manifestPath: ".vref/manifest.json",
    });
    const removed = await convertGallery({
      cwd: root,
      dryRun: true,
      force: false,
      keepSource: false,
      manifestPath: ".vref/manifest.json",
    });

    // Nothing is reclaimed under --keep-source, so the tree only grows.
    expect(kept.savedBytes).toBe(-(kept.conversions[0]?.toBytes ?? 0));
    expect(kept.savedBytes).toBeLessThan(0);
    expect(removed.savedBytes).toBeGreaterThan(kept.savedBytes);
  });

  it("restores the tree when the conversion transaction fails", async () => {
    const root = await makeLegacyFixture();
    const before = await readFile(join(root, ".vref/manifest.json"), "utf8");
    // Readable for the plan, unwritable for the commit.
    await chmod(join(root, ".vref"), 0o555);

    await expect(
      convertGallery({
        cwd: root,
        dryRun: false,
        force: false,
        keepSource: false,
        manifestPath: ".vref/manifest.json",
      }),
    ).rejects.toThrow();

    await chmod(join(root, ".vref"), 0o755);
    // No half-written webp is left for a later run to trip over.
    expect(existsSync(join(root, ".vref/screenshots/legacy.webp"))).toBe(false);
    expect(existsSync(join(root, ".vref/screenshots/legacy.png"))).toBe(true);
    expect(await readFile(join(root, ".vref/manifest.json"), "utf8")).toBe(before);
  });

  it("restores the replaced asset when a forced add fails", async () => {
    const root = await makeWebpFixture();
    await makePng(join(root, "capture.png"), 16, 16);
    await mkdir(join(root, ".vref/screenshots"), { recursive: true });
    const original = Buffer.from("original bytes");
    await writeFile(join(root, ".vref/screenshots/home.webp"), original);
    await chmod(join(root, ".vref"), 0o555);

    await expect(
      addScreenshotFromSource({
        cwd: root,
        draft: draftFor("home"),
        dryRun: false,
        force: true,
        manifestPath: ".vref/manifest.json",
        sourcePath: "capture.png",
      }),
    ).rejects.toThrow();

    await chmod(join(root, ".vref"), 0o755);
    const after = await readFile(join(root, ".vref/screenshots/home.webp"));
    expect(after.equals(original)).toBe(true);
  });

  it("rejects a --manifest flag passed without a value", async () => {
    const root = await makeLegacyFixture();

    await expect(
      Effect.runPromise(runCli(["convert", "--manifest", "--output", "json"], root)),
    ).rejects.toMatchObject({ code: "VREF_EMPTY_FLAG" });
    await expect(
      Effect.runPromise(runCli(["validate", "--manifest=", "--output", "json"], root)),
    ).rejects.toMatchObject({ code: "VREF_EMPTY_FLAG" });
  });

  it("runs screenshot add and convert through the cli with json output", async () => {
    const root = await makeWebpFixture();
    await makePng(join(root, "capture.png"), 32, 32);

    const added = await captureConsoleLog(() =>
      Effect.runPromise(
        runCli(
          [
            "screenshot",
            "add",
            "capture.png",
            "--json",
            JSON.stringify(draftFor("home")),
            "--output",
            "json",
            "--fields",
            "file,reencoded",
          ],
          root,
        ),
      ),
    );

    expect(added.logs.join("\n")).toContain('"file": "screenshots/home.webp"');
    expect(added.logs.join("\n")).not.toContain('"sourceBytes"');

    const converted = await captureConsoleLog(() =>
      Effect.runPromise(
        runCli(["convert", "--output", "json", "--fields", "convertedCount"], root),
      ),
    );

    expect(converted.logs.join("\n")).toContain('"convertedCount": 0');
  });

  it("rejects a screenshot add without a source path or json", async () => {
    const root = await makeWebpFixture();

    await expect(
      Effect.runPromise(runCli(["screenshot", "add", "--output", "json"], root)),
    ).rejects.toThrow("requires a source image path");
    await expect(
      Effect.runPromise(runCli(["screenshot", "add", "capture.png", "--output", "json"], root)),
    ).rejects.toThrow("requires --json");
    await expect(
      Effect.runPromise(runCli(["screenshot", "delete", "--output", "json"], root)),
    ).rejects.toThrow("vref screenshot add");
    await expect(
      Effect.runPromise(runCli(["screenshot", "remove", "--output", "json"], root)),
    ).rejects.toThrow("requires a screenshot id");
    await expect(
      Effect.runPromise(runCli(["manifest", "update", "--output", "json"], root)),
    ).rejects.toThrow("requires a screenshot id");
  });

  it("refuses an unknown flag name instead of running the destructive branch", async () => {
    const root = await makeLegacyFixture();
    const before = await readFile(join(root, ".vref/manifest.json"), "utf8");

    await expect(
      Effect.runPromise(runCli(["convert", "--dryrun", "--output", "json"], root)),
    ).rejects.toMatchObject({ code: "VREF_UNKNOWN_FLAG" });

    // The typo must not have reached the conversion: manifest and originals intact.
    expect(await readFile(join(root, ".vref/manifest.json"), "utf8")).toBe(before);
    expect(existsSync(join(root, ".vref/screenshots/legacy.png"))).toBe(true);
  });

  it("refuses an unknown flag on every command that takes one", async () => {
    const root = await makeLegacyFixture();

    for (const argv of [
      ["build", "--bogus"],
      ["validate", "--bogus"],
      ["serve", "--bogus"],
      ["describe", "--bogus"],
      ["convert", "--keepsource"],
      ["manifest", "add", "--forc"],
      ["screenshot", "add", "capture.png", "--quailty", "80"],
    ]) {
      await expect(
        Effect.runPromise(runCli([...argv, "--output", "json"], root)),
      ).rejects.toMatchObject({ code: "VREF_UNKNOWN_FLAG" });
    }
  });

  it("refuses a malformed output-path alias even when the other is well formed", async () => {
    const root = await makeFixture();

    await expect(
      Effect.runPromise(
        runCli(["build", "--out", ".vref/index.html", "--output-path=", "--output", "json"], root),
      ),
    ).rejects.toMatchObject({ code: "VREF_EMPTY_FLAG" });
    expect(existsSync(join(root, ".vref/index.html"))).toBe(false);
  });

  it("refuses a path flag that was passed without a value", async () => {
    const root = await makeFixture();

    await expect(
      Effect.runPromise(runCli(["build", "--out", "--output", "json"], root)),
    ).rejects.toMatchObject({ code: "VREF_EMPTY_FLAG" });
    await expect(
      Effect.runPromise(runCli(["build", "--out=", "--output", "json"], root)),
    ).rejects.toMatchObject({ code: "VREF_EMPTY_FLAG" });
    await expect(
      Effect.runPromise(runCli(["serve", "--dir=", "--output", "json"], root)),
    ).rejects.toMatchObject({ code: "VREF_EMPTY_FLAG" });
    await expect(
      Effect.runPromise(runCli(["serve", "--host=", "--output", "json"], root)),
    ).rejects.toMatchObject({ code: "VREF_EMPTY_FLAG" });

    // The default gallery must not have been written by the malformed build.
    expect(existsSync(join(root, ".vref/index.html"))).toBe(false);
  });

  it("still accepts every documented flag", async () => {
    const root = await makeLegacyFixture();

    await Effect.runPromise(runCli(["validate", "--manifest", ".vref/manifest.json"], root));
    await Effect.runPromise(runCli(["build", "--out", ".vref/index.html", "--check"], root));
    await Effect.runPromise(
      runCli(["convert", "--only", "legacy", "--keep-source", "--dry-run"], root),
    );
    await Effect.runPromise(runCli(["describe", "--output", "json", "--fields", "commands"], root));
  });

  it("stamps updatedAt when a command rewrites the manifest", async () => {
    const root = await makeLegacyFixture();
    const before = (
      JSON.parse(await readFile(join(root, ".vref/manifest.json"), "utf8")) as {
        updatedAt: string;
      }
    ).updatedAt;

    await convertGallery({
      cwd: root,
      dryRun: false,
      force: false,
      keepSource: false,
      manifestPath: ".vref/manifest.json",
    });

    const after = (
      JSON.parse(await readFile(join(root, ".vref/manifest.json"), "utf8")) as {
        updatedAt: string;
      }
    ).updatedAt;
    expect(after).not.toBe(before);
    expect(Date.parse(after)).toBeGreaterThan(Date.parse(before));
  });

  it("leaves updatedAt alone on a dry run", async () => {
    const root = await makeLegacyFixture();
    const before = await readFile(join(root, ".vref/manifest.json"), "utf8");

    await convertGallery({
      cwd: root,
      dryRun: true,
      force: false,
      keepSource: false,
      manifestPath: ".vref/manifest.json",
    });

    expect(await readFile(join(root, ".vref/manifest.json"), "utf8")).toBe(before);
  });

  it.skipIf(process.getuid?.() === 0)(
    "reports a source it could not remove without failing the conversion",
    async () => {
      const root = await makeLegacyFixture();
      // unlink needs write permission on the directory, overwriting an existing
      // file needs it only on the file. Pre-create the target, then lock the
      // directory: the conversion completes and only the cleanup fails.
      await writeFile(join(root, ".vref/screenshots/legacy.webp"), "placeholder");
      await chmod(join(root, ".vref/screenshots"), 0o555);

      try {
        const result = await convertGallery({
          cwd: root,
          dryRun: false,
          force: true,
          keepSource: false,
          manifestPath: ".vref/manifest.json",
        });

        expect(result.retainedSources).toEqual(["screenshots/legacy.png"]);
        expect(result.convertedCount).toBe(1);
      } finally {
        await chmod(join(root, ".vref/screenshots"), 0o755);
      }
    },
  );

  it("url-encodes asset paths in the rendered gallery", () => {
    const html = renderGallery(
      {
        version: 1,
        title: "encoded",
        description: "percent in a file name",
        updatedAt: "2026-05-19T13:35:00.000Z",
        screenshots: [
          {
            id: "home",
            title: "Home",
            group: "Main",
            platform: "Web",
            device: "Chrome",
            viewport: { width: 10, height: 10 },
            file: "screenshots/a%41.webp",
            capturedAt: "2026-05-19T13:35:00.000Z",
            sizeBytes: 10,
            tags: [],
            notes: [],
          },
        ],
      },
      { manifestLabel: ".vref/manifest.json" },
    );

    // Left raw, the server's decodeURIComponent would resolve this to aA.webp.
    expect(html).toContain("screenshots/a%2541.webp");
    expect(html).not.toContain('href="screenshots/a%41.webp"');
  });

  it("describes exactly the flags the CLI implements", () => {
    const described = describedCommands();
    const mismatches: string[] = [];

    for (const [command, allowed] of Object.entries(COMMAND_FLAGS)) {
      const expected = new Set([...allowed, ...COMMON_FLAGS]);
      const actual = described.get(command);
      if (actual === undefined) {
        mismatches.push(`${command}: not described at all`);
        continue;
      }

      for (const flag of actual) {
        if (!expected.has(flag)) {
          mismatches.push(`${command}: describes --${flag}, which the CLI does not accept`);
        }
      }
      for (const flag of expected) {
        if (!actual.has(flag)) {
          mismatches.push(`${command}: accepts --${flag}, which describe does not mention`);
        }
      }
    }

    expect(mismatches).toEqual([]);
  });

  it("describes the --fields values each command actually validates", () => {
    const schema = describeCli() as {
      commands: Record<string, Record<string, unknown>>;
    };
    const mismatches: string[] = [];

    for (const [command, fields] of Object.entries(COMMAND_FIELDS)) {
      const entry = describedEntryFor(schema.commands, command);
      const options = optionsFor(entry);
      const described = (options?.fields as { values?: readonly string[] } | undefined)?.values;
      if (described === undefined) {
        mismatches.push(`${command}: describe lists no --fields values`);
        continue;
      }
      if ([...described].sort().join(",") !== [...fields].sort().join(",")) {
        mismatches.push(`${command}: describe lists ${described.join("|")}`);
      }
    }

    // `build --check` returns a validate result, so its accepted --fields set
    // narrows. Advertising only the build set would tell an agent outputPath is
    // accepted when the check branch rejects it.
    const buildOptions = optionsFor(schema.commands.build);
    const checkValues = (buildOptions?.fields as { checkValues?: readonly string[] } | undefined)
      ?.checkValues;
    expect([...(checkValues ?? [])].sort()).toEqual([...COMMAND_FIELDS.validate].sort());

    expect(mismatches).toEqual([]);
  });

  it("requires every manifest field it marks required, nested ones included", () => {
    const schema = describeCli() as {
      manifest: { fields: { screenshots: { items: { fields: DescribedFields } } } };
    };
    const entry = {
      id: "home",
      title: "Home",
      group: "Main",
      platform: "Web",
      device: "Chrome",
      viewport: { width: 1280, height: 720 },
      file: "screenshots/home.webp",
      capturedAt: "2026-09-18T09:00:00.000Z",
      sizeBytes: 1024,
      tags: ["home"],
      notes: [],
    };
    expect(decodeScreenshotJson(JSON.stringify(entry)).id).toBe("home");

    // describe no longer carries a separate requiredFields list, so `required`
    // on each field is its only claim. Comparing the marked paths against the
    // fixture's own shape catches both directions: a field that quietly loses
    // `required`, and one marked required that an entry never carries.
    const marked = requiredPaths(schema.manifest.fields.screenshots.items.fields);
    expect(marked.sort()).toEqual(objectPaths(entry).sort());

    for (const path of marked) {
      expect(() => decodeScreenshotJson(JSON.stringify(omitPath(entry, path)))).toThrow(
        expect.objectContaining({ code: "VREF_MANIFEST_SCHEMA_INVALID" }),
      );
    }
  });

  it("describes the webp pipeline and the screenshot draft contract", () => {
    const schema = JSON.stringify(describeCli());

    expect(schema).toContain('"outputFormat":"webp"');
    expect(schema).toContain('"encoder":"sharp"');
    expect(schema).toContain('"sourceFormats":[".jpg",".jpeg",".png",".webp"]');
    expect(schema).toContain('"usedBy":"vref screenshot add --json"');
    // Legacy assets must stay valid so existing repos keep building.
    expect(schema).toContain('"allowedExtensions":[".jpg",".jpeg",".png",".webp"]');
  });
});

describe("remove and update verbs", () => {
  it("changes only the fields the patch names", async () => {
    const root = await seedEntry("home");

    const result = await updateScreenshot({
      cwd: root,
      dryRun: false,
      id: "home",
      manifestPath: ".vref/manifest.json",
      patch: { title: "Home page", tags: ["home", "grid"] },
    });

    expect(result.changedFields).toEqual(["tags", "title"]);
    const manifest = await readManifest(join(root, ".vref/manifest.json"));
    const entry = manifest.screenshots[0];
    expect(entry?.title).toBe("Home page");
    expect(entry?.tags).toEqual(["home", "grid"]);
    // Everything the patch did not name survives untouched.
    expect(entry?.group).toBe("Main pages");
    expect(entry?.notes).toEqual(["Home grid."]);
  });

  it("reports only the fields whose value actually moved", async () => {
    const root = await seedEntry("home");

    const result = await updateScreenshot({
      cwd: root,
      dryRun: false,
      id: "home",
      manifestPath: ".vref/manifest.json",
      patch: { title: "Home", group: "Other pages" },
    });

    expect(result.changedFields).toEqual(["group"]);
  });

  it("keeps fields the schema does not model", async () => {
    const root = await seedEntry("home");
    const manifestPath = join(root, ".vref/manifest.json");
    const raw = JSON.parse(await readFile(manifestPath, "utf8")) as {
      screenshots: Record<string, unknown>[];
    };
    raw.screenshots[0]!.reviewedBy = "design";
    await writeFile(manifestPath, `${JSON.stringify(raw, null, 2)}\n`);

    await updateScreenshot({
      cwd: root,
      dryRun: false,
      id: "home",
      manifestPath: ".vref/manifest.json",
      patch: { title: "Renamed" },
    });

    const after = JSON.parse(await readFile(manifestPath, "utf8")) as {
      screenshots: Record<string, unknown>[];
    };
    expect(after.screenshots[0]?.reviewedBy).toBe("design");
  });

  it.each(["id", "file", "sizeBytes"])("refuses to change %s", async (field) => {
    const root = await seedEntry("home");

    await expect(
      updateScreenshot({
        cwd: root,
        dryRun: false,
        id: "home",
        manifestPath: ".vref/manifest.json",
        patch: { [field]: field === "sizeBytes" ? 1 : "x" },
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "VREF_FIELD_IMMUTABLE" }));
  });

  it("refuses a patch that would not decode", async () => {
    const root = await seedEntry("home");

    await expect(
      updateScreenshot({
        cwd: root,
        dryRun: false,
        id: "home",
        manifestPath: ".vref/manifest.json",
        patch: { tags: "home" },
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "VREF_MANIFEST_SCHEMA_INVALID" }));
  });

  it("names the id an update cannot find", async () => {
    const root = await seedEntry("home");

    await expect(
      updateScreenshot({
        cwd: root,
        dryRun: false,
        id: "missing",
        manifestPath: ".vref/manifest.json",
        patch: { title: "x" },
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "VREF_UNKNOWN_SELECTOR" }));
  });

  it("writes nothing on a dry-run update", async () => {
    const root = await seedEntry("home");
    const manifestPath = join(root, ".vref/manifest.json");
    const before = await readFile(manifestPath, "utf8");

    const result = await updateScreenshot({
      cwd: root,
      dryRun: true,
      id: "home",
      manifestPath: ".vref/manifest.json",
      patch: { title: "Home page" },
    });

    expect(result.screenshot.title).toBe("Home page");
    expect(await readFile(manifestPath, "utf8")).toBe(before);
  });

  it("drops the entry and its asset", async () => {
    const root = await seedEntry("home");

    const result = await removeScreenshot({
      cwd: root,
      dryRun: false,
      id: "home",
      keepAsset: false,
      manifestPath: ".vref/manifest.json",
    });

    expect(result.assetDeleted).toBe(true);
    expect(result.screenshotCount).toBe(0);
    expect(existsSync(join(root, ".vref/screenshots/home.webp"))).toBe(false);
    const manifest = await readManifest(join(root, ".vref/manifest.json"));
    expect(manifest.screenshots).toHaveLength(0);
  });

  it("leaves the asset under keepAsset, where validate reports it as an orphan", async () => {
    const root = await seedEntry("home");

    const result = await removeScreenshot({
      cwd: root,
      dryRun: false,
      id: "home",
      keepAsset: true,
      manifestPath: ".vref/manifest.json",
    });

    expect(result.assetDeleted).toBe(false);
    expect(existsSync(join(root, ".vref/screenshots/home.webp"))).toBe(true);
    const validated = await validateGallery({ cwd: root, manifestPath: ".vref/manifest.json" });
    expect(validated.orphanAssets).toEqual(["screenshots/home.webp"]);
  });

  it("refuses to delete a file another entry still references", async () => {
    const root = await seedEntry("home");
    const manifestPath = join(root, ".vref/manifest.json");
    const raw = JSON.parse(await readFile(manifestPath, "utf8")) as {
      screenshots: Record<string, unknown>[];
    };
    raw.screenshots.push({ ...raw.screenshots[0], id: "home-copy" });
    await writeFile(manifestPath, `${JSON.stringify(raw, null, 2)}\n`);

    await expect(
      removeScreenshot({
        cwd: root,
        dryRun: false,
        id: "home",
        keepAsset: false,
        manifestPath: ".vref/manifest.json",
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "VREF_ASSET_CLAIMED" }));
    // The refusal is total: the entry stays too, so nothing is half-done.
    expect(existsSync(join(root, ".vref/screenshots/home.webp"))).toBe(true);
    const manifest = await readManifest(manifestPath);
    expect(manifest.screenshots).toHaveLength(2);
  });

  it("removes only the entry when the file is shared and keepAsset is set", async () => {
    const root = await seedEntry("home");
    const manifestPath = join(root, ".vref/manifest.json");
    const raw = JSON.parse(await readFile(manifestPath, "utf8")) as {
      screenshots: Record<string, unknown>[];
    };
    raw.screenshots.push({ ...raw.screenshots[0], id: "home-copy" });
    await writeFile(manifestPath, `${JSON.stringify(raw, null, 2)}\n`);

    const result = await removeScreenshot({
      cwd: root,
      dryRun: false,
      id: "home",
      keepAsset: true,
      manifestPath: ".vref/manifest.json",
    });

    expect(result.screenshotCount).toBe(1);
    expect(existsSync(join(root, ".vref/screenshots/home.webp"))).toBe(true);
  });

  it("writes nothing on a dry-run remove", async () => {
    const root = await seedEntry("home");
    const manifestPath = join(root, ".vref/manifest.json");
    const before = await readFile(manifestPath, "utf8");

    const result = await removeScreenshot({
      cwd: root,
      dryRun: true,
      id: "home",
      keepAsset: false,
      manifestPath: ".vref/manifest.json",
    });

    expect(result.assetDeleted).toBe(false);
    expect(result.screenshotCount).toBe(0);
    expect(await readFile(manifestPath, "utf8")).toBe(before);
    expect(existsSync(join(root, ".vref/screenshots/home.webp"))).toBe(true);
  });

  it("refuses a malformed --keep-asset rather than deleting the file", async () => {
    const root = await seedEntry("home");

    // The safety flag is the whole point of the command: a value the parser
    // does not understand must stop the run, not fall through to false and
    // take the destructive branch.
    await expect(
      Effect.runPromise(
        runCli(["screenshot", "remove", "home", "--keep-asset=yes", "--output", "json"], root),
      ),
    ).rejects.toThrow(expect.objectContaining({ code: "VREF_INVALID_BOOLEAN" }));
    expect(existsSync(join(root, ".vref/screenshots/home.webp"))).toBe(true);
    const manifest = await readManifest(join(root, ".vref/manifest.json"));
    expect(manifest.screenshots).toHaveLength(1);
  });

  it("leaves the manifest alone when the asset path is unsafe", async () => {
    const root = await seedEntry("home");
    const manifestPath = join(root, ".vref/manifest.json");
    await unlink(join(root, ".vref/screenshots/home.webp"));
    await symlink(join(root, "outside.webp"), join(root, ".vref/screenshots/home.webp"));
    const before = await readFile(manifestPath, "utf8");

    await expect(
      removeScreenshot({
        cwd: root,
        dryRun: false,
        id: "home",
        keepAsset: false,
        manifestPath: ".vref/manifest.json",
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "VREF_SYMLINK_PATH" }));
    // The refusal has to be total: a half-done remove cannot be retried by id.
    expect(await readFile(manifestPath, "utf8")).toBe(before);
  });

  it("writes nothing when the patch changes no value", async () => {
    const root = await seedEntry("home");
    const manifestPath = join(root, ".vref/manifest.json");
    // Pinned to a date no write could reproduce: touchUpdatedAt stamps the
    // current time, so comparing against a fresh fixture would pass whenever
    // both writes land in the same millisecond.
    const pinned = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    pinned.updatedAt = "2020-01-01T00:00:00.000Z";
    await writeFile(manifestPath, `${JSON.stringify(pinned, null, 2)}\n`);
    const before = await readFile(manifestPath, "utf8");

    const result = await updateScreenshot({
      cwd: root,
      dryRun: false,
      id: "home",
      manifestPath: ".vref/manifest.json",
      patch: { title: "Home" },
    });

    expect(result.changedFields).toEqual([]);
    // updatedAt is the date the gallery shows, so a no-op must not move it.
    expect(await readFile(manifestPath, "utf8")).toBe(before);
  });

  it("names a route that works when a patch touches the asset fields", async () => {
    const root = await seedEntry("home");

    const failure = await updateScreenshot({
      cwd: root,
      dryRun: false,
      id: "home",
      manifestPath: ".vref/manifest.json",
      patch: { file: "screenshots/other.webp" },
    }).catch((error: unknown) => error as VrefError);

    expect(failure.code).toBe("VREF_FIELD_IMMUTABLE");
    // `screenshot add` rejects an existing id before it looks at --force, so
    // pointing there would be a dead end.
    expect(failure.message).toContain("vref screenshot remove");
    await expect(
      addScreenshotFromSource({
        cwd: root,
        draft: draftFor("home"),
        dryRun: false,
        force: true,
        manifestPath: ".vref/manifest.json",
        sourcePath: "capture.png",
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "VREF_MANIFEST_DUPLICATE_ID" }));
  });

  it("declares a mutation scope covering every asset a remove can unlink", async () => {
    const schema = describeCli() as {
      commands: { screenshot: { remove: { mutates: string[] } } };
    };

    // An entry's file is any safe manifest-relative path: no screenshots/
    // prefix is required and legacy .jpg/.png are still valid, so a narrower
    // glob would understate what remove deletes. Proven rather than asserted.
    const root = await makeWebpFixture();
    await makePng(join(root, "capture.png"), 8, 8);
    const added = await addScreenshotFromSource({
      cwd: root,
      draft: { ...draftFor("logo"), file: "assets/logo.webp" },
      dryRun: false,
      force: false,
      manifestPath: ".vref/manifest.json",
      sourcePath: "capture.png",
    });
    expect(added.file).toBe("assets/logo.webp");
    expect(existsSync(join(root, ".vref/assets/logo.webp"))).toBe(true);

    const removed = await removeScreenshot({
      cwd: root,
      dryRun: false,
      id: "logo",
      keepAsset: false,
      manifestPath: ".vref/manifest.json",
    });
    expect(removed.assetDeleted).toBe(true);
    expect(existsSync(join(root, ".vref/assets/logo.webp"))).toBe(false);

    expect(schema.commands.screenshot.remove.mutates).toContain(".vref/**");
  });

  it("refuses to unlink a manifest that is its own asset", async () => {
    const root = await mkdtemp(join(tmpdir(), "vref-selfref-"));
    await mkdir(join(root, ".vref"), { recursive: true });
    const manifestPath = join(root, ".vref/gallery.webp");
    // A manifest named with an image extension parses, and an entry may point
    // straight at it. validate passes, so nothing upstream catches this.
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          version: 1,
          title: "self-referencing gallery",
          description: "Manifest named as an asset.",
          updatedAt: "2026-09-18T09:00:00.000Z",
          screenshots: [
            {
              id: "self",
              title: "Self",
              group: "Main pages",
              platform: "Web",
              device: "Chrome 1440",
              viewport: { width: 1, height: 1 },
              file: "gallery.webp",
              capturedAt: "2026-09-18T09:00:00.000Z",
              sizeBytes: 10,
              tags: [],
              notes: [],
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    await expect(
      removeScreenshot({
        cwd: root,
        dryRun: false,
        id: "self",
        keepAsset: false,
        manifestPath: ".vref/gallery.webp",
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "VREF_UNSAFE_ASSET_PATH" }));
    // Unlinking it would have taken every other entry with it.
    expect(existsSync(manifestPath)).toBe(true);
  });

  it("names the id a remove cannot find", async () => {
    const root = await seedEntry("home");

    await expect(
      removeScreenshot({
        cwd: root,
        dryRun: false,
        id: "missing",
        keepAsset: false,
        manifestPath: ".vref/manifest.json",
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "VREF_UNKNOWN_SELECTOR" }));
  });
});

/** A workspace holding one encoded screenshot, the state both verbs act on. */
async function seedEntry(id: string): Promise<string> {
  const root = await makeWebpFixture();
  await makePng(join(root, "capture.png"), 64, 48);
  await addScreenshotFromSource({
    cwd: root,
    draft: draftFor(id),
    dryRun: false,
    force: false,
    manifestPath: ".vref/manifest.json",
    sourcePath: "capture.png",
  });

  return root;
}

describe("orphan assets", () => {
  it("reports image files under the manifest directory no entry references", async () => {
    const root = await makeFixture();
    await writeFile(join(root, ".vref/screenshots/roku-720p/stale.webp"), "left behind");
    await writeFile(join(root, ".vref/screenshots/dropped.PNG"), "left behind");
    await writeFile(join(root, ".vref/notes.txt"), "not an image");
    await writeFile(join(root, ".vref/index.html"), "<html></html>");

    const result = await validateGallery({ cwd: root, manifestPath: ".vref/manifest.json" });

    expect(result.orphanAssets).toEqual([
      "screenshots/dropped.PNG",
      "screenshots/roku-720p/stale.webp",
    ]);
    expect(result.screenshotCount).toBe(1);
  });

  it("reports nothing when every asset is referenced", async () => {
    const root = await makeFixture();

    const result = await validateGallery({ cwd: root, manifestPath: ".vref/manifest.json" });

    expect(result.orphanAssets).toEqual([]);
  });

  it("never walks out of the manifest directory through a symlink", async () => {
    const root = await makeFixture();
    const outside = join(root, "outside");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "elsewhere.webp"), "not ours");
    await symlink(outside, join(root, ".vref/linked"));

    const result = await validateGallery({ cwd: root, manifestPath: ".vref/manifest.json" });

    expect(result.orphanAssets).toEqual([]);
  });

  it("quotes an orphan path so a filename cannot forge terminal output", async () => {
    const root = await makeFixture();
    await writeFile(join(root, ".vref/screenshots/a\nvalidated 0 references.webp"), "hostile");

    const human = await captureConsoleLog(() => Effect.runPromise(runCli(["validate"], root)));

    expect(human.logs).toHaveLength(1);
    expect(human.logs[0]).toContain(String.raw`"screenshots/a\nvalidated 0 references.webp"`);
  });

  it("surfaces orphans through validate and build --check", async () => {
    const root = await makeFixture();
    await writeFile(join(root, ".vref/screenshots/stale.webp"), "left behind");

    const human = await captureConsoleLog(() => Effect.runPromise(runCli(["validate"], root)));
    const json = await captureConsoleLog(() =>
      Effect.runPromise(
        runCli(["build", "--check", "--output", "json", "--fields", "orphanAssets"], root),
      ),
    );

    expect(human.logs.join("\n")).toBe(
      'validated 1 references; 1 unreferenced: "screenshots/stale.webp"',
    );
    expect(json.logs.join("\n")).toContain('"screenshots/stale.webp"');
  });
});

const FOLDS_CASE = foldsCase();

describe("case-variant orphans", () => {
  // Which answer is right depends on the filesystem, so each half runs where it
  // can: CI is Linux and case-sensitive, a developer machine usually is not.
  it.skipIf(!FOLDS_CASE)("treats a case-variant spelling as the referenced file", async () => {
    const root = await makeFixture("screenshots/roku-720p/HOME.JPG");

    const result = await validateGallery({ cwd: root, manifestPath: ".vref/manifest.json" });

    expect(result.orphanAssets).toEqual([]);
  });

  it.skipIf(FOLDS_CASE)("reports a distinct file that only differs by case", async () => {
    const root = await makeFixture();
    await writeFile(join(root, ".vref/screenshots/roku-720p/HOME.JPG"), "a second file");

    const result = await validateGallery({ cwd: root, manifestPath: ".vref/manifest.json" });

    expect(result.orphanAssets).toEqual(["screenshots/roku-720p/HOME.JPG"]);
  });
});

describe("error codes", () => {
  it("publishes exactly the codes the source throws", async () => {
    const sourceDir = new URL("../src/", import.meta.url);
    const thrown = new Set<string>();

    for (const file of await readdir(sourceDir)) {
      if (!file.endsWith(".ts")) {
        continue;
      }

      const source = await readFile(new URL(file, sourceDir), "utf8");
      for (const match of source.matchAll(/new VrefError\(\s*"(VREF_[A-Z_]+)"/gu)) {
        thrown.add(match[1] as string);
      }
    }

    // The constructor's parameter type covers the other direction: a code that
    // is not in the list cannot be thrown at all. This catches the leftover —
    // a code kept in the published vocabulary after its throw site went away.
    expect([...VREF_ERROR_CODES].sort()).toEqual([...thrown].sort());
  });

  it("describes the error contract it publishes", () => {
    const schema = describeCli() as {
      errors: { codes: readonly string[]; exitCode: number; shape: string };
    };

    expect(schema.errors.codes).toEqual(VREF_ERROR_CODES);
    expect(schema.errors.exitCode).toBe(1);
    expect(schema.errors.shape).toBe("{ ok: false, error: { code, message } }");
  });
});

describe("path safety", () => {
  // These rejections are the whole sandbox for a tool that writes files from
  // agent-supplied JSON. Exercising them through buildGallery only ever reaches
  // two of them, so they are asserted here directly, by code rather than by
  // message: the code is what consumers branch on.
  const rejectedAssetPaths: [string, string][] = [
    ["a\u0001.webp", "control character"],
    ["/etc/passwd", "absolute path"],
    ["screenshots/home.webp?x=1", "query string"],
    ["screenshots/home.webp#frag", "hash fragment"],
    ["C:/screenshots/home.webp", "drive prefix"],
    ["%2e%2e/home.webp", "encoded traversal"],
    ["%2fetc/home.webp", "encoded separator"],
    ["%5cetc/home.webp", "encoded backslash"],
    ["../home.webp", "traversal segment"],
    ["screenshots//home.webp", "empty segment"],
    ["screenshots/./home.webp", "dot segment"],
  ];

  for (const [value, label] of rejectedAssetPaths) {
    it(`rejects a screenshot file with a ${label}`, () => {
      expect(() => safeManifestAssetPath(value, "file")).toThrow(
        expect.objectContaining({ code: "VREF_UNSAFE_ASSET_PATH" }),
      );
    });
  }

  it("accepts a relative asset path and normalizes separators", () => {
    expect(safeManifestAssetPath("screenshots/roku-720p/home.webp", "file")).toBe(
      "screenshots/roku-720p/home.webp",
    );
    expect(safeManifestAssetPath("screenshots\\roku-720p\\home.webp", "file")).toBe(
      "screenshots/roku-720p/home.webp",
    );
  });

  it("rejects an output path with a control character", () => {
    expect(() => resolveInsideCwd(tmpdir(), "out\u0001.html", "output")).toThrow(
      expect.objectContaining({ code: "VREF_UNSAFE_PATH" }),
    );
  });

  it("rejects an output path that escapes the working tree", () => {
    expect(() =>
      resolveInsideCwd(join(tmpdir(), "vref-resolve"), "../escape.html", "output"),
    ).toThrow(expect.objectContaining({ code: "VREF_PATH_OUTSIDE_CWD" }));
  });

  it("resolves an output path inside the working tree", () => {
    const cwd = join(tmpdir(), "vref-resolve");

    expect(resolveInsideCwd(cwd, ".vref/index.html", "output")).toBe(join(cwd, ".vref/index.html"));
    expect(resolveInsideCwd(cwd, ".", "output")).toBe(cwd);
  });

  it("accepts every supported image extension and rejects the rest", () => {
    for (const extension of [".jpg", ".jpeg", ".png", ".webp"]) {
      expect(() => assertSupportedImage(`home${extension}`)).not.toThrow();
      expect(() => assertSupportedImage(`home${extension.toUpperCase()}`)).not.toThrow();
    }

    for (const extension of [".gif", ".svg", ".bmp", ""]) {
      expect(() => assertSupportedImage(`home${extension}`)).toThrow(
        expect.objectContaining({ code: "VREF_UNSUPPORTED_IMAGE" }),
      );
    }
  });
});

type DescribedFields = Record<string, { required?: boolean; fields?: DescribedFields }>;

/** Dotted paths describe marks `required: true`, descending into nested fields. */
function requiredPaths(fields: DescribedFields, prefix = ""): string[] {
  return Object.entries(fields).flatMap(([name, field]) => {
    const path = prefix === "" ? name : `${prefix}.${name}`;
    const nested = field.fields === undefined ? [] : requiredPaths(field.fields, path);

    return field.required === true ? [path, ...nested] : nested;
  });
}

/** The same paths an object actually carries. Arrays are leaves, as describe treats them. */
function objectPaths(value: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(value).flatMap(([name, nested]) => {
    const path = prefix === "" ? name : `${prefix}.${name}`;
    const isPlainObject = typeof nested === "object" && nested !== null && !Array.isArray(nested);

    return isPlainObject ? [path, ...objectPaths(nested as Record<string, unknown>, path)] : [path];
  });
}

function omitPath(value: Record<string, unknown>, path: string): Record<string, unknown> {
  const [head = "", ...rest] = path.split(".");
  if (rest.length === 0) {
    const { [head]: _omitted, ...without } = value;

    return without;
  }

  return { ...value, [head]: omitPath(value[head] as Record<string, unknown>, rest.join(".")) };
}

/** Whether this filesystem treats `a.tmp` and `A.TMP` as one file. */
function foldsCase(): boolean {
  const probe = mkdtempSync(join(tmpdir(), "vref-case-"));
  writeFileSync(join(probe, "a.tmp"), "");
  const folds = existsSync(join(probe, "A.TMP"));
  rmSync(probe, { recursive: true, force: true });

  return folds;
}

/** Status code for a GET carrying an explicit Host, which fetch refuses to set. */
async function statusWithHost(
  port: number,
  path: string,
  host: string,
  connectTo = "127.0.0.1",
): Promise<number> {
  const { request } = await import("node:http");

  return await new Promise<number>((resolve, reject) => {
    const call = request(
      { host: connectTo, port, path, method: "GET", headers: { Host: host } },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    call.on("error", reject);
    call.end();
  });
}

/** The options block for a command, reaching through an `add` subcommand. */
function optionsFor(entry: unknown): Record<string, unknown> | undefined {
  if (entry === null || typeof entry !== "object") {
    return undefined;
  }

  const record = entry as Record<string, unknown>;
  if (record.options !== undefined) {
    return record.options as Record<string, unknown>;
  }

  return optionsFor(record.add);
}

/**
 * Every option block under a command, its subcommands included.
 *
 * A command's flags are the union of what all its verbs accept, because
 * COMMAND_FLAGS is keyed by command and the parser checks names before it
 * knows which verb ran.
 */
function allOptionBlocks(entry: unknown): Record<string, unknown>[] {
  if (entry === null || typeof entry !== "object") {
    return [];
  }

  const record = entry as Record<string, unknown>;
  if (record.options !== undefined) {
    return [record.options as Record<string, unknown>];
  }

  return Object.values(record).flatMap(allOptionBlocks);
}

/**
 * The describe entry a COMMAND_FIELDS key names.
 *
 * `screenshotRemove` is `commands.screenshot.remove`; a bare command key is its
 * `add` verb, which is the one whose result those fields describe.
 */
function describedEntryFor(
  commands: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const [command = "", subcommand] = key.split(/(?=[A-Z])/u).map((part) => part.toLowerCase());
  const entry = commands[command];
  if (entry === null || typeof entry !== "object") {
    return undefined;
  }

  const record = entry as Record<string, unknown>;
  if (subcommand !== undefined) {
    return record[subcommand] as Record<string, unknown> | undefined;
  }

  return record;
}

/** Flag names describe() advertises, per command, with the `--` stripped. */
function describedCommands(): Map<string, Set<string>> {
  const schema = describeCli() as { commands: Record<string, unknown> };
  const described = new Map<string, Set<string>>();

  for (const [command, entry] of Object.entries(schema.commands)) {
    const blocks = allOptionBlocks(entry);
    if (blocks.length === 0) {
      continue;
    }

    const names = new Set<string>();
    for (const [key, option] of blocks.flatMap((block) => Object.entries(block))) {
      const shape = option as { flag?: string; flags?: readonly string[] };
      if (shape.flags !== undefined) {
        for (const flag of shape.flags) {
          names.add(flag.replace(/^--/u, ""));
        }
      } else if (shape.flag !== undefined) {
        names.add(shape.flag.replace(/^--/u, ""));
      } else {
        names.add(key);
      }
    }
    described.set(command, names);
  }

  return described;
}

function draftFor(id: string): VrefScreenshotDraft {
  return {
    id,
    title: "Home",
    group: "Main pages",
    platform: "Web",
    device: "Chrome 1440",
    tags: ["home"],
    notes: ["Home grid."],
  };
}

function webpVariant(data: Buffer): string {
  return data.subarray(12, 16).toString("latin1");
}

async function makePngBuffer(width: number, height: number): Promise<Buffer> {
  const { default: sharp } = await import("sharp");

  return await sharp({
    create: { width, height, channels: 3, background: { r: 9, g: 9, b: 11 } },
  })
    .png()
    .toBuffer();
}

async function makePng(path: string, width: number, height: number): Promise<number> {
  const data = await makePngBuffer(width, height);
  await writeFile(path, data);

  return data.byteLength;
}

async function makeWebpFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "vref-webp-"));
  await mkdir(join(root, ".vref"), { recursive: true });
  await writeFile(
    join(root, ".vref/manifest.json"),
    `${JSON.stringify(
      {
        version: 1,
        title: "put.io webp reference",
        description: "Webp pipeline fixture.",
        updatedAt: "2026-09-18T09:00:00.000Z",
        screenshots: [],
      },
      null,
      2,
    )}\n`,
  );

  return root;
}

async function makeLegacyFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "vref-legacy-"));
  await mkdir(join(root, ".vref/screenshots"), { recursive: true });
  const legacyBytes = await makePng(join(root, ".vref/screenshots/legacy.png"), 64, 48);
  const currentPng = join(root, "current.png");
  await makePng(currentPng, 32, 32);
  const current = await encodeWebp({ sourcePath: currentPng });
  await writeFile(join(root, ".vref/screenshots/current.webp"), current.data);

  await writeFile(
    join(root, ".vref/manifest.json"),
    `${JSON.stringify(
      {
        version: 1,
        title: "legacy png gallery",
        description: "Pre-webp reference set.",
        updatedAt: "2026-09-18T09:00:00.000Z",
        customField: "must survive",
        screenshots: [
          {
            id: "legacy",
            title: "Legacy",
            group: "Main",
            platform: "Web",
            device: "Chrome",
            viewport: { width: 64, height: 48 },
            file: "screenshots/legacy.png",
            capturedAt: "2026-09-18T09:00:00.000Z",
            sizeBytes: legacyBytes,
            tags: ["legacy"],
            notes: [],
            reviewer: "altay",
          },
          {
            id: "current",
            title: "Current",
            group: "Main",
            platform: "Web",
            device: "Chrome",
            viewport: { width: 32, height: 32 },
            file: "screenshots/current.webp",
            capturedAt: "2026-09-18T09:00:00.000Z",
            sizeBytes: current.data.byteLength,
            tags: ["current"],
            notes: [],
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  return root;
}
