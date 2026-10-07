# Contributing to pi-system-pin

Thank you for helping. pi-system-pin is a stopgap for one pi bug
([pi#5581](https://github.com/earendil-works/pi/issues/5581)) and is meant to be retired when pi fixes it, so
it stays small: fixes, pi-version support and clearer docs are welcome; new features are mostly out of scope.
Coding agents: [AGENTS.md](AGENTS.md) has the same rules in a shorter form.

## Before you write code

Open an issue first for anything larger than a typo or a one-line fix. Say what you saw, what you expected, and
what you would change. **Never paste a real transcript into an issue**; describe its shape, or build a
synthetic one. Security problems go to [SECURITY.md](SECURITY.md), not an issue.

## Setting up

```bash
git clone https://github.com/lobo235/pi-system-pin && cd pi-system-pin
npm ci          # Node >= 22.19
npm test        # typecheck, unit tests, real-pi session tests, load smoke, pi binary smoke
```

To try a change in your own pi: `pi install /path/to/pi-system-pin`, then start a new session.
`pi remove /path/to/pi-system-pin` undoes it.

## Making the change

- **Tests first**, one behaviour at a time, through the public functions or the extension's events.
  `src/test-support.ts` has an in-memory pi; use fakes, not mocks that assert call order.
- **Never weaken the `control:` tests** in `src/session.test.ts` or the control run in `scripts/pi-smoke.ts`.
  They assert that pi still has the flaw; when they fail, the fix is to retire this package, not the test.
- **Fixtures are synthetic.** No real transcript, hostname, IP address, user name or key, even redacted.
- **Small pieces**: functions under 60 lines, files under 400.
- **Docs in the same pull request**: the README for behaviour, and a line in `CHANGELOG.md` under
  `## [Unreleased]`.
- The entry types `system-pin.patch` and `system-pin.release` and their key format never change without a
  major version (README, *Versioning*).

CI runs `npm test` on Linux and macOS, a secret scan, and a check of what the package would publish
(`npm run check-pack`).

## Verifying a new pi version

pi-system-pin relies on pi internals, so each pi release line is verified before it is listed in
`pi-compat.json`. To verify one:

1. Set the exact version of `@earendil-works/pi-coding-agent` in `devDependencies`, then `npm install`, and
   check `node_modules/@earendil-works/pi-coding-agent/package.json`.
2. `npm test`. Only the version gate in `src/pi-compat.test.ts` may fail. **If a `control:` test fails, or the
   smoke reports that the control run kept the section, pi has fixed the flaw: do not record the version;
   open an issue to retire the package.** Any other failure is a pi change to handle first.
3. Record it: `node scripts/record-pi-version.ts <version> "<what you ran>" "<what you ran>"`.

A nightly job runs steps 1 and 2 against the newest pi. When they pass on a new release line it opens a pull
request recording it; when they fail it opens an issue.

## Licence

pi-system-pin is MIT licensed. By opening a pull request you agree your contribution is licensed under the same
terms (inbound = outbound). There is no CLA and no sign-off requirement.

## Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
