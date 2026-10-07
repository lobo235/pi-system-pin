# Changelog

All notable changes to pi-system-pin are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) over the contract the README defines
(*Versioning*): the `system-pin.patch` and `system-pin.release` entry types, their data and key format,
that the transcript is never rewritten, and that a request only ever loses held section changes. The warning
text is not part of it.

## [Unreleased]

### Added

- A stopgap for pi#5581: system patches pi writes outside a user run are pinned (`system-pin.patch`) and
  their section changes held back from every request, so a run started by an extension's custom message
  sends the same system block as a user run. A held change a later user run agrees with is released
  (`system-pin.release`) and applies from then on.
- Compaction: a held change pi folds into a compaction's leading system message is left out there too, rebuilt
  from the original system messages on the branch, and only when that replay gives pi's own folded head.
- `pi-compat.json`, the verified pi versions (1.0.4), and a once-per-session warning on any other pi
  release line.
- Tests through a real pi session, including two `control:` tests that fail once pi fixes pi#5581 (the
  signal to uninstall), a load smoke through pi's own loader, and a smoke that drives the pi binary over RPC
  against a fake model.
- CI: tests on Linux and macOS, a secret scan and a package-contents check; a nightly run against the newest
  pi that opens a retire issue when a control test fails, a failure issue for anything else, and a pull request
  recording a new pi line only when everything passed and the control tests still show the flaw; npm
  publishing by trusted publishing.
