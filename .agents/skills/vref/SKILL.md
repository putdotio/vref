---
name: vref
description: Inspect and maintain repo-local put.io visual references before UI work. Use when a repo has `.vref/`, when updating screenshots, or when validating screenshot-backed UI evidence with the `vref` CLI.
---

# vref

Use this skill before UI changes in put.io repos that have `.vref/`.
The gallery is the repo-owned visual baseline; capture mechanics stay platform-owned.

## Workflow

1. Check for `.vref/manifest.json` and `.vref/index.html`.
2. Run `vref describe --output json` when command behavior is unfamiliar.
3. Inspect `.vref/index.html` or the listed screenshots before changing UI.
4. After capture, ask the product repo's platform-owned harness to update the screenshot files and manifest metadata.
5. Rebuild the gallery:

```bash
vref build --output json
```

6. Review the generated `.vref/index.html` before handing off UI work.

## Safety Rules

- Do not commit private screenshots, auth codes, secrets, local IPs, real account identifiers, content IDs, or local absolute paths.
- Keep raw or timestamped captures in ignored folders such as `dist/tmp/`.
- Use synthetic or public-safe account state.
- Keep screenshots in the owning product repo under `.vref/`; do not aggregate app screenshots in `putio-design` by default.
- Prefer exact app screenshots over reconstructed browser mockups.

## Command Notes

- `vref build` validates `.vref/manifest.json`, checks assets, and writes `.vref/index.html`.
- `vref serve` serves `.vref/` on `127.0.0.1:4173` by default.
- Use `--output json` for agent automation.
