# Distribution

`@putdotio/vref` is a public npm package and CLI.

## Release Shape

Merges to `main` are publishable.
[CI](https://github.com/putdotio/vref/blob/main/.github/workflows/ci.yml) runs `pnpm run verify` (see [Contributing](https://github.com/putdotio/vref/blob/main/CONTRIBUTING.md#validation)), then semantic-release publishes to npm from the `release` Environment when Conventional Commits produce a release.

Those two links are absolute because neither file ships in the tarball, where a
relative link would dead-end.

The release job calls the [shared frontend release workflow](https://github.com/putdotio/.github) from `putdotio/.github`, pinned to a tagged commit; the semantic-release action and plugin pins live there. [`scan.yml`](https://github.com/putdotio/vref/blob/main/.github/workflows/scan.yml) calls the shared frontend scan workflow from the same repository: Gitleaks, TruffleHog, Actionlint, and Zizmor on pull requests, weekly, and on manual dispatch.

Release expectations:

- npm package: `@putdotio/vref`, public access
- npm Trusted Publishing through GitHub Actions OIDC for `putdotio/vref`, workflow `ci.yml`, Environment `release`, with provenance enabled in the release step
- the `release` Environment has no deployment records and no human approval
- `putio-releaser` writes tags, GitHub releases, and `[skip ci]` version bump commits, so it needs write access to protected `main` and `v*` tags

## Package Contents

The npm package includes `dist`, `README.md`, `docs`, `skills`, `AGENTS.md`,
`CONTEXT.md`, and `SECURITY.md`. The reusable vref skill ships at
`skills/vref/SKILL.md` so consumer repos and shared skill installers can
discover it, and `CONTEXT.md` travels with it because the packaged `AGENTS.md`
links the glossary.
