# Distribution

`@putdotio/vref` is a public npm package and CLI.

## Release Shape

Merges to `main` are publishable.
[CI](https://github.com/putdotio/vref/blob/main/.github/workflows/ci.yml) runs `pnpm run verify` (see [Contributing](https://github.com/putdotio/vref/blob/main/CONTRIBUTING.md#validation)), then semantic-release publishes to npm from the `release` Environment when Conventional Commits produce a release.

Links to files outside the tarball are absolute so they resolve for npm consumers.

The release job calls the [shared frontend release workflow](https://github.com/putdotio/.github) from `putdotio/.github`, pinned to a reviewed commit SHA; the semantic-release action and plugin pins live there. The `verify` job ends with the shared [links](https://github.com/putdotio/.github#actionslinks) and [scan](https://github.com/putdotio/.github#actionsscan) actions from the same repository: an offline Markdown link and anchor check on every run, and an Actionlint and Zizmor audit when a `main` push changes workflows and on manual dispatch. GitHub secret scanning and push protection cover secrets in this public repository.

Release expectations:

- npm package: `@putdotio/vref`, public access
- npm Trusted Publishing through GitHub Actions OIDC for `putdotio/vref`, workflow `ci.yml`, Environment `release`, with provenance enabled in the release step
- the `release` Environment has no deployment records and no human approval
- `putio-ci` writes tags, GitHub releases, and `[skip ci]` version bump commits, so it needs write access to protected `main` and `v*` tags

## Package Contents

`files` in [`package.json`](../package.json)
lists what the npm package ships. The reusable vref skill ships at
`skills/vref/SKILL.md` so consumer repos and shared skill installers can
discover it, and `CONTEXT.md` travels with it because the packaged `AGENTS.md`
links the glossary.
