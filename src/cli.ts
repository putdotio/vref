#!/usr/bin/env node
import { NodeRuntime } from "@effect/platform-node";
import { realpathSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { Effect } from "effect";
import { buildGallery, validateGallery } from "./build.js";
import { describeCli } from "./describe.js";
import { normalizeError, VrefError } from "./errors.js";
import { addScreenshot, decodeScreenshotJson } from "./manifest-edit.js";
import { parseFields, renderJsonError, renderJsonResult, type OutputFormat } from "./output.js";
import { serve } from "./serve.js";

const DEFAULT_MANIFEST = ".vref/manifest.json";
const DEFAULT_OUTPUT = ".vref/index.html";
const DEFAULT_SERVE_DIR = ".vref";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4173;

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
  yield* syncBoundary(() => validateBooleanFlags(args, ["check", "dry-run", "help"]));

  if (getBoolean(args, "help")) {
    yield* Effect.sync(() => printHelp(args.command));
    return;
  }

  switch (args.command) {
    case "build": {
      if (getBoolean(args, "check") || getBoolean(args, "dry-run")) {
        yield* syncBoundary(() =>
          validateFields(args, ["manifestPath", "screenshotCount", "groupCount", "deviceCount"]),
        );
        const result = yield* promiseBoundary(() =>
          validateGallery({
            cwd,
            manifestPath: getString(args, "manifest") ?? DEFAULT_MANIFEST,
          }),
        );
        yield* Effect.sync(() =>
          print(args, result, `validated ${result.screenshotCount} references`),
        );
        return;
      }

      yield* syncBoundary(() =>
        validateFields(args, [
          "manifestPath",
          "outputPath",
          "screenshotCount",
          "groupCount",
          "deviceCount",
        ]),
      );
      const result = yield* promiseBoundary(() =>
        buildGallery({
          cwd,
          manifestPath: getString(args, "manifest") ?? DEFAULT_MANIFEST,
          outputPath: getString(args, "out") ?? getString(args, "output-path") ?? DEFAULT_OUTPUT,
        }),
      );
      yield* Effect.sync(() => print(args, result, `wrote ${result.outputPath}`));
      return;
    }

    case "validate": {
      yield* syncBoundary(() =>
        validateFields(args, ["manifestPath", "screenshotCount", "groupCount", "deviceCount"]),
      );
      const result = yield* promiseBoundary(() =>
        validateGallery({
          cwd,
          manifestPath: getString(args, "manifest") ?? DEFAULT_MANIFEST,
        }),
      );
      yield* Effect.sync(() =>
        print(args, result, `validated ${result.screenshotCount} references`),
      );
      return;
    }

    case "serve": {
      yield* syncBoundary(() => validateFields(args, ["dir", "host", "port", "url"]));
      const port = yield* optionalPositiveInteger(args, "port");
      return yield* Effect.scoped(
        Effect.gen(function* () {
          const result = yield* serve({
            cwd,
            dir: getString(args, "dir") ?? DEFAULT_SERVE_DIR,
            host: getString(args, "host") ?? DEFAULT_HOST,
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
      yield* syncBoundary(() =>
        validateFields(args, [
          "name",
          "package",
          "version",
          "defaults",
          "output",
          "automation",
          "commands",
          "manifest",
        ]),
      );
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

      yield* syncBoundary(() =>
        validateFields(args, [
          "assetExists",
          "dryRun",
          "manifestPath",
          "screenshot",
          "screenshotCount",
        ]),
      );
      const screenshot = yield* syncBoundary(() => decodeScreenshotJson(rawJson));
      const result = yield* promiseBoundary(() =>
        addScreenshot({
          cwd,
          dryRun: getBoolean(args, "dry-run") || getBoolean(args, "check"),
          manifestPath: getString(args, "manifest") ?? DEFAULT_MANIFEST,
          screenshot,
        }),
      );
      const message = result.dryRun
        ? `validated manifest add for ${result.screenshot.id}`
        : `added manifest screenshot ${result.screenshot.id}`;
      yield* Effect.sync(() => print(args, result, message));
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

function getStringFromFlags(flags: Map<string, string | true>, key: string): string | undefined {
  const value = flags.get(key);

  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return undefined;
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
  const value = getString(args, key);
  if (value === undefined) {
    return Effect.succeed(undefined);
  }

  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) {
    return Effect.succeed(parsed);
  }

  return Effect.fail(new VrefError("VREF_INVALID_NUMBER", `--${key} must be a positive integer`));
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

  console.log(`vref

Usage:
  vref build [--manifest .vref/manifest.json] [--out .vref/index.html] [--check] [--dry-run] [--output json]
  vref validate [--manifest .vref/manifest.json] [--output json]
  vref serve [--dir .vref] [--host 127.0.0.1] [--port 4173] [--output json]
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
  const program = runCli(argv, cwd, { isInteractiveTerminal }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        if (wantsJsonOutput(argv, isInteractiveTerminal)) {
          console.error(renderJsonError(error));
        } else {
          console.error(error.message);
        }
        process.exitCode = 1;
      }),
    ),
  );

  NodeRuntime.runMain(program);
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
