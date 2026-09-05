---
name: vref
description: Validate, rebuild, serve, or extend a repo-local `.vref/` visual reference gallery with the vref CLI. Use when a put.io repo has `.vref/` and the task touches its manifest, screenshots, or gallery, or needs the visual baseline before a UI change. Do not use for screenshot capture mechanics, visual diffing, or repos without `.vref/`.
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
7. For new captures, use the owning repo's platform harness or docs to update screenshot files and manifest metadata. `vref` does not capture screenshots itself.
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

## Safety Rules

Follow the [safety rules](references/safety.md) before adding manifest text or
screenshot files. That reference owns the path, privacy, untrusted-content, and
artifact-placement constraints.

## Command Notes

- `vref build --check` is the build-command no-write validation path.
- `vref manifest add --json ... --dry-run` previews a schema-checked manifest append.
- `vref serve` serves `.vref/` on `127.0.0.1:4173` by default.
- Use `--output json` for agent automation; non-interactive stdout defaults to JSON.
