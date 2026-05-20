export function describeCli(): unknown {
  return {
    name: "vref",
    package: "@putdotio/vref",
    version: 1,
    defaults: {
      manifest: ".vref/manifest.json",
      output: ".vref/index.html",
      serveDir: ".vref",
      host: "127.0.0.1",
      port: 4173,
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
            description: "Validate without writing index.html.",
          },
          outputFormat: { flag: "--output", values: ["human", "json"], default: "human" },
        },
      },
      validate: {
        description: "Validate a visual reference manifest and screenshot assets without writing.",
        mutates: [],
        options: {
          manifest: { type: "string", default: ".vref/manifest.json" },
          outputFormat: { flag: "--output", values: ["human", "json"], default: "human" },
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
        },
      },
      describe: {
        description: "Print command and manifest schema metadata.",
        mutates: [],
        options: {
          outputFormat: { flag: "--output", values: ["human", "json"], default: "human" },
        },
      },
    },
    manifest: {
      version: 1,
      path: ".vref/manifest.json",
      requiredFields: ["version", "title", "description", "updatedAt", "screenshots"],
      screenshotRequiredFields: [
        "id",
        "title",
        "group",
        "platform",
        "device",
        "viewport",
        "file",
        "capturedAt",
        "sizeBytes",
        "tags",
        "notes",
      ],
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
            requiredFields: [
              "id",
              "title",
              "group",
              "platform",
              "device",
              "viewport",
              "file",
              "capturedAt",
              "sizeBytes",
              "tags",
              "notes",
            ],
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
                requiredFields: ["width", "height"],
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
