# Distribution

`@putdotio/vref` is a public npm package and CLI.

## Release Shape

Merges to `main` are publishable.
[CI](../.github/workflows/ci.yml) runs `pnpm run verify` (see [Contributing](../CONTRIBUTING.md#validation)), then semantic-release publishes to npm from the `release` Environment when Conventional Commits produce a release.

Release expectations:

- npm package: `@putdotio/vref`, public access
- npm Trusted Publishing through GitHub Actions OIDC for `putdotio/vref`, workflow `ci.yml`, Environment `release`, with provenance enabled in the release step
- the `release` Environment has no deployment records and no human approval
- `putio-releaser` writes tags, GitHub releases, and `[skip ci]` version bump commits, so it needs write access to protected `main` and `v*` tags

## Package Contents

The npm package includes `dist`, `README.md`, `docs`, `skills`, `AGENTS.md`,
and `SECURITY.md`. The reusable vref skill ships at `skills/vref/SKILL.md` so
consumer repos and shared skill installers can discover it.
