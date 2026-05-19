import { mkdir, mkdtemp, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGallery } from "../src/build.js";
import { describeCli } from "../src/describe.js";
import { resolveServableFile } from "../src/serve.js";
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
    expect(html).toContain("screenshots/roku-720p/home.jpg");
  });

  it("refuses servable file paths that resolve outside the serve root", async () => {
    const root = await makeFixture();
    await writeFile(join(root, "secret.txt"), "secret");
    await symlink(join(root, "secret.txt"), join(root, ".vref/screenshots/roku-720p/leak.txt"));

    await expect(
      resolveServableFile(join(root, ".vref"), "screenshots/roku-720p/leak.txt"),
    ).rejects.toThrow("serve root");
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

    expect(schema).toContain('"flags":["--out","--output-path"]');
    expect(schema).not.toContain('"approve"');
    expect(schema).not.toContain('"output":{"type":"string","default":".vref/index.html"}');
  });
});

async function makeFixture(file = "screenshots/roku-720p/home.jpg"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "vref-"));
  await mkdir(join(root, ".vref/screenshots/roku-720p"), { recursive: true });
  await writeFile(join(root, ".vref/screenshots/roku-720p/home.jpg"), "image");

  const manifest = makeManifest(file);

  await writeFile(join(root, ".vref/manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  return root;
}

function makeManifest(file: string): VrefManifest {
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
        tags: ["home", "navigation"],
        notes: ["Home menu."],
      },
    ],
  };
}
