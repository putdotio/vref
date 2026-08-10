# Contributing

## Setup

Use Node `>=24.18.0` and pnpm.

```bash
pnpm install
pnpm run hooks:install
```

The checked-in pre-push hook runs the full verification gate before each push.

## Run Locally

Build the package:

```bash
pnpm run build
```

Run the local CLI against a repo that has `.vref/manifest.json`:

```bash
node ./dist/cli.mjs validate --output json
node ./dist/cli.mjs build --check --output json
node ./dist/cli.mjs build
node ./dist/cli.mjs serve
```

## Validation

Run the full repo guardrail:

```bash
pnpm run verify
```

For focused work:

```bash
pnpm run check
pnpm run typecheck
pnpm run build
pnpm run smoke
pnpm run test
pnpm run pack:dry
```

## Development Notes

- Keep capture mechanics in the product repo. `vref` should stay platform-neutral.
- Keep manifest parsing strict and typed; external input is not trusted.
- Prefer `--output json` in examples intended for agents.
- Do not add visual diffing, hosted aggregation, PR comments, or platform-specific capture in this repo without a design update.

## Pull Requests

Use Conventional Commit-style titles such as `feat(cli): add gallery build command`.
Include the relevant verification command and any visual reference screenshots or gallery links when UI output changes.
