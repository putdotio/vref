# Agent Guide

## Repo

- Public TypeScript package and CLI for `@putdotio/vref`
- Owns webp encoding, manifest validation, static gallery rendering, serving, and the reusable vref agent skill
- App repos own their own `.vref/` folder and all capture mechanics; vref takes over at the captured file

## Start Here

- [Overview](./README.md)
- [Glossary](./CONTEXT.md) for what a reference, entry, asset, and source each mean here
- [Visual Reference Guide](./docs/VREF.md)
- [Distribution](./docs/DISTRIBUTION.md)
- [Security](https://github.com/putdotio/.github/blob/main/SECURITY.md)
- [vref Skill](./skills/vref/SKILL.md)

## Commands

- `pnpm install`, then `pnpm run verify` for the full gate; focused scripts are in [Contributing](https://github.com/putdotio/vref/blob/main/CONTRIBUTING.md#validation)
- `vref describe --output json` lists every CLI command, flag, `--fields` value, and error code; usage examples are in the [README](./README.md) and [Visual Reference Guide](./docs/VREF.md)

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
- `vref describe` advertises its own `schemaVersion` and the `--fields` values each command accepts; renaming or removing one is a breaking change that needs a `!` commit and a note in the guide and the skill
- Prefer `vref validate --output json` or `vref build --check --output json` before any workflow that should not mutate files
- Update docs and the vref skill when command behavior or screenshot safety rules change

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
