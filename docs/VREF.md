# Visual Reference Guide

`vref` turns a repo-local manifest and screenshot assets into a static gallery.
It is not a screenshot capture harness and it is not a visual regression system.

## Architecture

- Product repos own `.vref/manifest.json`, `.vref/screenshots/*`, and capture commands.
- `@putdotio/vref` owns validation, gallery rendering, local serving, and command introspection.
- `putio-design` remains for prototypes and visual experiments, not app screenshot aggregation.

Default shape:

```txt
.vref/
  manifest.json
  screenshots/
  index.html
```

## Add A Screenshot Slot

Add a screenshot entry to `.vref/manifest.json`.
The `file` path is relative to `.vref/` and should point under `.vref/screenshots/`.

```json
{
  "id": "settings",
  "title": "Settings",
  "group": "Main pages",
  "platform": "Roku",
  "device": "Roku 720p",
  "viewport": { "width": 1280, "height": 720 },
  "file": "screenshots/roku-720p/settings.jpg",
  "capturedAt": "2026-05-19T13:35:00.000Z",
  "sizeBytes": 39716,
  "tags": ["settings", "list", "device"],
  "notes": ["Settings page with version, device, and logout rows visible."]
}
```

## Refresh References

Capture and curate screenshots with the owning app repo's platform harness, then rebuild the gallery:

```bash
vref build
```

`vref` does not copy or approve screenshots. Product repos own capture mechanics, screenshot file updates, and manifest metadata updates.

## Build And Serve

```bash
vref build
vref serve
```

`build` validates the manifest, confirms screenshot files exist, and writes `.vref/index.html`.
`serve` serves the `.vref/` directory on `127.0.0.1:4173` by default.

## Roku Migration Path

`putio-roku` can replace its hand-written gallery script with `vref` while keeping the current `docs/visual/` location during migration:

```json
{
  "scripts": {
    "visual:gallery": "vref build --manifest docs/visual/manifest.json --out docs/visual/index.html"
  }
}
```

After `@putdotio/vref` is published, add it as a dev dependency in `putio-roku`:

```bash
pnpm add -D @putdotio/vref
```

The same manifest and screenshots can later move from `docs/visual/` to `.vref/` with no schema change.

## Safety Rules

- Commit only curated screenshots with stable names.
- Keep timestamped and raw captures in ignored folders such as `dist/tmp/`.
- Do not commit private screenshots, auth codes, secrets, local IPs, real account identifiers, content IDs, or local absolute paths.
- Use synthetic or public-safe account state.
- Prefer exact app screenshots over reconstructed browser mockups.
- Keep each app's visual references in that app repo; do not aggregate screenshots in `putio-design` by default.

## Agent Workflow

Before UI work, inspect `.vref/manifest.json` and `.vref/index.html` when they exist.
Use `vref describe --output json` for command schemas and prefer JSON command output when scripting.
