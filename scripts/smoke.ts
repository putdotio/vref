import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Predicate } from "effect";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(repoRoot, "dist/cli.mjs");

const describe = runCli(repoRoot, ["describe", "--output", "json"]);
assert.equal(describe.status, 0, failureMessage("describe", describe));

const describeOutput = parseRecord(describe.stdout, "describe output");
assert.equal(describeOutput.ok, true);
const describeResult = requireRecord(describeOutput.result, "describe result");
assert.equal(describeResult.name, "vref");
assert.equal(describeResult.package, "@putdotio/vref");

const fixtureRoot = mkdtempSync(join(tmpdir(), "vref-smoke-"));

try {
  const invalidConfig = runCli(fixtureRoot, ["validate", "--output", "json"]);
  assert.equal(invalidConfig.status, 1, failureMessage("invalid config", invalidConfig));

  const errorOutput = parseRecord(invalidConfig.stderr, "error output");
  assert.equal(errorOutput.ok, false);
  const error = requireRecord(errorOutput.error, "error details");
  assert.equal(error.code, "VREF_MANIFEST_READ_FAILED");

  await writeFixture(fixtureRoot);

  const validate = runCli(fixtureRoot, ["validate", "--output", "json"]);
  assert.equal(validate.status, 0, failureMessage("validate", validate));

  const validateOutput = parseRecord(validate.stdout, "validate output");
  assert.equal(validateOutput.ok, true);
  const validateResult = requireRecord(validateOutput.result, "validate result");
  assert.equal(validateResult.screenshotCount, 1);
  assert.equal(validateResult.groupCount, 1);
  assert.equal(validateResult.deviceCount, 1);

  const build = runCli(fixtureRoot, ["build", "--output", "json"]);
  assert.equal(build.status, 0, failureMessage("build", build));

  const buildOutput = parseRecord(build.stdout, "build output");
  assert.equal(buildOutput.ok, true);
  const buildResult = requireRecord(buildOutput.result, "build result");
  assert.equal(buildResult.screenshotCount, 1);

  const gallery = readFileSync(join(fixtureRoot, ".vref/index.html"), "utf8");
  assert.match(gallery, /vref smoke gallery/u);
  assert.match(gallery, /screenshots\/home\.png/u);

  const convert = runCli(fixtureRoot, ["convert", "--output", "json"]);
  assert.equal(convert.status, 0, failureMessage("convert", convert));

  const convertResult = requireRecord(
    parseRecord(convert.stdout, "convert output").result,
    "convert result",
  );
  assert.equal(convertResult.convertedCount, 1);
  assert.ok(
    Number(convertResult.savedBytes) > 0,
    `convert saved no bytes: ${String(convertResult.savedBytes)}`,
  );
  assert.ok(
    !existsSync(join(fixtureRoot, ".vref/screenshots/home.png")),
    "convert left the original png behind",
  );

  const add = runCli(fixtureRoot, [
    "screenshot",
    "add",
    "capture.png",
    "--json",
    JSON.stringify({
      id: "settings",
      title: "Settings",
      group: "Smoke",
      platform: "Web",
      device: "Fixture",
      tags: ["smoke"],
      notes: ["Packaged CLI ingest."],
    }),
    "--output",
    "json",
  ]);
  assert.equal(add.status, 0, failureMessage("screenshot add", add));

  const addResult = requireRecord(
    parseRecord(add.stdout, "screenshot add output").result,
    "screenshot add result",
  );
  assert.equal(addResult.file, "screenshots/settings.webp");
  const addedScreenshot = requireRecord(addResult.screenshot, "added screenshot");
  assert.equal(
    addedScreenshot.sizeBytes,
    statSync(join(fixtureRoot, ".vref/screenshots/settings.webp")).size,
    "manifest sizeBytes does not match the encoded file",
  );

  const rebuild = runCli(fixtureRoot, ["build", "--output", "json"]);
  assert.equal(rebuild.status, 0, failureMessage("rebuild", rebuild));

  const webpGallery = readFileSync(join(fixtureRoot, ".vref/index.html"), "utf8");
  assert.match(webpGallery, /screenshots\/home\.webp/u);
  assert.match(webpGallery, /screenshots\/settings\.webp/u);
  assert.doesNotMatch(webpGallery, /screenshots\/home\.png/u);
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log(
  JSON.stringify({
    ok: true,
    checks: [
      "describe",
      "invalid-config",
      "validate",
      "build",
      "convert",
      "screenshot-add",
      "rebuild",
    ],
  }),
);

async function writeFixture(root: string): Promise<void> {
  const manifestDirectory = join(root, ".vref");
  const screenshotDirectory = join(manifestDirectory, "screenshots");
  mkdirSync(screenshotDirectory, { recursive: true });

  // Real pixels: the convert and screenshot add checks below exercise the
  // encoder, which a placeholder string would fail on for the wrong reason.
  const png = await makePng();
  writeFileSync(join(screenshotDirectory, "home.png"), png);
  writeFileSync(join(root, "capture.png"), png);
  writeFileSync(
    join(manifestDirectory, "manifest.json"),
    JSON.stringify(
      {
        version: 1,
        title: "vref smoke gallery",
        description: "Packaged CLI smoke fixture.",
        updatedAt: "2026-08-01T00:00:00.000Z",
        screenshots: [
          {
            id: "home",
            title: "Home",
            group: "Smoke",
            platform: "Web",
            device: "Fixture",
            viewport: { width: 64, height: 48 },
            file: "screenshots/home.png",
            capturedAt: "2026-08-01T00:00:00.000Z",
            sizeBytes: png.byteLength,
            tags: ["smoke"],
            notes: ["Packaged CLI fixture."],
          },
        ],
      },
      null,
      2,
    ),
  );
}

async function makePng(): Promise<Buffer> {
  const { default: sharp } = await import("sharp");

  return await sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 9, g: 9, b: 11 } },
  })
    .png()
    .toBuffer();
}

function runCli(cwd: string, args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
  });
}

function parseRecord(source: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(source);
  return requireRecord(parsed, label);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  assert.ok(Predicate.isObject(value), `${label} is invalid`);
  return value;
}

function failureMessage(check: string, result: SpawnSyncReturns<string>): string {
  return [
    `${check} smoke check failed`,
    `status: ${String(result.status)}`,
    `signal: ${String(result.signal)}`,
    `stdout: ${result.stdout.trim()}`,
    `stderr: ${result.stderr.trim()}`,
    result.error === undefined ? "" : `error: ${result.error.message}`,
  ]
    .filter(Boolean)
    .join("\n");
}
