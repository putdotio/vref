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
- Do not hand-write `sizeBytes`, `viewport`, or `capturedAt` for `screenshot add`; it fills them in from the encoded image and the source file's mtime. `viewport` records the logical dimensions a reference represents while the default measures stored pixels, so pass it whenever the two differ — a retina capture stores 2x.
- `convert` rewrites the manifest before deleting any original, skips entries that are already webp, and keeps a source that another entry still references. Pass `--keep-source` to retain the originals.
- `convert` fails before writing when two different assets would resolve to the same `.webp` name. Rename one and rerun.
- `--only` rejects an empty value rather than falling back to converting everything, and rejects an id matching no entry with `VREF_UNKNOWN_SELECTOR`.
- `retainedSources` lists originals `convert` could not delete. The conversion succeeded; only the cleanup did not.
- Do not hand-write `updatedAt`. Every non-dry-run manifest write stamps it.
- `assetExists` reports whether the referenced screenshot already exists.
- After updating screenshot files, run `vref validate --output json --fields screenshotCount,groupCount,deviceCount`.
- After removing an entry, check `orphanAssets` from `vref validate --output json`: it lists image files under `.vref/` nothing references, and deleting the leftover is a manual step.
- Top-level `--fields` values only; do not use dotted paths. `vref describe` lists the accepted values per command.
- An unrecognised flag name is rejected with `VREF_UNKNOWN_FLAG`, and a path flag passed without a value with `VREF_EMPTY_FLAG`. Neither falls through to a default, so a typo cannot quietly run the destructive branch.
- Every failure is `{ "ok": false, "error": { "code", "message" } }` with exit 1. Match on `code`; `vref describe --fields errors` lists every code the CLI can return.
