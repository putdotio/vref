import {
  chmod,
  mkdir,
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
import { connect, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Cause, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { buildGallery, validateGallery } from "../src/build.js";
import { isDirectInvocation, recoverCliProgram, runCli } from "../src/cli.js";
import { convertGallery } from "../src/convert.js";
import { describeCli } from "../src/describe.js";
import { VrefError } from "../src/errors.js";
import { encodeWebp } from "../src/image.js";
import { readManifest, type VrefScreenshotDraft } from "../src/manifest.js";
import { addScreenshotFromSource } from "../src/screenshot-add.js";
import { resolveServableFile, serve } from "../src/serve.js";
import type { VrefManifest } from "../src/types.js";

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
    expect(html).toContain("1 reference &middot; Updated May 19, 2026");
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
    ).rejects.toThrow("date string");
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
    ).rejects.toThrow("serve root");
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
    ).rejects.toThrow("traversal");
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
    ).rejects.toThrow("symlinks");
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
    ).rejects.toThrow("symlinks");

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
    ).rejects.toThrow("URL schemes");
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
    ).rejects.toThrow("Unknown --fields value");

    await expect(readFile(join(root, ".vref/index.html"), "utf8")).rejects.toThrow();

    await expect(
      Effect.runPromise(
        runCli(["manifest", "add", "--json", JSON.stringify(screenshot), "--fields", "nope"], root),
      ),
    ).rejects.toThrow("Unknown --fields value");

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
    ).rejects.toThrow("true/false");

    const manifest = await readFile(join(root, ".vref/manifest.json"), "utf8");
    expect(manifest).not.toContain('"settings"');

    await expect(Effect.runPromise(runCli(["build", "--check", "yes"], root))).rejects.toThrow(
      "true/false",
    );

    await expect(readFile(join(root, ".vref/index.html"), "utf8")).rejects.toThrow();

    await expect(
      Effect.runPromise(runCli(["build", "--check", "true", "--dry-run", "yes"], root)),
    ).rejects.toThrow("true/false");
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
    ).rejects.toThrow("symlinks");

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
    await expect(stat(join(root, ".vref/screenshots/home.webp"))).rejects.toThrow();
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
    ).rejects.toThrow("already has screenshot id");
    await expect(stat(join(root, ".vref/screenshots/home.webp"))).rejects.toThrow();
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
    ).rejects.toThrow("--force");

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
    ).rejects.toThrow("must end in .webp");

    await expect(
      addScreenshotFromSource({
        cwd: root,
        draft: { ...draftFor("home"), file: "../escaped.webp" },
        dryRun: false,
        force: false,
        manifestPath: ".vref/manifest.json",
        sourcePath: "capture.png",
      }),
    ).rejects.toThrow("traversal");
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
    ).rejects.toThrow("source image must be");
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
    await expect(stat(join(root, ".vref/screenshots/legacy.png"))).rejects.toThrow();
    await expect(
      validateGallery({ cwd: root, manifestPath: ".vref/manifest.json" }),
    ).resolves.toMatchObject({ screenshotCount: 2 });
  });

  it("keeps the original asset with keepSource and honours only", async () => {
    const root = await makeLegacyFixture();

    const result = await convertGallery({
      cwd: root,
      dryRun: false,
      force: false,
      keepSource: true,
      manifestPath: ".vref/manifest.json",
      only: ["missing-id"],
    });
    expect(result.convertedCount).toBe(0);
    expect(result.skippedCount).toBe(2);

    const kept = await convertGallery({
      cwd: root,
      dryRun: false,
      force: false,
      keepSource: true,
      manifestPath: ".vref/manifest.json",
      only: ["legacy"],
    });
    expect(kept.convertedCount).toBe(1);
    await expect(stat(join(root, ".vref/screenshots/legacy.png"))).resolves.toBeTruthy();
    await expect(stat(join(root, ".vref/screenshots/legacy.webp"))).resolves.toBeTruthy();
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
    await expect(stat(join(root, ".vref/screenshots/legacy.png"))).rejects.toThrow();
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
    ).rejects.toThrow("both convert to");

    // Nothing was written, so neither reference was lost.
    await expect(stat(join(root, ".vref/screenshots/legacy.png"))).resolves.toBeTruthy();
    await expect(stat(join(root, ".vref/screenshots/legacy.jpg"))).resolves.toBeTruthy();
    await expect(stat(join(root, ".vref/screenshots/legacy.webp"))).rejects.toThrow();
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
    ).rejects.toThrow("both convert to");

    await expect(stat(join(root, ".vref/screenshots/legacy.png"))).resolves.toBeTruthy();
    await expect(stat(join(root, ".vref/screenshots/LEGACY.jpg"))).resolves.toBeTruthy();
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
    await expect(stat(join(root, ".vref/screenshots/legacy.png"))).resolves.toBeTruthy();
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

    await expect(stat(join(root, ".vref/screenshots/legacy.png"))).resolves.toBeTruthy();
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
    ).rejects.toThrow("without any value");
    await expect(
      Effect.runPromise(runCli(["convert", "--only=,,,", "--output", "json"], root)),
    ).rejects.toThrow("without any value");

    // The legacy asset is untouched by the rejected runs.
    await expect(stat(join(root, ".vref/screenshots/legacy.png"))).resolves.toBeTruthy();
  });

  it("rolls back a written asset when the manifest append fails", async () => {
    const root = await makeWebpFixture();
    await makePng(join(root, "capture.png"), 16, 16);
    // Valid to read, impossible to write back: the append fails only after the
    // asset has already landed, which is the path rollback exists for.
    await chmod(join(root, ".vref/manifest.json"), 0o444);

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

    await expect(stat(join(root, ".vref/screenshots/home.webp"))).rejects.toThrow();
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
    await expect(stat(join(root, ".vref/screenshots/legacy.webp"))).rejects.toThrow();
    await expect(stat(join(root, ".vref/screenshots/legacy.png"))).resolves.toBeTruthy();
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
    await chmod(join(root, ".vref/manifest.json"), 0o444);

    await expect(
      convertGallery({
        cwd: root,
        dryRun: false,
        force: false,
        keepSource: false,
        manifestPath: ".vref/manifest.json",
      }),
    ).rejects.toThrow();

    // No half-written webp is left for a later run to trip over.
    await expect(stat(join(root, ".vref/screenshots/legacy.webp"))).rejects.toThrow();
    await expect(stat(join(root, ".vref/screenshots/legacy.png"))).resolves.toBeTruthy();
    expect(await readFile(join(root, ".vref/manifest.json"), "utf8")).toBe(before);
  });

  it("restores the replaced asset when a forced add fails", async () => {
    const root = await makeWebpFixture();
    await makePng(join(root, "capture.png"), 16, 16);
    await mkdir(join(root, ".vref/screenshots"), { recursive: true });
    const original = Buffer.from("original bytes");
    await writeFile(join(root, ".vref/screenshots/home.webp"), original);
    await chmod(join(root, ".vref/manifest.json"), 0o444);

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

    const after = await readFile(join(root, ".vref/screenshots/home.webp"));
    expect(after.equals(original)).toBe(true);
  });

  it("rejects a --manifest flag passed without a value", async () => {
    const root = await makeLegacyFixture();

    await expect(
      Effect.runPromise(runCli(["convert", "--manifest", "--output", "json"], root)),
    ).rejects.toThrow("without a value");
    await expect(
      Effect.runPromise(runCli(["validate", "--manifest=", "--output", "json"], root)),
    ).rejects.toThrow("without a value");
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
      Effect.runPromise(runCli(["screenshot", "remove", "--output", "json"], root)),
    ).rejects.toThrow("vref screenshot add");
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

async function makePng(path: string, width: number, height: number): Promise<number> {
  const { default: sharp } = await import("sharp");
  const data = await sharp({
    create: { width, height, channels: 3, background: { r: 9, g: 9, b: 11 } },
  })
    .png()
    .toBuffer();
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
