# vref

`vref` curates screenshots as committed evidence of UI state, so an agent can
read what a screen looks like before changing it. The owning app repo captures;
`vref` takes over at the captured file.

## Language

### The reference set

**Visual reference**:
A curated screenshot committed as evidence of a UI state, kept stable enough to
read as fact.
_Avoid_: baseline, snapshot, mockup

**Reference set**:
Every visual reference recorded in one manifest.
_Avoid_: collection, gallery

**Manifest**:
The JSON document that records a reference set. `.vref/manifest.json` by default.
_Avoid_: index, catalog, config

**Manifest directory**:
The directory holding the manifest. Every asset path resolves inside it, and it
is what `serve` serves.
_Avoid_: vref dir, `.vref/` (only the default location), root

**Gallery**:
The static HTML page rendered from a reference set. Never the directory, never
the reference set itself.
_Avoid_: site, page, index

**Card**:
One visual reference as it appears in the gallery.
_Avoid_: tile, thumbnail, item

### One reference

**Entry**:
The manifest object describing one visual reference.
_Avoid_: screenshot, record, item

**Asset**:
The image file an entry's `file` points at.
_Avoid_: screenshot, image, file

**Source**:
The captured image handed to `vref` from outside the manifest directory. The app
repo's harness produces it; `vref` never captures one.
_Avoid_: input, capture, original

**Draft**:
The authored half of an entry, supplied as raw JSON. What a person or agent
knows and `vref` cannot measure.
_Avoid_: partial entry, payload

**Derived field**:
A field `vref` measures from the bytes rather than accepting from a draft, so it
cannot drift from the file.
_Avoid_: computed field, metadata

**Claimed**:
Said of an asset path that some entry already references. Claimed paths are
refused even when overwriting is otherwise permitted, because the replacement
would leave that entry describing an image it no longer points at.
_Avoid_: taken, in use, locked

### Taxonomy

**Group**:
The section a reference belongs to, and the gallery's primary division.
_Avoid_: category, section, folder

**Platform**:
The app surface a reference was captured from, such as Web or Roku.
_Avoid_: OS, target, client

**Device**:
The capture profile a reference came from, such as `Roku 720p` or `Chrome 1440`.
Narrower than platform.
_Avoid_: browser, resolution, screen

**Viewport**:
The CSS viewport a reference represents. Not the stored pixel dimensions, which
are twice as large on a retina capture.
_Avoid_: dimensions, size, resolution

**Tag**:
A free-form label for filtering the gallery, orthogonal to group.
_Avoid_: label, keyword, category

### Migration

**Legacy entry**:
An entry whose asset is png or jpeg. Still valid to read; never produced.
_Avoid_: old entry, unconverted entry

**Conversion**:
Re-encoding one legacy asset to webp and rewriting its entry to match.
_Avoid_: migration, upgrade, re-encode

**Original**:
The pre-conversion asset a conversion supersedes.
_Avoid_: source, old file

**Verbatim copy**:
A webp source stored without re-encoding, keeping whatever fidelity and metadata
it arrived with.
_Avoid_: passthrough, direct copy
