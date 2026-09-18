# Contributing

## Setup

Use Node `>=24.19.0` and pnpm.

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

Coverage is reported, not gated — `verify` does not run it, so a thin patch
fails review rather than CI:

```bash
pnpm run coverage
```

## Development Notes

Scope and coding boundaries: [Repo-Specific Guidance](./AGENTS.md#repo-specific-guidance).

## Pull Requests

Use Conventional Commit-style titles such as `feat(cli): add gallery build command`.
Include the relevant verification command and any visual reference screenshots or gallery links when UI output changes. Upload screenshots with
`gh pr comment <n> --attach ./file.png`; do not commit them.
