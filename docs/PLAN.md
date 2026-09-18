# Plan

## First Slice

`@putdotio/vref` is a small render-and-serve CLI.

- `vref build` validates a repo-local manifest and screenshot assets, then writes a static gallery.
- `vref validate` and `vref build --check` validate without writing files.
- `vref serve` serves the generated reference folder locally.
- `vref describe --output json` exposes the command and manifest contract for agents.
- `vref screenshot add` encodes a captured source image to webp and appends its manifest entry.
- `vref convert` migrates existing non-webp assets to webp.
- App repos own screenshot capture; vref owns the encode-and-place step that follows.

## Image Format

References are webp. `vref screenshot add` accepts `.png`, `.jpg`, and `.webp`
sources and always writes `.webp`, lossless by default because these files are
pixel evidence rather than gallery decoration: on flat UI captures lossless webp
is smaller than lossy q85 and keeps text edges exact. `--quality` opts into lossy
for photo-heavy captures.

Manifests may still reference legacy `.jpg`, `.jpeg`, and `.png` assets so
existing reference sets keep validating; `vref convert` migrates them.

## Non-Goals

- no screenshot capture
- no screenshot approval
- no visual diffing
- no PR comments
- no cross-repo screenshot aggregation
- no hosted service or demo
- no platform-specific capture logic

## Current Architecture

- Manifest and screenshots live in the product repo, usually under `.vref/`.
- `sharp` encodes webp. It is a direct dependency, imported lazily so `validate`, `build`, and `serve` never load it.
- The manifest path can be overridden for migrating repos such as `docs/visual/manifest.json`.
- Build and serve reject unsafe paths, traversal, URL-like asset paths, and symlink escapes.
- Prototype and visual-experiment repos remain separate; app screenshots stay in the owning app repo.
