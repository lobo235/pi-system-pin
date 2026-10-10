@AGENTS.md

## Integration Surface & Consumers

What pi-system-pin exposes, and who depends on it. The README's *Versioning* section is the SemVer contract.

**Exposes**

- The npm package `pi-system-pin`: the pi extension entry `src/index.ts` (`package.json` `pi.extensions`). The
  TypeScript modules are not an importable API. No configuration and no environment variables.
- The persisted custom entry types `system-pin.patch` and `system-pin.release`, their `data` and key format;
  pins in an older transcript are still honoured.
- Its guarantees: it never rewrites the transcript, and a request only ever loses held section changes.
- `pi-compat.json`: the pi release lines it is verified against. Its control tests fail once pi fixes the flaw,
  the signal to retire it.

**Consumers**

- pi users who install the package, and their transcripts.
- Tools that read pi transcripts and filter custom entries by type: they must keep both entry types.
- Extensions that change the system prompt from `before_agent_start` (sections or a rewritten prompt): those
  changes are what it pins, so how they render is what a request carries.
- The maintainer's private operations repo carries an in-tree copy of this extension and a pre-push guard for
  this clone; a contract change is also a change there.
- Docs: README (*Configuration*, *pi versions*, *Known issues*, *Versioning*), `CHANGELOG.md`.
