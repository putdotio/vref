# Agent Guide

## Repo

- Public TypeScript package and CLI for `@putdotio/vref`
- Owns webp encoding, manifest validation, static gallery rendering, serving, and the reusable vref agent skill
- App repos own their own `.vref/` folder and all capture mechanics; vref takes over at the captured file

## Start Here

- [Overview](./README.md)
- [Visual Reference Guide](./docs/VREF.md)
- [Distribution](./docs/DISTRIBUTION.md)
- [Security](./SECURITY.md)
- [vref Skill](./skills/vref/SKILL.md)

## Commands

- `pnpm install`
- `pnpm run build`
- `pnpm run check`
- `pnpm run test`
- `pnpm run verify`
- `vref validate --output json`
- `vref build`
- `vref build --check --output json`
- `vref serve`
- `vref screenshot add ./capture.png --json '{"id":"home",...}' --dry-run --output json`
- `vref convert --dry-run --output json`
- `vref manifest add --json '{"id":"home",...}' --dry-run --output json`
- `vref describe --output json`

## Effect

This repository uses the Effect TypeScript library. The installed version's own
guide is `node_modules/effect/AGENTS.md`; consult it for the APIs the change
touches, and search `node_modules/effect/src` for anything it does not cover.

## Repo-Specific Guidance

- Keep `vref` platform-neutral: it encodes, renders, validates, and serves visual references; app repos capture and curate screenshots
- `vref` writes webp only. Manifests still accept legacy `.jpg`, `.jpeg`, and `.png` entries so existing repos keep validating; `vref convert` migrates them
- Keep `sharp` behind a lazy import so `validate`, `build`, and `serve` never load the encoder
- Keep `.vref/manifest.json` and `.vref/screenshots/*` safe for the owning repo's visibility before committing
- Do not add visual diffing, PR comments, cross-repo aggregation, hosted services, or platform-specific capture without a new design pass
- Use typed manifest parsing and structured CLI output; agents should prefer `--output json`
- Use `--fields` to keep JSON responses small when only a few top-level result fields are needed
- Prefer `vref validate --output json` or `vref build --check --output json` before any workflow that should not mutate files
- Update docs and the vref skill when command behavior or screenshot safety rules change
