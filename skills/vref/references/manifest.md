# Manifest Workflows

Inspect the live schema first:

```bash
vref describe --output json --fields manifest,commands,automation
```

Add one screenshot entry from raw JSON:

```bash
vref manifest add --json '{"id":"settings","title":"Settings","group":"Main pages","platform":"Roku","device":"Roku 720p","viewport":{"width":1280,"height":720},"file":"screenshots/roku-720p/settings.jpg","capturedAt":"2026-05-19T13:35:00.000Z","sizeBytes":39716,"tags":["settings"],"notes":["Settings page."]}' --dry-run --output json
```

Add a screenshot and its image together. This is the path to prefer: it encodes
webp, writes the asset, and derives `file`, `sizeBytes`, `viewport`, and
`capturedAt` from the image itself:

```bash
vref screenshot add ./dist/tmp/settings.png --json '{"id":"settings","title":"Settings","group":"Main pages","platform":"Roku","device":"Roku 720p","tags":["settings"],"notes":["Settings page."]}' --dry-run --output json
```

Convert an existing png or jpeg reference set to webp:

```bash
vref convert --dry-run --output json
vref convert --only home,settings --output json
```

Rules:

- Use `--dry-run` first; remove it only after the preview matches the intended screenshot id and file path.
- Reach for `manifest add` only for metadata-only entries. It writes `.vref/manifest.json` and nothing else; it does not encode, capture, or copy screenshots.
- `screenshot add` writes webp only. Any `file` you pass must end in `.webp`.
- Do not hand-write `sizeBytes`, `viewport`, or `capturedAt` for `screenshot add`; it measures them. Pass `viewport` only for retina captures, whose pixel size is 2x the CSS viewport.
- `convert` rewrites the manifest before deleting any original, and skips entries that are already webp. Pass `--keep-source` to retain the originals.
- `assetExists` reports whether the referenced screenshot already exists.
- After updating screenshot files, run `vref validate --output json --fields screenshotCount,groupCount,deviceCount`.
- Top-level `--fields` values only; do not use dotted paths.
