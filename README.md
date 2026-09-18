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

Add a capture to the gallery. `vref` encodes it to lossless webp, writes it under
`.vref/screenshots/`, and appends the manifest entry:

```bash
vref screenshot add ./dist/tmp/home.png --json '{"id":"home","title":"Home","group":"Main pages","platform":"Web","device":"Chrome 1440","tags":["home"],"notes":["Home grid."]}'
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

## Screenshots

`vref` writes webp only, from `.png`, `.jpg`, or `.webp` sources. Encoding is
lossless unless `--quality 1-100` asks for lossy. A webp source is copied
verbatim, keeping whatever fidelity it already had — but only when its bytes are
really webp and it carries no EXIF orientation, since a verbatim copy cannot be
uprighted.

It fills in the derived half of the manifest entry: `sizeBytes` from the encoded
byte length, `viewport` from the encoded pixel dimensions, `capturedAt` from the
source file's modification time, and `file` from the screenshot id. `sizeBytes`
is always measured, so it cannot drift from the file; the other three are
defaults your `--json` may override.

Preview an add without writing anything:

```bash
vref screenshot add ./capture.png --json '{"id":"home",...}' --dry-run --output json
```

Migrate an existing png or jpeg reference set. Legacy entries keep validating,
so upgrading does not force this:

```bash
vref convert --dry-run --output json
vref convert
```

The [Visual Reference Guide](./docs/VREF.md#image-format) covers the format
choice, retina viewports, and what `convert` does to your originals.

## Manifest

`vref` reads `.vref/manifest.json` by default and writes `.vref/index.html`. It
stamps `updatedAt` whenever it rewrites the manifest.
Screenshot `file` paths are relative to the manifest's directory and must stay
inside it.

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
      "file": "screenshots/roku-720p/home.webp",
      "capturedAt": "2026-05-19T13:34:00.000Z",
      "sizeBytes": 22788,
      "tags": ["home", "navigation"],
      "notes": ["Home menu with Files, Search, and Settings visible."]
    }
  ]
}
```

Append a metadata-only entry for a screenshot file you are placing yourself.
When you have the captured image, prefer `vref screenshot add` above:

```bash
vref manifest add --json '{"id":"settings","title":"Settings","group":"Main pages","platform":"Roku","device":"Roku 720p","viewport":{"width":1280,"height":720},"file":"screenshots/roku-720p/settings.webp","capturedAt":"2026-05-19T13:35:00.000Z","sizeBytes":39716,"tags":["settings"],"notes":["Settings page."]}' --dry-run --output json
```

Remove `--dry-run` after the preview looks correct. This command only edits
manifest metadata; it never encodes or copies the image.

## Docs

- [Visual Reference Guide](./docs/VREF.md)
- [Glossary](./CONTEXT.md)
- [Distribution](./docs/DISTRIBUTION.md)
- [vref skill](./skills/vref/SKILL.md)
- [Agent guide](./AGENTS.md)
- [Security](./SECURITY.md)

## Contributing

See [Contributing](./CONTRIBUTING.md) for setup, validation, and pull request expectations.

## License

MIT, see [License](./LICENSE)
