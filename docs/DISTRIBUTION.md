# Distribution

`@putdotio/vref` is a public npm package and CLI.

## Local Guardrail

```bash
pnpm run verify
```

`verify` runs Vite+ checks, compiles TypeScript, runs tests, and dry-runs package creation.

## Release Shape

Merges to `main` are publishable.
CI runs the repo guardrail first, then semantic-release publishes to npm from the `release` Environment when Conventional Commits produce a release.

Release expectations:

- npm package: `@putdotio/vref`
- public package access
- npm Trusted Publishing through GitHub Actions OIDC
- release bot token for tags, GitHub releases, and `[skip ci]` version bump commits
- no hosted demo or deploy pipeline in the first slice

## First Release Checklist

- Configure npm Trusted Publishing for `putdotio/vref`, workflow `ci.yml`, and Environment `release`.
- Confirm `putio-release-bot` can write to protected `main` and `v*` tags.
- Run `pnpm run verify`.
- Merge a `feat:` or `fix:` commit to `main`.
- Confirm the GitHub Release, npm package, and release bump commit.
