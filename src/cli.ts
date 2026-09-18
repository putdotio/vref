#!/usr/bin/env node
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { realpathSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { Cause, Effect } from "effect";
import { buildGallery, validateGallery } from "./build.js";
import { convertGallery } from "./convert.js";
import { describeCli } from "./describe.js";
import { normalizeError, VrefError } from "./errors.js";
import { addScreenshot, decodeScreenshotDraftJson, decodeScreenshotJson } from "./manifest-edit.js";
import { addScreenshotFromSource } from "./screenshot-add.js";
import { parseFields, renderJsonError, renderJsonResult, type OutputFormat } from "./output.js";
import { serve } from "./serve.js";
import type { VrefValidateResult } from "./types.js";

const DEFAULT_MANIFEST = ".vref/manifest.json";
const DEFAULT_OUTPUT = ".vref/index.html";
const DEFAULT_SERVE_DIR = ".vref";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4173;

export const COMMON_FLAGS = ["output", "fields", "help"] as const;

/**
 * The top-level result fields each command accepts in `--fields`.
 *
 * Exported so a test can hold `describe`'s advertised list to what the command
 * actually validates against; the two drifted silently before.
 */
export const COMMAND_FIELDS = {
  build: ["manifestPath", "outputPath", "screenshotCount", "groupCount", "deviceCount"],
  validate: ["manifestPath", "screenshotCount", "groupCount", "deviceCount", "orphanAssets"],
  serve: ["dir", "host", "port", "url"],
  describe: [
    "name",
    "package",
    "version",
    "defaults",
    "output",
    "image",
    "automation",
    "commands",
    "errors",
    "manifest",
  ],
  manifest: ["assetExists", "dryRun", "manifestPath", "screenshot", "screenshotCount"],
  screenshot: [
    "dryRun",
    "file",
    "manifestPath",
    "reencoded",
    "screenshot",
    "screenshotCount",
    "sourceBytes",
    "sourcePath",
  ],
  convert: [
    "conversions",
    "convertedCount",
    "dryRun",
    "manifestPath",
    "retainedSources",
    "savedBytes",
    "skippedCount",
  ],
} satisfies Record<string, readonly string[]>;

/**
 * The flags each command accepts, beside COMMON_FLAGS.
 *
 * Without this, an unrecognised name is parsed and then ignored, so a typo
 * degrades to the destructive branch: `--dryrun` runs a real conversion and
 * deletes the originals. Kept in step with printHelp and describe.ts.
 */
export const COMMAND_FLAGS: Record<string, readonly string[]> = {
  build: ["manifest", "out", "output-path", "check", "dry-run"],
  validate: ["manifest"],
  serve: ["dir", "host", "port"],
  describe: [],
  manifest: ["manifest", "json", "dry-run", "check"],
  screenshot: ["manifest", "json", "quality", "force", "dry-run", "check"],
  convert: ["manifest", "only", "quality", "keep-source", "force", "dry-run", "check"],
};

type ParsedArgs = {
  command: string;
  fields: readonly string[];
  output: OutputFormat;
  flags: Map<string, string | true>;
  positionals: string[];
};

type RunCliOptions = {
  isInteractiveTerminal?: boolean;
};

export const runCli = Effect.fn("vref.cli")(function* (
  argv: string[],
  cwd: string,
  options: RunCliOptions = {},
) {
  const args = yield* syncBoundary(() => parseArgs(argv, options.isInteractiveTerminal ?? true));
  yield* syncBoundary(() =>
    validateBooleanFlags(args, ["check", "dry-run", "force", "help", "keep-source"]),
  );

  if (getBoolean(args, "help")) {
    yield* Effect.sync(() => printHelp(args.command));
    return;
  }

  yield* syncBoundary(() => validateFlagNames(args));

  switch (args.command) {
    case "build": {
      if (getBoolean(args, "check") || getBoolean(args, "dry-run")) {
        yield* syncBoundary(() => validateFields(args, COMMAND_FIELDS.validate));
        const result = yield* promiseBoundary(() =>
          validateGallery({
            cwd,
            manifestPath: getRequiredString(args, "manifest", DEFAULT_MANIFEST),
          }),
        );
        yield* Effect.sync(() => print(args, result, validateSummary(result)));
        return;
      }

      yield* syncBoundary(() => validateFields(args, COMMAND_FIELDS.build));
      const result = yield* promiseBoundary(() =>
        buildGallery({
          cwd,
          manifestPath: getRequiredString(args, "manifest", DEFAULT_MANIFEST),
          outputPath: getRequiredStringFrom(args, ["out", "output-path"], DEFAULT_OUTPUT),
        }),
      );
      yield* Effect.sync(() => print(args, result, `wrote ${result.outputPath}`));
      return;
    }

    case "validate": {
      yield* syncBoundary(() => validateFields(args, COMMAND_FIELDS.validate));
      const result = yield* promiseBoundary(() =>
        validateGallery({
          cwd,
          manifestPath: getRequiredString(args, "manifest", DEFAULT_MANIFEST),
        }),
      );
      yield* Effect.sync(() => print(args, result, validateSummary(result)));
      return;
    }

    case "serve": {
      yield* syncBoundary(() => validateFields(args, COMMAND_FIELDS.serve));
      const port = yield* optionalPositiveInteger(args, "port");
      return yield* Effect.scoped(
        Effect.gen(function* () {
          const result = yield* serve({
            cwd,
            dir: getRequiredString(args, "dir", DEFAULT_SERVE_DIR),
            host: getRequiredString(args, "host", DEFAULT_HOST),
            port: port ?? DEFAULT_PORT,
          });
          yield* Effect.sync(() => {
            if (args.output === "json") {
              console.log(renderJsonResult(result, args.fields));
            } else {
              console.log(`serving ${result.dir} at ${result.url}`);
              console.log("press Ctrl+C to stop");
            }
          });
          return yield* Effect.never;
        }),
      );
    }

    case "describe": {
      yield* syncBoundary(() => validateFields(args, COMMAND_FIELDS.describe));
      const result = describeCli();
      yield* Effect.sync(() => print(args, result, "vref: build, validate, serve, describe"));
      return;
    }

    case "manifest": {
      const subcommand = args.positionals[0];
      if (subcommand !== "add") {
        return yield* Effect.fail(
          new VrefError(
            "VREF_UNKNOWN_COMMAND",
            "Unknown manifest command. Use `vref manifest add`.",
          ),
        );
      }

      const rawJson = getString(args, "json");
      if (rawJson === undefined) {
        return yield* Effect.fail(
          new VrefError("VREF_JSON_REQUIRED", "`vref manifest add` requires --json"),
        );
      }

      yield* syncBoundary(() => validateFields(args, COMMAND_FIELDS.manifest));
      const screenshot = yield* syncBoundary(() => decodeScreenshotJson(rawJson));
      const result = yield* promiseBoundary(() =>
        addScreenshot({
          cwd,
          dryRun: getBoolean(args, "dry-run") || getBoolean(args, "check"),
          manifestPath: getRequiredString(args, "manifest", DEFAULT_MANIFEST),
          screenshot,
        }),
      );
      const message = result.dryRun
        ? `validated manifest add for ${result.screenshot.id}`
        : `added manifest screenshot ${result.screenshot.id}`;
      yield* Effect.sync(() => print(args, result, message));
      return;
    }

    case "screenshot": {
      const subcommand = args.positionals[0];
      if (subcommand !== "add") {
        return yield* Effect.fail(
          new VrefError(
            "VREF_UNKNOWN_COMMAND",
            "Unknown screenshot command. Use `vref screenshot add`.",
          ),
        );
      }

      const sourcePath = args.positionals[1];
      if (sourcePath === undefined) {
        return yield* Effect.fail(
          new VrefError(
            "VREF_SOURCE_REQUIRED",
            "`vref screenshot add` requires a source image path",
          ),
        );
      }

      const rawJson = getString(args, "json");
      if (rawJson === undefined) {
        return yield* Effect.fail(
          new VrefError("VREF_JSON_REQUIRED", "`vref screenshot add` requires --json"),
        );
      }

      yield* syncBoundary(() => validateFields(args, COMMAND_FIELDS.screenshot));
      const quality = yield* optionalPositiveInteger(args, "quality");
      const draft = yield* syncBoundary(() => decodeScreenshotDraftJson(rawJson));
      const result = yield* promiseBoundary(() =>
        addScreenshotFromSource({
          cwd,
          draft,
          dryRun: getBoolean(args, "dry-run") || getBoolean(args, "check"),
          force: getBoolean(args, "force"),
          manifestPath: getRequiredString(args, "manifest", DEFAULT_MANIFEST),
          quality,
          sourcePath,
        }),
      );
      const message = result.dryRun
        ? `validated screenshot add for ${result.screenshot.id}`
        : `wrote ${result.file} (${result.screenshot.sizeBytes} B from ${result.sourceBytes} B)`;
      yield* Effect.sync(() => print(args, result, message));
      return;
    }

    case "convert": {
      yield* syncBoundary(() => validateFields(args, COMMAND_FIELDS.convert));
      const quality = yield* optionalPositiveInteger(args, "quality");
      const dryRun = getBoolean(args, "dry-run") || getBoolean(args, "check");
      const only = yield* syncBoundary(() => parseList(args, "only"));
      const result = yield* promiseBoundary(() =>
        convertGallery({
          cwd,
          dryRun,
          force: getBoolean(args, "force"),
          keepSource: getBoolean(args, "keep-source"),
          manifestPath: getRequiredString(args, "manifest", DEFAULT_MANIFEST),
          only,
          quality,
        }),
      );
      const verb = result.dryRun ? "would convert" : "converted";
      const delta =
        result.savedBytes < 0
          ? `${Math.abs(result.savedBytes)} B larger`
          : `${result.savedBytes} B saved`;
      // A retained original is the one thing the exit code no longer says, so
      // the human output has to.
      const retained =
        result.retainedSources.length > 0
          ? `; could not remove ${result.retainedSources.join(", ")}`
          : "";
      yield* Effect.sync(() =>
        print(
          args,
          result,
          `${verb} ${result.convertedCount} references to webp (${delta})${retained}`,
        ),
      );
      return;
    }

    case "help":
    case "--help":
    case "-h":
      yield* Effect.sync(() => printHelp());
      return;

    default:
      return yield* Effect.fail(
        new VrefError("VREF_UNKNOWN_COMMAND", `Unknown command "${args.command}"`),
      );
  }
});

function parseArgs(values: string[], isInteractiveTerminal: boolean): ParsedArgs {
  const [commandValue, ...rest] = values;
  const command = commandValue ?? "help";
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === undefined) {
      continue;
    }

    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }

    const withoutPrefix = value.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");
    if (equalsIndex >= 0) {
      flags.set(withoutPrefix.slice(0, equalsIndex), withoutPrefix.slice(equalsIndex + 1));
      continue;
    }

    const nextValue = rest[index + 1];
    if (nextValue !== undefined && !nextValue.startsWith("--")) {
      flags.set(withoutPrefix, nextValue);
      index += 1;
    } else {
      flags.set(withoutPrefix, true);
    }
  }

  const outputValue = flags.get("output");
  const output =
    outputValue === "json" || (!isInteractiveTerminal && outputValue !== "human")
      ? "json"
      : "human";
  const fields = parseFields(getStringFromFlags(flags, "fields"));

  return { command, fields, output, flags, positionals };
}

function getString(args: ParsedArgs, key: string): string | undefined {
  const value = args.flags.get(key);

  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return undefined;
}

/**
 * A flag that is present must carry a value.
 *
 * `--manifest` with nothing after it, or `--manifest=` from an automation
 * variable that expanded to nothing, would otherwise fall through to the
 * default path — pointing a destructive command at the default gallery
 * instead of rejecting a malformed command.
 */
function getRequiredString(args: ParsedArgs, key: string, fallback: string): string {
  const value = args.flags.get(key);

  if (value === undefined) {
    return fallback;
  }

  const resolved = getString(args, key);
  if (resolved === undefined) {
    throw new VrefError("VREF_EMPTY_FLAG", `--${key} was passed without a value`);
  }

  return resolved;
}

/**
 * The same contract as getRequiredString for a flag with more than one name.
 */
function getRequiredStringFrom(
  args: ParsedArgs,
  keys: readonly string[],
  fallback: string,
): string {
  // Every supplied alias is validated before one is chosen: returning on the
  // first present key would let `--out x --output-path=` through, which is the
  // malformed-override case this guard exists to catch.
  const supplied = keys.filter((key) => args.flags.get(key) !== undefined);
  for (const key of supplied) {
    getRequiredString(args, key, fallback);
  }

  const [first] = supplied;

  return first === undefined ? fallback : getRequiredString(args, first, fallback);
}

function getStringFromFlags(flags: Map<string, string | true>, key: string): string | undefined {
  const value = flags.get(key);

  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return undefined;
}

/**
 * An absent selector means "everything"; a present but empty one is a mistake.
 *
 * `--only` with no value, or `--only=,,,`, would otherwise fall through to the
 * unscoped run and convert every asset — deleting originals the caller was
 * trying to exclude.
 */
function parseList(args: ParsedArgs, key: string): string[] | undefined {
  const raw = args.flags.get(key);
  if (raw === undefined) {
    return undefined;
  }

  const entries =
    raw === true
      ? []
      : raw
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);

  if (entries.length === 0) {
    throw new VrefError("VREF_EMPTY_SELECTOR", `--${key} was passed without any value`);
  }

  return entries;
}

function getBoolean(args: ParsedArgs, key: string): boolean {
  const value = args.flags.get(key);
  return value === true || value === "true";
}

function validateBooleanFlags(args: ParsedArgs, keys: readonly string[]): void {
  for (const key of keys) {
    validateBooleanFlag(args, key);
  }
}

function validateBooleanFlag(args: ParsedArgs, key: string): void {
  const value = args.flags.get(key);
  if (value === true || value === "true") {
    return;
  }

  if (value === undefined || value === "false") {
    return;
  }

  throw new VrefError(
    "VREF_INVALID_BOOLEAN",
    `--${key} must be passed without a value or with true/false`,
  );
}

function validateFlagNames(args: ParsedArgs): void {
  const allowed = COMMAND_FLAGS[args.command];
  if (allowed === undefined) {
    return;
  }

  const unknownFlags = [...args.flags.keys()].filter(
    (flag) =>
      !allowed.includes(flag) && !COMMON_FLAGS.includes(flag as (typeof COMMON_FLAGS)[number]),
  );
  if (unknownFlags.length > 0) {
    throw new VrefError(
      "VREF_UNKNOWN_FLAG",
      `Unknown flag for \`vref ${args.command}\`: ${unknownFlags.map((flag) => `--${flag}`).join(", ")}`,
    );
  }
}

function validateFields(args: ParsedArgs, allowedFields: readonly string[]): void {
  const unknownFields = args.fields.filter((field) => !allowedFields.includes(field));
  if (unknownFields.length > 0) {
    throw new VrefError(
      "VREF_UNKNOWN_FIELD",
      `Unknown --fields value: ${unknownFields.join(", ")}`,
    );
  }
}

function optionalPositiveInteger(
  args: ParsedArgs,
  key: string,
): Effect.Effect<number | undefined, VrefError> {
  const raw = args.flags.get(key);
  const value = getString(args, key);

  // A present flag must carry a value. `--quality` alone would otherwise fall
  // through to a lossless encode, silently ignoring a request for lossy output.
  if (raw !== undefined && value === undefined) {
    return Effect.fail(new VrefError("VREF_EMPTY_FLAG", `--${key} was passed without a value`));
  }

  if (value === undefined) {
    return Effect.succeed(undefined);
  }

  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) {
    return Effect.succeed(parsed);
  }

  return Effect.fail(new VrefError("VREF_INVALID_NUMBER", `--${key} must be a positive integer`));
}

/**
 * Orphans are not a failure, so the human line is the only place they surface
 * outside `--output json`.
 *
 * Each path is quoted because it comes from a directory listing, and a filename
 * may legally carry a newline or an escape sequence. Printed raw, a checked-out
 * `.webp` could forge a second line of output or drive the terminal.
 */
function validateSummary(result: VrefValidateResult): string {
  const summary = `validated ${result.screenshotCount} references`;
  if (result.orphanAssets.length === 0) {
    return summary;
  }

  const paths = result.orphanAssets.map((file) => JSON.stringify(file)).join(", ");

  return `${summary}; ${result.orphanAssets.length} unreferenced: ${paths}`;
}

function print(args: ParsedArgs, result: unknown, human: string): void {
  if (args.output === "json") {
    console.log(renderJsonResult(result, args.fields));
  } else {
    console.log(human);
  }
}

function printHelp(command?: string): void {
  if (command === "build") {
    console.log(`vref build

Usage:
  vref build [--manifest .vref/manifest.json] [--out .vref/index.html] [--check] [--dry-run] [--output json] [--fields field[,field...]]
`);
    return;
  }

  if (command === "validate") {
    console.log(`vref validate

Usage:
  vref validate [--manifest .vref/manifest.json] [--output json] [--fields field[,field...]]
`);
    return;
  }

  if (command === "serve") {
    console.log(`vref serve

Usage:
  vref serve [--dir .vref] [--host 127.0.0.1] [--port 4173] [--output json] [--fields field[,field...]]
`);
    return;
  }

  if (command === "describe") {
    console.log(`vref describe

Usage:
  vref describe --output json [--fields field[,field...]]
`);
    return;
  }

  if (command === "manifest") {
    console.log(`vref manifest add

Usage:
  vref manifest add --json '{"id":"home",...}' [--manifest .vref/manifest.json] [--dry-run] [--output json] [--fields field[,field...]]
`);
    return;
  }

  if (command === "screenshot") {
    console.log(`vref screenshot add

Encodes a captured .png, .jpg, or .webp source to lossless webp, writes it under
.vref/screenshots/, and appends the manifest entry. Pass --quality for lossy webp.
Pass "viewport" in --json when the logical size differs from the stored pixels; it defaults to the encoded pixel size.

Usage:
  vref screenshot add <source> --json '{"id":"home","title":"Home","group":"Main pages","platform":"Web","device":"Chrome 1440"}' [--manifest .vref/manifest.json] [--quality 1-100] [--force] [--dry-run] [--output json] [--fields field[,field...]]
`);
    return;
  }

  if (command === "convert") {
    console.log(`vref convert

Re-encodes every non-webp manifest asset to webp, rewrites its manifest file path
and sizeBytes, and removes the original unless --keep-source.

Usage:
  vref convert [--manifest .vref/manifest.json] [--only id[,id...]] [--quality 1-100] [--keep-source] [--force] [--dry-run] [--output json] [--fields field[,field...]]
`);
    return;
  }

  console.log(`vref

Usage:
  vref build [--manifest .vref/manifest.json] [--out .vref/index.html] [--check] [--dry-run] [--output json]
  vref validate [--manifest .vref/manifest.json] [--output json]
  vref serve [--dir .vref] [--host 127.0.0.1] [--port 4173] [--output json]
  vref screenshot add <source> --json '{"id":"home",...}' [--quality 1-100] [--force] [--dry-run] [--output json]
  vref convert [--only id[,id...]] [--keep-source] [--dry-run] [--output json]
  vref manifest add --json '{"id":"home",...}' [--manifest .vref/manifest.json] [--dry-run] [--output json]
  vref describe --output json
`);
}

function promiseBoundary<A>(run: () => Promise<A>): Effect.Effect<A, VrefError> {
  return Effect.tryPromise({
    try: run,
    catch: normalizeError,
  });
}

function syncBoundary<A>(run: () => A): Effect.Effect<A, VrefError> {
  return Effect.try({
    try: run,
    catch: normalizeError,
  });
}

/**
 * Whether this module is the process entry point.
 *
 * Node canonicalises `import.meta.url` through symlinks but leaves
 * `process.argv[1]` exactly as the caller wrote it, so comparing them directly
 * fails whenever the CLI is reached through a symlink — which is the norm under
 * pnpm, where `node_modules/<pkg>` links into `node_modules/.pnpm/…`. Depending
 * on which path the generated bin shim used, the CLI would exit 0 having done
 * no work at all, so a `vref build --check` step could pass while validating
 * nothing. Canonicalise both sides.
 */
export function isDirectInvocation(moduleUrl: string, entryPath: string | undefined): boolean {
  if (entryPath === undefined) {
    return false;
  }

  // Raw comparison first: under `node --preserve-symlinks-main` Node
  // deliberately keeps `import.meta.url` on the symlink, so canonicalising only
  // the entry path would make the two disagree and silently skip `main`.
  if (moduleUrl === pathToFileURL(entryPath).href) {
    return true;
  }

  try {
    return moduleUrl === pathToFileURL(realpathSync(entryPath)).href;
  } catch {
    // Any resolution failure — missing, unreadable, a symlink loop — leaves the
    // entry path unproven, and an unproven entry path is not this module. Fail
    // closed rather than throwing during startup.
    return false;
  }
}

export function main(argv: string[], cwd: string): void {
  const isInteractiveTerminal = process.stdout.isTTY === true;
  const program = recoverCliProgram(
    runCli(argv, cwd, { isInteractiveTerminal }),
    argv,
    isInteractiveTerminal,
  );

  NodeRuntime.runMain(program);
}

export function recoverCliProgram<A, E, R>(
  program: Effect.Effect<A, E, R>,
  argv: string[],
  isInteractiveTerminal: boolean,
): Effect.Effect<A | void, E, R> {
  return program.pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.failCause(cause);
      }

      return Effect.sync(() => {
        const error = Cause.squash(cause);
        if (wantsJsonOutput(argv, isInteractiveTerminal)) {
          console.error(renderJsonError(error));
        } else if (error instanceof Error) {
          console.error(error.message);
        } else {
          console.error(String(error));
        }
        process.exitCode = 1;
      });
    }),
  );
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  main(process.argv.slice(2), process.cwd());
}

function wantsJsonOutput(values: string[], isInteractiveTerminal: boolean): boolean {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--output=json") {
      return true;
    }

    if (value === "--output=human") {
      return false;
    }

    if (value === "--output" && values[index + 1] === "json") {
      return true;
    }

    if (value === "--output" && values[index + 1] === "human") {
      return false;
    }
  }

  return !isInteractiveTerminal;
}
