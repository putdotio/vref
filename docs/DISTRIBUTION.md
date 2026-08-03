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
- npm provenance enabled in the release step
- release bot token for tags, GitHub releases, and `[skip ci]` version bump commits

## Deploy Pipeline

There is no deploy pipeline for the first slice.
`vref` is a versioned package and CLI, not a running app or hosted service.
Use the release pipeline for npm publishing; add a deploy workflow only if the repo later owns a hosted demo or service.

## Package Contents

The npm package includes `dist`, `README.md`, `docs`, `skills`, `AGENTS.md`,
and `SECURITY.md`. The reusable vref skill lives at `skills/vref/SKILL.md` so
consumer repos and shared skill installers can discover it without treating this
repo's private `.agents/` folder as a distribution surface.

## First Release Checklist

- Configure npm Trusted Publishing for `putdotio/vref`, workflow `ci.yml`, and Environment `release`.
- Configure the `release` Environment without deployment records or human approval unless maintainers intentionally want a manual publish gate.
- Confirm `putio-releaser` can write to protected `main` and `v*` tags.
- Run `pnpm run verify`.
- Merge a `feat:` or `fix:` commit to `main`.
- Confirm the GitHub Release, npm package, and release bump commit.
