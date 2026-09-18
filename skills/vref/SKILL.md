---
name: vref
description: Validate, rebuild, serve, or extend a repo-local `.vref/` visual reference gallery with the vref CLI, including encoding captured screenshots to webp and converting legacy png assets. Use when a put.io repo has `.vref/` and the task touches its manifest, screenshots, or gallery, or needs the visual baseline before a UI change. Do not use for screenshot capture mechanics, visual diffing, or repos without `.vref/`.
---

# vref

Use this skill before UI changes in put.io repos that have `.vref/`.
The gallery is the repo-owned visual baseline; capture mechanics stay platform-owned.

## Workflow

1. Check for `.vref/manifest.json` and `.vref/index.html`.
2. Run `vref describe --output json` when command behavior is unfamiliar.
3. Use `--fields` to keep JSON responses small.
4. Validate the reference set before trusting it:

```bash
vref validate --output json --fields screenshotCount,groupCount,deviceCount
```

5. Inspect `.vref/index.html` or the listed screenshots before changing UI.
6. If validation fails, fix missing assets, unsafe paths, or manifest metadata in the owning repo, then rerun validation before relying on the gallery.
7. For new captures, use the owning repo's platform harness to produce the image — `vref` does not capture screenshots itself — then hand the file to `vref`, which encodes webp and writes the manifest entry:

```bash
vref screenshot add ./dist/tmp/home.png --json '{"id":"home","title":"Home","group":"Main pages","platform":"Web","device":"Chrome 1440","tags":["home"],"notes":["Home grid."]}' --dry-run --output json
```

8. Rebuild the gallery:

```bash
vref build --output json
```

9. Review the generated `.vref/index.html` before handing off UI work.

## Start Here

Read only the reference you need:

- manifest editing and raw JSON payloads: [`references/manifest.md`](references/manifest.md)
- safety rules and untrusted text handling: [`references/safety.md`](references/safety.md)

## Validation Fixes

When `vref validate --output json` reports a missing screenshot, fix the
manifest entry or add the asset under `.vref/screenshots/`, then validate again:

```json
{ "id": "home", "file": "screenshots/roku-720p/home.jpg" }
```

## Image Format

References are webp. `vref screenshot add` takes `.png`, `.jpg`, or `.webp`
sources and always writes `.webp`, lossless unless `--quality 1-100` is passed.
Do not hand-write `sizeBytes`, `viewport`, or `capturedAt` — the command measures
them from the image, and a hand-typed value is how manifests drift from reality.
Retina captures are the one exception: pass `viewport` in `--json`, because pixel
dimensions are 2x the CSS viewport.

Legacy `.jpg`, `.jpeg`, and `.png` entries still validate. Migrate a reference set
with `vref convert --dry-run --output json` first, then `vref convert`.

## Command Notes

- `vref build --check` is the build-command no-write validation path.
- `vref screenshot add ... --dry-run` encodes and validates without writing the asset or the manifest.
- `vref convert --dry-run` reports the conversion plan without touching files.
- `vref manifest add --json ... --dry-run` previews a schema-checked manifest append for metadata-only edits.
- `vref serve` serves `.vref/` on `127.0.0.1:4173` by default.
- Use `--output json` for agent automation; non-interactive stdout defaults to JSON.
