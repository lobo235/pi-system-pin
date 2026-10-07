# Security policy

## Reporting a vulnerability

Report it privately through GitHub: the repository's **Security** tab, then **Report a vulnerability**. Do not
open a public issue, discussion or pull request for it.

Include the pi-system-pin and pi versions, what an attacker controls, and what they gain. A minimal synthetic
transcript that shows it is ideal. **Do not send real transcripts or keys**; if the problem only shows on real
data, describe its shape instead.

You should get an acknowledgement within 7 days. A fix is released as a patch version, and the advisory is
published once a fixed version is available, crediting you unless you prefer otherwise.

## Supported versions

The latest release.

## What the extension does

pi-system-pin makes no network calls and reads only its own `pi-compat.json`; it writes nothing except its two
custom transcript entries (`system-pin.patch`, `system-pin.release`). On every request it can only **remove**
section changes from system patches it pinned, and after a compaction it rebuilds the leading system message
without those changes, from the original system messages on the branch. A request never carries text the
transcript does not, and no message on the transcript is ever rewritten.

## Scope

In scope: anything where pi-system-pin itself turns untrusted input into harm. For example:

- transcript content (a session file is untrusted input) that makes a handler throw, hang, or hold back a
  change it did not pin;
- a way for a custom-message run to keep a section held back after a user run has removed it on purpose;
- a request that carries content the transcript does not.

Out of scope: pi itself and other extensions (report those to their projects), a provider's handling of what it
is sent, and the documented behaviour that a deliberate section change in a custom-message run waits for the
next user run (README, *Costs and limits*).
