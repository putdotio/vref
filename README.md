<div align="center">
  <p>
    <img src="https://static.put.io/images/putio-boncuk.png" width="72">
  </p>

  <h1>vref</h1>

  <p>
    Visual reference CLI for curated put.io screenshots.
  </p>
  <p>
    Build and serve static galleries from repo-local manifests so agents can inspect UI evidence before they edit.
  </p>

  <p>
    <a href="https://github.com/putdotio/vref/actions/workflows/ci.yml?query=branch%3Amain" style="text-decoration:none;"><img src="https://img.shields.io/github/actions/workflow/status/putdotio/vref/ci.yml?branch=main&style=flat&label=ci&colorA=000000&colorB=000000" alt="CI"></a>
    <a href="https://www.npmjs.com/package/@putdotio/vref" style="text-decoration:none;"><img src="https://img.shields.io/npm/v/%40putdotio%2Fvref?style=flat&colorA=000000&colorB=000000" alt="npm version"></a>
    <a href="https://github.com/putdotio/vref/blob/main/LICENSE" style="text-decoration:none;"><img src="https://img.shields.io/github/license/putdotio/vref?style=flat&colorA=000000&colorB=000000" alt="license"></a>
  </p>
</div>

## Installation

Install in an app repo that owns visual references:

```bash
pnpm add -D @putdotio/vref
```

## Quick Start

Create a repo-local manifest and screenshots:

```txt
.vref/
  manifest.json
  screenshots/
```

Build the gallery:

```bash
vref build
```

Validate without writing `index.html`:

```bash
vref validate --output json
vref build --check --output json
```

After the owning app repo captures or updates screenshots, rebuild the gallery:

```bash
vref build
```

Open the gallery locally:

```bash
vref serve
```

Agents should inspect the command schema before automating:

```bash
vref describe --output json
```

When `vref` output is piped or captured in a non-interactive process, JSON is
the default. Use `--fields` to keep automation responses small:

```bash
vref validate --fields screenshotCount,groupCount
vref describe --fields commands,automation
```

## Manifest

`vref` reads `.vref/manifest.json` by default and writes `.vref/index.html`.
Screenshot `file` paths are relative to `.vref/` and must stay inside that directory.

```json
{
  "version": 1,
  "title": "put.io Roku visual reference",
  "description": "Curated Roku screenshots for review and design comparison.",
  "updatedAt": "2026-05-19T13:35:00.000Z",
  "screenshots": [
    {
      "id": "home",
      "title": "Home",
      "group": "Main pages",
      "platform": "Roku",
      "device": "Roku 720p",
      "viewport": { "width": 1280, "height": 720 },
      "file": "screenshots/roku-720p/home.jpg",
      "capturedAt": "2026-05-19T13:34:00.000Z",
      "sizeBytes": 22788,
      "tags": ["home", "navigation"],
      "notes": ["Home menu with Files, Search, and Settings visible."]
    }
  ]
}
```

Append a screenshot entry from raw JSON without editing the manifest by hand:

```bash
vref manifest add --json '{"id":"settings","title":"Settings","group":"Main pages","platform":"Roku","device":"Roku 720p","viewport":{"width":1280,"height":720},"file":"screenshots/roku-720p/settings.jpg","capturedAt":"2026-05-19T13:35:00.000Z","sizeBytes":39716,"tags":["settings"],"notes":["Settings page."]}' --dry-run --output json
```

Remove `--dry-run` after the preview looks correct. The command only edits
manifest metadata; app repos still own screenshot capture and file updates.

## Docs

- [Visual Reference Guide](./docs/VREF.md)
- [Plan](./docs/PLAN.md)
- [Distribution](./docs/DISTRIBUTION.md)
- [vref skill](./skills/vref/SKILL.md)
- [Agent guide](./AGENTS.md)
- [Security](./SECURITY.md)

## Contributing

See [Contributing](./CONTRIBUTING.md) for setup, validation, and pull request expectations.

## License

MIT, see [License](./LICENSE)
