#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";
import { Effect } from "effect";
import { buildGallery } from "./build.js";
import { describeCli } from "./describe.js";
import { errorToJson, normalizeError, VrefError } from "./errors.js";
import { serve } from "./serve.js";

const DEFAULT_MANIFEST = ".vref/manifest.json";
const DEFAULT_OUTPUT = ".vref/index.html";
const DEFAULT_SERVE_DIR = ".vref";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4173;

type OutputFormat = "human" | "json";

type ParsedArgs = {
  command: string;
  output: OutputFormat;
  flags: Map<string, string | true>;
  positionals: string[];
};

export const runCli = Effect.fn("vref.cli")(function* (argv: string[], cwd: string) {
  const args = parseArgs(argv);

  switch (args.command) {
    case "build": {
      const result = yield* promiseBoundary(() =>
        buildGallery({
          cwd,
          manifestPath: getString(args, "manifest") ?? DEFAULT_MANIFEST,
          outputPath: getString(args, "out") ?? getString(args, "output-path") ?? DEFAULT_OUTPUT,
        }),
      );
      yield* Effect.sync(() => print(args.output, result, `wrote ${result.outputPath}`));
      return;
    }

    case "serve": {
      const port = yield* optionalPositiveInteger(args, "port");
      const result = yield* promiseBoundary(() =>
        serve({
          cwd,
          dir: getString(args, "dir") ?? DEFAULT_SERVE_DIR,
          host: getString(args, "host") ?? DEFAULT_HOST,
          port: port ?? DEFAULT_PORT,
        }),
      );
      yield* Effect.sync(() => {
        if (args.output === "json") {
          console.log(JSON.stringify({ ok: true, result }, null, 2));
        } else {
          console.log(`serving ${result.dir} at ${result.url}`);
          console.log("press Ctrl+C to stop");
        }
      });
      return;
    }

    case "describe": {
      const result = describeCli();
      yield* Effect.sync(() => print(args.output, result, "vref: build, serve, describe"));
      return;
    }

    case "help":
    case "--help":
    case "-h":
      yield* Effect.sync(printHelp);
      return;

    default:
      return yield* Effect.fail(
        new VrefError("VREF_UNKNOWN_COMMAND", `Unknown command "${args.command}"`),
      );
  }
});

function parseArgs(values: string[]): ParsedArgs {
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
  const output = outputValue === "json" ? "json" : "human";

  return { command, output, flags, positionals };
}

function getString(args: ParsedArgs, key: string): string | undefined {
  const value = args.flags.get(key);

  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return undefined;
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

function print(output: OutputFormat, result: unknown, human: string): void {
  if (output === "json") {
    console.log(JSON.stringify({ ok: true, result }, null, 2));
  } else {
    console.log(human);
  }
}

function printHelp(): void {
  console.log(`vref

Usage:
  vref build [--manifest .vref/manifest.json] [--out .vref/index.html] [--output json]
  vref serve [--dir .vref] [--host 127.0.0.1] [--port 4173] [--output json]
  vref describe --output json
`);
}

function promiseBoundary<A>(run: () => Promise<A>): Effect.Effect<A, VrefError> {
  return Effect.tryPromise({
    try: run,
    catch: normalizeError,
  });
}

export function main(argv: string[], cwd: string): void {
  void Effect.runPromise(runCli(argv, cwd)).catch((error: unknown) => {
    const wantsJson = wantsJsonOutput(argv);
    if (wantsJson) {
      console.error(JSON.stringify(errorToJson(error), null, 2));
    } else if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    process.exitCode = 1;
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.cwd());
}

function wantsJsonOutput(values: string[]): boolean {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--output=json") {
      return true;
    }

    if (value === "--output" && values[index + 1] === "json") {
      return true;
    }
  }

  return false;
}
