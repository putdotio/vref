# Agent Guide

## Repo

- Public TypeScript package and CLI for `@putdotio/vref`
- Owns visual reference manifest validation, static gallery rendering, serving, and the reusable vref agent skill
- App repos own their own `.vref/` folder and all capture mechanics

## Start Here

- [Overview](./README.md)
- [Visual Reference Guide](./docs/VREF.md)
- [Plan](./docs/PLAN.md)
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
- `vref manifest add --json '{"id":"home",...}' --dry-run --output json`
- `vref describe --output json`

## Repo-Specific Guidance

- Keep `vref` platform-neutral: it renders, validates, and serves visual references; app repos capture and curate screenshots
- Keep `.vref/manifest.json` and `.vref/screenshots/*` safe for the owning repo's visibility before committing
- Do not add visual diffing, PR comments, cross-repo aggregation, hosted services, or platform-specific capture without a new design pass
- Use typed manifest parsing and structured CLI output; agents should prefer `--output json`
- Use `--fields` to keep JSON responses small when only a few top-level result fields are needed
- Prefer `vref validate --output json` or `vref build --check --output json` before any workflow that should not mutate files
- Update docs and the vref skill when command behavior or screenshot safety rules change
