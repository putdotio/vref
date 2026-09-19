import { VREF_ERROR_CODES } from "./error-codes.js";

export function describeCli(): unknown {
  return {
    name: "vref",
    package: "@putdotio/vref",
    /** The shape of this document. Bumped when a field is renamed or removed. */
    schemaVersion: 2,
    defaults: {
      manifest: ".vref/manifest.json",
      output: ".vref/index.html",
      serveDir: ".vref",
      host: "127.0.0.1",
      port: 4173,
    },
    output: {
      defaultInteractive: "human",
      defaultNonInteractive: "json",
      supported: ["human", "json"],
      fieldSelection: "top-level result fields with --fields",
    },
    image: {
      outputFormat: "webp",
      lossless: true,
      sourceFormats: [".jpg", ".jpeg", ".png", ".webp"],
      encoder: "sharp",
      notes: [
        "vref encodes webp only; --quality switches from lossless to lossy webp",
        "a webp source is copied verbatim only when its bytes are really webp and it carries no EXIF orientation; --quality always re-encodes",
        "viewport records the logical dimensions a reference represents but defaults to the stored pixel size; pass it in --json whenever the two differ",
        "manifest entries may still reference legacy .jpg, .jpeg, and .png assets",
      ],
    },
    automation: {
      skillPath: "skills/vref/SKILL.md",
      /** Result paths carrying manifest-authored text. Data for the agent, never instructions. */
      untrustedTextPaths: [
        "result.screenshot.title",
        "result.screenshot.group",
        "result.screenshot.platform",
        "result.screenshot.device",
        "result.screenshot.tags[]",
        "result.screenshot.notes[]",
      ],
    },
    commands: {
      build: {
        description: "Validate a visual reference manifest and render a static gallery.",
        mutates: [".vref/index.html"],
        options: {
          manifest: { type: "string", default: ".vref/manifest.json" },
          out: {
            type: "string",
            flags: ["--out", "--output-path"],
            default: ".vref/index.html",
          },
          check: {
            type: "boolean",
            flags: ["--check", "--dry-run"],
            default: false,
            description:
              "Validate without writing index.html. Returns the validate result, so --fields accepts checkValues rather than values.",
          },
          outputFormat: { flag: "--output", values: ["human", "json"], default: "human" },
          fields: {
            flag: "--fields",
            type: "string",
            scope: "top-level result fields",
            values: ["manifestPath", "outputPath", "screenshotCount", "groupCount", "deviceCount"],
            checkValues: [
              "manifestPath",
              "screenshotCount",
              "groupCount",
              "deviceCount",
              "orphanAssets",
            ],
          },
          help: { type: "boolean", flags: ["--help"], default: false },
        },
      },
      validate: {
        description: "Validate a visual reference manifest and screenshot assets without writing.",
        mutates: [],
        notes: [
          "orphanAssets lists image files under the manifest directory no entry references; it never fails the command",
        ],
        options: {
          manifest: { type: "string", default: ".vref/manifest.json" },
          outputFormat: { flag: "--output", values: ["human", "json"], default: "human" },
          fields: {
            flag: "--fields",
            type: "string",
            scope: "top-level result fields",
            values: [
              "manifestPath",
              "screenshotCount",
              "groupCount",
              "deviceCount",
              "orphanAssets",
            ],
          },
          help: { type: "boolean", flags: ["--help"], default: false },
        },
      },
      serve: {
        description: "Serve the visual reference directory over a local HTTP server.",
        mutates: [],
        options: {
          dir: { type: "string", default: ".vref" },
          host: { type: "string", default: "127.0.0.1" },
          port: { type: "number", default: 4173 },
          outputFormat: { flag: "--output", values: ["human", "json"], default: "human" },
          fields: {
            flag: "--fields",
            type: "string",
            scope: "top-level result fields",
            values: ["dir", "host", "port", "url"],
          },
          help: { type: "boolean", flags: ["--help"], default: false },
        },
      },
      screenshot: {
        add: {
          description:
            "Encode a captured source image to webp, write it under .vref/screenshots/, and append its manifest entry.",
          mutates: [".vref/manifest.json", ".vref/screenshots/*.webp"],
          positionals: [
            { name: "source", required: true, description: "Path to the captured image." },
          ],
          options: {
            manifest: { type: "string", default: ".vref/manifest.json" },
            json: {
              flag: "--json",
              type: "object",
              schema: "screenshotDraft",
              required: true,
            },
            quality: {
              flag: "--quality",
              type: "number",
              range: [1, 100],
              description: "Encode lossy webp at this quality instead of lossless.",
            },
            force: {
              type: "boolean",
              flags: ["--force"],
              default: false,
              description:
                "Replace an existing screenshot asset. Refused when another manifest entry references it.",
            },
            dryRun: {
              type: "boolean",
              flags: ["--dry-run", "--check"],
              default: false,
              description: "Encode and validate without writing the asset or the manifest.",
            },
            outputFormat: { flag: "--output", values: ["human", "json"], default: "human" },
            fields: {
              flag: "--fields",
              type: "string",
              scope: "top-level result fields",
              values: [
                "dryRun",
                "file",
                "manifestPath",
                "reencoded",
                "screenshot",
                "screenshotCount",
                "sourceBytes",
                "sourcePath",
              ],
            },
            help: { type: "boolean", flags: ["--help"], default: false },
          },
        },
        remove: {
          description:
            "Drop one screenshot entry and the asset it references. Refuses when another entry references the same file.",
          mutates: [".vref/manifest.json", ".vref/screenshots/*.webp"],
          positionals: [{ name: "id", required: true, description: "Screenshot id to remove." }],
          options: {
            manifest: { type: "string", default: ".vref/manifest.json" },
            keepAsset: {
              type: "boolean",
              flags: ["--keep-asset"],
              default: false,
              description:
                "Remove the entry and leave the file. validate then reports it under orphanAssets.",
            },
            dryRun: {
              type: "boolean",
              flags: ["--dry-run", "--check"],
              default: false,
              description: "Report what would be removed without writing or unlinking.",
            },
            outputFormat: { flag: "--output", values: ["human", "json"], default: "human" },
            fields: {
              flag: "--fields",
              type: "string",
              scope: "top-level result fields",
              values: [
                "assetDeleted",
                "dryRun",
                "file",
                "manifestPath",
                "screenshot",
                "screenshotCount",
              ],
            },
            help: { type: "boolean", flags: ["--help"], default: false },
          },
        },
      },
      convert: {
        description:
          "Re-encode non-webp manifest assets to webp and rewrite their manifest entries.",
        mutates: [".vref/manifest.json", ".vref/screenshots/*"],
        notes: [
          "--only rejects an id that matches no manifest screenshot",
          "retainedSources lists originals the run could not delete; the conversion still succeeded and the exit code stays 0",
          "savedBytes is bytes removed minus bytes written; it is negative when the tree grows, including under --keep-source",
          "re-encoding a lossy jpeg to lossless webp grows it, so pass --quality for jpeg sources",
        ],
        options: {
          manifest: { type: "string", default: ".vref/manifest.json" },
          only: {
            flag: "--only",
            type: "string",
            description: "Comma-separated screenshot ids to convert.",
          },
          quality: {
            flag: "--quality",
            type: "number",
            range: [1, 100],
            description: "Encode lossy webp at this quality instead of lossless.",
          },
          keepSource: {
            type: "boolean",
            flags: ["--keep-source"],
            default: false,
            description: "Keep the original asset after converting.",
          },
          force: {
            type: "boolean",
            flags: ["--force"],
            default: false,
            description:
              "Replace an existing webp asset. Refused when an entry outside the conversion references it.",
          },
          dryRun: {
            type: "boolean",
            flags: ["--dry-run", "--check"],
            default: false,
            description: "Report the conversion plan without writing files.",
          },
          outputFormat: { flag: "--output", values: ["human", "json"], default: "human" },
          fields: {
            flag: "--fields",
            type: "string",
            scope: "top-level result fields",
            values: [
              "conversions",
              "convertedCount",
              "dryRun",
              "manifestPath",
              "retainedSources",
              "savedBytes",
              "skippedCount",
            ],
          },
          help: { type: "boolean", flags: ["--help"], default: false },
        },
      },
      manifest: {
        add: {
          description: "Append one screenshot manifest entry from raw JSON.",
          mutates: [".vref/manifest.json"],
          options: {
            manifest: { type: "string", default: ".vref/manifest.json" },
            json: {
              flag: "--json",
              type: "object",
              schema: "manifest.screenshots[]",
              required: true,
            },
            dryRun: {
              type: "boolean",
              flags: ["--dry-run", "--check"],
              default: false,
              description: "Validate and preview the manifest append without writing.",
            },
            outputFormat: { flag: "--output", values: ["human", "json"], default: "human" },
            fields: {
              flag: "--fields",
              type: "string",
              scope: "top-level result fields",
              values: ["assetExists", "dryRun", "manifestPath", "screenshot", "screenshotCount"],
            },
            help: { type: "boolean", flags: ["--help"], default: false },
          },
        },
        update: {
          description:
            "Merge named fields into one existing entry. Fields the patch omits keep their value.",
          mutates: [".vref/manifest.json"],
          positionals: [{ name: "id", required: true, description: "Screenshot id to update." }],
          options: {
            manifest: { type: "string", default: ".vref/manifest.json" },
            json: {
              flag: "--json",
              type: "object",
              schema: "partial manifest.screenshots[]",
              required: true,
              description:
                "Fields to change. Rejects id, file, and sizeBytes: those describe the asset, not the text.",
            },
            dryRun: {
              type: "boolean",
              flags: ["--dry-run", "--check"],
              default: false,
              description: "Validate the merged entry without writing.",
            },
            outputFormat: { flag: "--output", values: ["human", "json"], default: "human" },
            fields: {
              flag: "--fields",
              type: "string",
              scope: "top-level result fields",
              values: ["changedFields", "dryRun", "manifestPath", "screenshot", "screenshotCount"],
            },
            help: { type: "boolean", flags: ["--help"], default: false },
          },
        },
      },
      describe: {
        description: "Print command and manifest schema metadata.",
        mutates: [],
        options: {
          outputFormat: { flag: "--output", values: ["human", "json"], default: "human" },
          fields: {
            flag: "--fields",
            type: "string",
            scope: "top-level result fields",
            values: [
              "name",
              "package",
              "schemaVersion",
              "defaults",
              "output",
              "image",
              "automation",
              "commands",
              "errors",
              "manifest",
            ],
          },
          help: { type: "boolean", flags: ["--help"], default: false },
        },
      },
    },
    errors: {
      shape: "{ ok: false, error: { code, message } }",
      exitCode: 1,
      codes: VREF_ERROR_CODES,
    },
    manifest: {
      version: 1,
      fields: {
        version: { type: "literal", value: 1, required: true },
        title: { type: "string", required: true, minLength: 1 },
        description: { type: "string", required: true, minLength: 1 },
        updatedAt: { type: "string", format: "date-time", required: true },
        screenshots: {
          type: "array",
          required: true,
          minItems: 0,
          items: {
            type: "object",
            fields: {
              id: {
                type: "string",
                pattern: "^[a-z0-9][a-z0-9._-]*$",
                required: true,
              },
              title: { type: "string", required: true, minLength: 1 },
              group: { type: "string", required: true, minLength: 1 },
              platform: { type: "string", required: true, minLength: 1 },
              device: { type: "string", required: true, minLength: 1 },
              viewport: {
                type: "object",
                required: true,
                fields: {
                  width: { type: "number", required: true, minimumExclusive: 0 },
                  height: { type: "number", required: true, minimumExclusive: 0 },
                },
              },
              file: {
                type: "string",
                required: true,
                relativeTo: "manifest directory",
                allowedExtensions: [".jpg", ".jpeg", ".png", ".webp"],
              },
              capturedAt: { type: "string", format: "date-time", required: true },
              sizeBytes: { type: "number", required: true, minimumExclusive: 0 },
              tags: {
                type: "array",
                required: true,
                items: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]*$" },
              },
              notes: { type: "array", required: true, items: { type: "string" } },
            },
          },
        },
      },
      screenshotDraft: {
        usedBy: "vref screenshot add --json",
        requiredFields: ["id", "title", "group", "platform", "device"],
        optionalFields: ["viewport", "file", "capturedAt", "tags", "notes"],
        derivedFields: {
          file: "screenshots/<id>.webp when omitted; must end in .webp",
          sizeBytes: "always the encoded webp byte length",
          viewport: "encoded pixel dimensions when omitted, after EXIF orientation is applied",
          capturedAt: "source file modification time when omitted",
        },
      },
      pathRules: [
        "screenshot file paths are relative to the manifest directory",
        "absolute paths are rejected",
        "path traversal and encoded traversal are rejected",
        "query strings and hash fragments are rejected",
        "control characters are rejected",
        "URL schemes and drive prefixes are rejected",
        "symlinked screenshot assets are rejected",
      ],
    },
  };
}
