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

- **The pull request title** becomes the squash commit's subject: `area: summary`, in the imperative or as a
  statement of the new behaviour (`render: keep the Goal line once the Request moves`).
- **Tests first**, one behaviour at a time, through the public functions or the extension's events.
  `src/test-support.ts` has an in-memory pi; use fakes, not mocks that assert call order.
- **Never weaken the `control:` tests** in `src/session.test.ts` or the control runs in `scripts/pi-smoke.ts`.
  They assert that pi still has the flaw; when they fail, the fix is to retire this package, not the test.
- **Fixtures are synthetic.** No real transcript, hostname, IP address, user name or key, even redacted.
- **Small pieces**: functions under 60 lines, files under 400.
- **Docs in the same pull request**: the README for behaviour, and a line in `CHANGELOG.md` under
  `## [Unreleased]`.
- The entry types `system-pin.patch` and `system-pin.release` and their key format never change without a
  major version (README, *Versioning*).

CI runs `npm test` on Linux, macOS and Windows with Node 24 and on Linux with Node 22.19.0 (the oldest
supported); every leg must pass. It also runs a secret scan, a security audit of the workflows (zizmor) and a check of
what the package would publish (`npm run check-pack`).

## Verifying a new pi version

pi-system-pin relies on pi internals, so each pi release line is verified before it is listed in
`pi-compat.json`. To verify one:

1. Set the exact version of `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai` and
   `@earendil-works/pi-agent-core` in `devDependencies` (pi publishes them in lockstep, and the tests import all
   three), then `npm install`, and check `node_modules/@earendil-works/pi-coding-agent/package.json`.
2. `npm test`. Only the version gate in `src/pi-compat.test.ts` may fail. **If a `control:` test fails, or the
   smoke reports that a control run kept the section, pi has fixed the flaw: do not record the version;
   open an issue to retire the package.** Any other failure is a pi change to handle first.
3. Record it: `node scripts/record-pi-version.ts <version> "<what you ran>" "<what you ran>"`.

A nightly job runs steps 1 and 2 against the newest pi. When a control check fails (a `control:` test or the
smoke's control runs, `npm run smoke -- --control-only`) it opens an issue to retire the package and records
nothing. When everything passes on a new release line, the control checks included, it opens a pull request
recording it. Any other failure opens a failure issue.

## Releasing (maintainers)

1. Set `version` in `package.json` (from `0.0.0` for the first release) and rename `## [Unreleased]` in
   `CHANGELOG.md` to `## [vX.Y.Z] - YYYY-MM-DD`, with the `v`: the release workflow checks for that heading. Point `pi.image` in `package.json` at the new tag too: the release job checks it.
2. **The first publish of the package is manual**: `npm publish --access public` from a clean checkout of the
   release commit, with 2FA. npm cannot configure a trusted publisher for a package that does not exist yet.
   Right after it, on npmjs.com: configure the trusted publisher (this repository, workflow `release.yml`,
   environment `npm`), set publishing access to "Require two-factor authentication and disallow tokens", and
   delete any token that was used. A trusted-publisher configuration must complete its first publish within 2
   days or it expires; if it expires, configure it again before the next release.
3. **Every later release**: tag `vX.Y.Z` on `main` and push the tag. `release.yml` checks the tag against
   `package.json` and the changelog, runs `npm test` and `npm run check-pack`, and then publishes with provenance
   from the `npm` environment, after a maintainer approves it there.

**Where a release shows up.** The [pi package gallery](https://pi.dev/packages) lists the package from npm within
minutes of a publish: its card shows the `package.json` `description` and the `pi.image` card
(`.github/assets/infographic.png`, pinned to the release tag), and its page renders the README inside the published
tarball. Editing either on GitHub changes nothing there until the next release, and a README link to a file the
package does not ship must be an absolute GitHub URL. After `publish`, `release.yml` creates the GitHub Release
for the tag from its `CHANGELOG.md` section; for the manual first publish, run
`gh release create vX.Y.Z --verify-tag --title vX.Y.Z --notes-file <that section>` instead. The repository's
social preview (Settings > General) is `.github/assets/social-preview.png`, uploaded by hand.

## Repository settings (maintainers)

The workflows and docs depend on these GitHub settings:

- **Private vulnerability reporting** enabled (Settings > Security): `SECURITY.md` and the issue form link to it.
- **"Allow GitHub Actions to create and approve pull requests"** enabled (Settings > Actions > General): the
  nightly job opens the pull request that records a new pi line. Without it the job fails, naming the setting.
- **An environment named `npm`** with required reviewers and a deployment tag rule `v*`: without reviewers a
  release publishes with no one's approval.
- **Rulesets**: `main` requires a pull request approved by a code owner (`.github/CODEOWNERS`), with its review threads
  resolved and a linear history (squash or
  rebase merges), and every CI check: the `test` legs, `workflows` and `secrets`. Maintainers can bypass it. `v*` tags are
  protected.
- **Security**: Dependabot alerts and security updates, plus the weekly version updates in `.github/dependabot.yml`; CodeQL
  default setup, whose high and critical alerts block a merge; secret scanning with push protection.
- GitHub pauses scheduled workflows in a repository with no activity for 60 days; re-enable `nightly-pi` from
  the Actions tab when that happens.

Nothing links GitHub Discussions, so they need not be enabled.

## Licence

pi-system-pin is MIT licensed. By opening a pull request you agree your contribution is licensed under the same
terms (inbound = outbound). There is no CLA and no sign-off requirement.

## Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
