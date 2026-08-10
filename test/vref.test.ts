import { mkdir, mkdtemp, readFile, realpath, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { buildGallery, validateGallery } from "../src/build.js";
import { isDirectInvocation, runCli } from "../src/cli.js";
import { describeCli } from "../src/describe.js";
import { VrefError } from "../src/errors.js";
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
      'data-title="Phone" data-platform="ios" data-group="screens" data-tags="phone" data-orientation="portrait"',
    );
    expect(html).toContain(
      'data-title="Square" data-platform="ios" data-group="components" data-tags="component" data-orientation="square"',
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
    expect(html).toContain('data-tags="home"');
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

  it("rejects date-like strings that are not ISO date-times", async () => {
    const root = await makeFixture();
    const manifest = makeManifest("screenshots/roku-720p/home.jpg", ["home"]);
    await writeFile(
      join(root, ".vref/manifest.json"),
      `${JSON.stringify({ ...manifest, updatedAt: "2026" }, null, 2)}\n`,
    );

    await expect(
      validateGallery({ cwd: root, manifestPath: ".vref/manifest.json" }),
    ).rejects.toThrow("ISO date-time");
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
    expect(html).toContain('data-filter-group="tag" data-filter-value="search"');
    expect(html).toContain('data-filter-group="tag" data-filter-value="shared"');
    expect(html).toContain('type="radio" name="filter-tag" id="filter-tag-search"');
    expect(html).toContain(
      '.container:has(#filter-tag-search:checked) #gallery .card:not([data-tags~="search"]) { display: none; }',
    );
    expect(html).not.toContain('data-filter-group="tag" data-filter-value="keyboard"');
    expect(html).not.toContain('data-filter-group="tag" data-filter-value="device"');
    expect(html).toContain('data-tags="search shared keyboard"');
    expect(html).toContain('data-tags="search shared device"');
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
    expect(html).toContain('data-filter-group="group" data-filter-value="main-pages"');
    expect(html).toContain('data-filter-group="group" data-filter-value="settings"');
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
