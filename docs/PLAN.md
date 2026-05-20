# Plan

## First Slice

`@putdotio/vref` is a small render-and-serve CLI.

- `vref build` validates a repo-local manifest and screenshot assets, then writes a static gallery.
- `vref validate` and `vref build --check` validate without writing files.
- `vref serve` serves the generated reference folder locally.
- `vref describe --output json` exposes the command and manifest contract for agents.
- App repos own screenshot capture, file updates, and manifest metadata updates.

## Non-Goals

- no screenshot capture
- no screenshot approval or copying
- no visual diffing
- no PR comments
- no cross-repo screenshot aggregation
- no hosted service or demo
- no platform-specific capture logic

## Current Architecture

- Manifest and screenshots live in the product repo, usually under `.vref/`.
- The manifest path can be overridden for migrating repos such as `docs/visual/manifest.json`.
- Build and serve reject unsafe paths, traversal, URL-like asset paths, and symlink escapes.
- `putio-design` remains for prototypes and visual experiments, not app screenshot aggregation.
