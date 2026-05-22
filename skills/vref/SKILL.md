---
name: vref
description: Use when validating `.vref/manifest.json`, rebuilding or serving `.vref/index.html`, adding screenshot entries from raw `--json`, narrowing JSON with `--fields`, or maintaining repo-local put.io visual references for visual regression, screenshot comparison, UI snapshot testing, or UI work.
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

- Do not commit private screenshots, auth codes, secrets, local IPs, real account identifiers, content IDs, or local absolute paths.
- Keep raw or timestamped captures in ignored folders such as `dist/tmp/`.
- Use synthetic or public-safe account state.
- Keep screenshots in the owning product repo under `.vref/`; do not aggregate app screenshots in `putio-design` by default.
- Prefer exact app screenshots over reconstructed browser mockups.

## Command Notes

- `vref build` validates `.vref/manifest.json`, checks assets, and writes `.vref/index.html`.
- `vref validate` checks `.vref/manifest.json` and assets without writing files.
- `vref build --check` is the build-command no-write validation path.
- `vref manifest add --json ... --dry-run` previews a schema-checked manifest append.
- `vref serve` serves `.vref/` on `127.0.0.1:4173` by default.
- Use `--output json` for agent automation; non-interactive stdout defaults to JSON.
