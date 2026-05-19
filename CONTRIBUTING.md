# Contributing

## Setup

Use Node `>=24.14.0` and pnpm.

```bash
pnpm install
```

## Run Locally

Build the package:

```bash
pnpm run build
```

Run the local CLI against a repo that has `.vref/manifest.json`:

```bash
node ./dist/cli.js build
node ./dist/cli.js serve
```

## Validation

Run the full repo guardrail:

```bash
pnpm run verify
```

For focused work:

```bash
pnpm run check
pnpm run build
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
