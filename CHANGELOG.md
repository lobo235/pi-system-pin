# Changelog

All notable changes to pi-system-pin are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) over the contract the README defines
(*Versioning*): the `system-pin.patch` and `system-pin.release` entry types, their data and key format,
that the transcript is never rewritten, and that a request only ever loses held section changes. The warning
text is not part of it.

## [Unreleased]

## [v1.0.1] - 2026-10-10

### Changed

- Supports pi 0.87.1 and newer (was 1.0.0): pi 0.87.1, 0.99.0, 0.99.1 and 0.99.2 are verified to have the flaw,
  pass the full suite and are recorded in `pi-compat.json`, as are 1.0.1, 1.0.2 and 1.0.3. Tested with every pi
  from 0.87.1 to 1.1.0. No code changes.
- Published from the release workflow through npm trusted publishing, so this version carries a provenance
  attestation linking it to its source commit. v1.0.0 was published by hand and has none.

## [v1.0.0] - 2026-10-10

### Added

- A stopgap for pi#5581: system patches pi writes outside a user run are pinned (`system-pin.patch`) and
  their section changes held back from every request, so a run started by an extension's custom message
  sends the same system block as a user run. A held change a later user run agrees with is released
  (`system-pin.release`) and applies from then on.
- Compaction: a held change pi folds into a compaction's leading system message is left out there too, rebuilt
  from the original system messages on the branch, and only when that replay gives pi's own folded head.
- `pi-compat.json`, the pi versions verified to still have the flaw, and a once-per-session warning on any other
  pi release line. The peer dependency is pi 1.0.0 or newer.
- Tests through a real pi session, including two `control:` tests that fail once pi fixes pi#5581 (the
  signal to uninstall); a load smoke that loads `src/index.ts` through pi's jiti transform; and a smoke that
  packs the package with `npm pack`, installs it with `pi install` (so pi finds it through the package's
  `pi.extensions` manifest and the published file list), and drives the pi binary over RPC against a fake
  model, with folded and with mid-conversation system messages, plus the same runs without it as controls.
- CI: tests on Linux, macOS and Windows, a secret scan, a workflow security audit (zizmor), Dependabot updates and a package-contents check; a nightly run against the newest
  pi that opens a retire issue when a control check fails, a failure issue for anything else, and a pull request
  recording a new pi line only when everything passed and the control checks still show the flaw, with the
  write token given only to the steps that push or open issues; npm publishing by trusted publishing, then a GitHub Release carrying the tag's changelog notes.
