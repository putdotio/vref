# Contributing

## Setup

Use the Node version in [`.node-version`](./.node-version) and [pnpm](https://pnpm.io/installation).

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

Coverage is reported, not gated, and `verify` does not run it. Run it when
adding logic:

```bash
pnpm run coverage
```

## Development Notes

Scope and coding boundaries: [Repo-Specific Guidance](./AGENTS.md#repo-specific-guidance).

## Pull Requests

Use Conventional Commit-style titles such as `feat(cli): add gallery build command`.
When gallery output changes, attach a screenshot of the built gallery to the
pull request instead of committing it.
