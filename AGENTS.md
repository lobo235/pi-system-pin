# Working on pi-system-pin (for coding agents)

pi-system-pin is a pi extension and a **stopgap** for pi#5581: a run started by an extension's custom message
(`sendMessage` with `triggerTurn`) falls back to pi's base prompt, and the system patches that causes are held
back from every request until a user run agrees with them. It is to be uninstalled once pi fixes the flaw.
Human contributors: [CONTRIBUTING.md](CONTRIBUTING.md) says the same with more context.

## Commands

```bash
npm ci                 # Node >= 22.19; installs the vendored pi as a devDependency
npm test               # typecheck + every src/ and scripts/ test + load smoke + pi binary smoke; must pass before any commit
npm run typecheck      # tsc only
node --test src/pin.test.ts   # one file
npm run smoke          # npm pack + pi install, then the vendored pi binary over RPC, fake model
npm run smoke -- --keep   # the same, keeping its temporary directory to inspect
npm run check-pack     # what npm would publish: nothing test-only, nothing missing
```

## Layout

- `src/index.ts`: the extension entry (events, run lifecycle, the pi-version warning).
- `src/patch.ts`: a system patch and its key. `src/pin.ts`: holding pinned changes back, and the release rule.
- `src/fold.ts`: pinned changes pi folded into a compaction's head. `src/request.ts`: the request a
  `context_with_system` handler returns, combining both.
- `src/entries.ts`: the `system-pin.patch` / `system-pin.release` transcript entries.
- `src/pi-compat.ts` + `pi-compat.json`: the pi versions verified, and the version-line check.
- `src/session.test.ts`: a real pi session with a fake model, including the two `control:` tests.
- `src/test-support.ts`: an in-memory pi for the wiring tests (not shipped).
- `scripts/`: the pi binary smoke (`pi-smoke.ts`, its harness and its fixture extension), the package check,
  `record-pi-version.ts`, and `nightly-action.ts` (what the nightly job reports: retire, record or fail).

## Invariants (do not break these)

1. **Persisted names never change.** `system-pin.patch`, `system-pin.release`, their `{ key }` data and the key
   format are read back from existing transcripts. A change needs a migration and a major version.
2. **The control tests stay.** The `control:` tests and the smoke's control runs assert that pi still has the
   flaw. When they fail, pi has fixed it and the package is retired; never weaken them to make a pi pass.
3. **pi versions are verified, not assumed.** `src/pi-compat.test.ts` fails on a vendored pi that
   `pi-compat.json` does not list. Do not add a version without the procedure in CONTRIBUTING.md.
4. **It only holds back.** A request never carries anything the transcript does not, and the transcript is never
   rewritten. Held section changes are left out of the patch messages and, after a compaction, out of the
   leading system message pi folded them into, rebuilt from the original system messages on the branch only when
   that replay gives pi's own folded head.
5. **Transcript bytes are untrusted.** Entry data is type-checked before use; parsing never throws on content.
6. **Fixtures are synthetic.** No real transcript, hostname, IP address, user name or key, even redacted.

## How to change code

- Test first, one behaviour at a time, through the public function or the extension's events.
- Functions stay under 60 lines and files under 400.
- Update the README and `CHANGELOG.md` (under `## [Unreleased]`) in the same change.
- Do not bump the version or edit `pi-compat.json` unless asked; both are release steps (CONTRIBUTING.md,
  *Releasing* and *Verifying a new pi version*).
