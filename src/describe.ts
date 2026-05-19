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
      pathRules: [
        "screenshot file paths are relative to the manifest directory",
        "absolute paths are rejected",
        "path traversal and encoded traversal are rejected",
        "query strings and hash fragments are rejected",
      ],
    },
  };
}
