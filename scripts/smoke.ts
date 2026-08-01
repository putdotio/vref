import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

  writeFixture(fixtureRoot);

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
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log(
  JSON.stringify({ ok: true, checks: ["describe", "invalid-config", "validate", "build"] }),
);

function writeFixture(root: string): void {
  const vrefDirectory = join(root, ".vref");
  const screenshotDirectory = join(vrefDirectory, "screenshots");
  mkdirSync(screenshotDirectory, { recursive: true });
  writeFileSync(join(screenshotDirectory, "home.png"), "image");
  writeFileSync(
    join(vrefDirectory, "manifest.json"),
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
            viewport: { width: 1280, height: 720 },
            file: "screenshots/home.png",
            capturedAt: "2026-08-01T00:00:00.000Z",
            sizeBytes: 5,
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
  assert.ok(isRecord(value), `${label} is invalid`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
