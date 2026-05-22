# Manifest Workflows

Inspect the live schema first:

```bash
vref describe --output json --fields manifest,commands,automation
```

Add one screenshot entry from raw JSON:

```bash
vref manifest add --json '{"id":"settings","title":"Settings","group":"Main pages","platform":"Roku","device":"Roku 720p","viewport":{"width":1280,"height":720},"file":"screenshots/roku-720p/settings.jpg","capturedAt":"2026-05-19T13:35:00.000Z","sizeBytes":39716,"tags":["settings"],"notes":["Settings page."]}' --dry-run --output json
```

Rules:

- Use `--dry-run` first; remove it only after the preview matches the intended screenshot id and file path.
- `manifest add` writes `.vref/manifest.json` only. It does not capture or copy screenshots.
- `assetExists` reports whether the referenced screenshot already exists.
- After updating screenshot files, run `vref validate --output json --fields screenshotCount,groupCount,deviceCount`.
- Top-level `--fields` values only; do not use dotted paths.
