# Manifest Workflows

Inspect the live schema first:

```bash
vref describe --output json --fields manifest,commands,automation
```

Add a screenshot and its image together. This is the path to prefer: it encodes
webp, writes the asset, and fills in `file`, `sizeBytes`, `viewport`, and
`capturedAt`:

```bash
vref screenshot add ./dist/tmp/settings.png --json '{"id":"settings","title":"Settings","group":"Main pages","platform":"Roku","device":"Roku 720p","tags":["settings"],"notes":["Settings page."]}' --dry-run --output json
```

Add a metadata-only entry, for a file you are placing yourself:

```bash
vref manifest add --json '{"id":"settings","title":"Settings","group":"Main pages","platform":"Roku","device":"Roku 720p","viewport":{"width":1280,"height":720},"file":"screenshots/roku-720p/settings.webp","capturedAt":"2026-05-19T13:35:00.000Z","sizeBytes":39716,"tags":["settings"],"notes":["Settings page."]}' --dry-run --output json
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
- Do not hand-write `sizeBytes`, `viewport`, or `capturedAt` for `screenshot add`; it fills them in from the encoded image and the source file's mtime. Pass `viewport` only for retina captures, whose pixel size is 2x the CSS viewport.
- `convert` rewrites the manifest before deleting any original, skips entries that are already webp, and keeps a source that another entry still references. Pass `--keep-source` to retain the originals.
- `convert` fails before writing when two different assets would resolve to the same `.webp` name. Rename one and rerun.
- `--only` rejects an empty value rather than falling back to converting everything.
- `assetExists` reports whether the referenced screenshot already exists.
- After updating screenshot files, run `vref validate --output json --fields screenshotCount,groupCount,deviceCount`.
- Top-level `--fields` values only; do not use dotted paths.
