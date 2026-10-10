# pi-system-pin

![pi-system-pin: four requests in one session; without it the request head changes when a background task's run drops the extensions' sections and again when the next prompt restores them, each time re-reading the whole conversation; with it the head never changes and every request reuses the cached prefix](https://raw.githubusercontent.com/lobo235/pi-system-pin/main/.github/assets/infographic.png)

**The same request head, whatever started the run.** A stopgap for
[pi#5581](https://github.com/earendil-works/pi/issues/5581): it keeps a request's system block byte-identical
when an extension's message starts a run, so a prefix cache does not read the whole conversation again. Uninstall
it once pi fixes that issue.

```bash
pi install npm:pi-system-pin
```

## Why pi-system-pin

In [pi](https://github.com/earendil-works/pi), extensions shape the system prompt in the `before_agent_start`
event, and pi fires that event only for a user prompt. A run started by an extension's custom message
(`pi.sendMessage(..., { triggerTurn: true })`) falls back to pi's base prompt, so the sections extensions added
drop out for the rest of that run and come back with the next user prompt. On a model that receives the system
prompt as one leading message, each of those changes rewrites the head of the request, and a provider that
caches prompt prefixes has to read the whole conversation again, twice per such run. pi-system-pin holds those
fallback changes back, so the system block stays the same whatever started the run.

Those runs are common in a busy session: a background task reporting back, a message from another agent, a
scheduled wake-up, a review loop handing back its findings. On a self-hosted model with prefix caching, each
one can cost two full re-reads of a conversation that may be tens of thousands of tokens long.

It is a workaround, not a feature. When pi fixes the flaw upstream, remove it (see
[When pi fixes pi#5581](#when-pi-fixes-pi5581)); its tests are built to tell you when that has happened.

## Do you need it?

Only if all three are true:

1. **An extension adds or rewrites system-prompt sections** in `before_agent_start` (a tool policy, project
   rules, a reordered prompt).
2. **Something starts runs with custom messages**: an extension that calls `pi.sendMessage` with
   `triggerTurn: true`, such as a background-task notice, a message from another agent, a scheduled wake-up or
   a review loop that hands its findings back.
3. **The model gets its system prompt folded into one leading message.** pi-ai does this for every model whose
   `supportsMidConvoSystemMessages` compat setting is off, which is the default for models you define yourself
   in `models.json` (a self-hosted vLLM, SGLang or llama.cpp server, an OpenAI-compatible proxy) and for any
   catalog model not verified for mid-conversation system messages. It costs most where the provider caches
   prompt prefixes: every head rewrite is a full re-read of the conversation.

With a model that does accept mid-conversation system messages, pi sends each change as a later system message
and the cached prefix survives; the run still loses the extensions' sections from its second turn on.
pi-system-pin keeps them there too (the next user prompt's patch, which sets the section to the text it already
has, still goes out as one appended system message), but the cost it saves is much smaller.

You do not need it when no extension shapes the system prompt, or when nothing starts runs with custom
messages: it then never pins anything and only reads each request. You should not keep it once pi fixes
pi#5581.

## Install

```bash
pi install npm:pi-system-pin
```

Requirements:

- pi 1.0.0 or newer, on a release line listed in [pi-compat.json](pi-compat.json). Another pi works too; it
  warns once per session (see [pi versions](#pi-versions)). pi 1.0.0, 1.0.4 and 1.1.0 are verified to have the flaw;
  the other 1.0 releases are on the same line as two of them and are expected to.
- Node.js 22.19 or newer (pi's own requirement).

It loads with the next pi session (or `/reload`) and has no configuration.

## What pi does

Here is a session where one extension adds a section to the system prompt on every user run, and another
starts a run with a custom message when a background task finishes. The model answers that notice with a
tool call, so the custom run has two turns.

| Request | Started by | System block sent (pi 1.0.0 to 1.0.4) | With pi-system-pin |
|---|---|---|---|
| 1 | user prompt | base prompt + section | base prompt + section |
| 2 | custom message, first turn | base prompt + section | base prompt + section |
| 3 | custom message, second turn | base prompt (section removed) | base prompt + section |
| 4 | next user prompt | base prompt + section | base prompt + section |

Before the custom run's second turn, pi prepares the prompt from its base options, which carry none of the
extensions' changes, and appends a system patch to the transcript that removes the section (or puts back the
original text of a built-in section an extension rewrote). The next user prompt runs `before_agent_start`
again and appends a patch that restores it. A model that folds system messages into the head rebuilds the
head from every patch, so requests 3 and 4 each start with different bytes than the request before them.

## How it works

- **Pin.** A system patch with section changes that pi writes while no user run is active is pi falling back
  to its base prompt, not a decision anyone made. A user run starts at `before_agent_start` and is confirmed
  by its own prompt message; it lasts until `agent_settled`. Any other message ends a run that was started
  but not confirmed, so a user prompt that fails after `before_agent_start` cannot exempt the custom run that
  comes next. The pinned patch's key (its timestamp and a hash of its section changes) is recorded in a
  `system-pin.patch` entry on the transcript.
- **Hold.** On every request (pi's `context_with_system` event), the section changes of pinned patches are
  left out. Their tool changes stay, because those are real. A patch left with nothing is left out whole. The
  transcript's own messages are never rewritten.
- **Restore in place.** When the next user run puts the section back, its patch sets the same text the
  request already carries, and pi-ai replaces a section where it stands, so the head stays byte-identical.
- **Release.** At each request of a user run, a held change that no later patch touches is one that run
  agreed with: an extension stopped adding the section, or a context file changed. It is recorded in a
  `system-pin.release` entry and applies from then on. The head is rewritten once, at the moment it really
  changed.

- **Compaction.** At a compaction pi stores the current system state, every system message replayed, on the
  compaction entry, and that becomes the leading system message of every later request. A change still held
  at that moment is folded into it. pi-system-pin rebuilds that head the same way from the original system
  messages, which stay on the branch, leaving the held changes out. It does so only when replaying the branch
  gives exactly pi's own folded head; otherwise it leaves the head as pi built it. Release works as above: a
  user run that leaves a folded section alone releases it.

Both entry types live on the transcript, so a reopened session sends the same requests as before.

## Costs and limits

- **It reads pi internals** that are not a stable API: the system patch shape (`sections`, `toolsAdded`,
  `toolsRemoved`), the `context_with_system` event and the run lifecycle events. Each pi release line is
  verified before it is listed (see [pi versions](#pi-versions)).
- **Per request**, nothing while nothing is pinned. Once a patch is pinned, one pass over the messages and a
  SHA-256 hash of each system patch's sections, plus one pass over the branch's entries once a compaction is on
  the branch. **Per pin or release**, one small custom entry on the transcript. No network calls and no model
  calls; the only file it reads is its own `pi-compat.json`, once at load.
- **A change a custom-message run makes on purpose waits** for the next user run. On pi 1.0.0 to 1.0.4 no
  extension can make one, since custom runs never reach `before_agent_start`.
- **The first run of a session**, when a custom message starts it before any user prompt, is sent by pi 1.0.4
  with no system prompt at all. pi-system-pin keeps that run's head as it started; the head changes once, at
  the first user prompt.
- **Patches written before you installed it are not pinned.** The head is stable from the first pinned patch on.
- **Compaction is tested with pi's own compaction** on a fake model, with the pinned patch both kept in the
  recent window and summarized. pi 1.0.4 stores the system state on every compaction entry, including one an
  extension's compactor made, so those take the same path, but only pi's own compaction is tested.
- **The tests use a fake model.** They prove that the request pi hands the provider keeps the same system
  block; they do not measure any provider's cache.

## When pi fixes pi#5581

As of 2026-10-07, pi#5581 is open, labelled `bug` and `inprogress`. Once pi runs `before_agent_start` (or an
equivalent preparation step) for runs started by custom messages, the fallback patches stop and pi-system-pin
has nothing left to do.

**How the fix is detected.** Two tests, named `control:` in [src/session.test.ts](https://github.com/lobo235/pi-system-pin/blob/main/src/session.test.ts), run a
real pi session **without** pi-system-pin and assert that pi still has the flaw: one checks that a custom run
drops a section an extension added, the other that it reverts a built-in section an extension rewrote. The
real-pi smoke (`npm run smoke`) makes the same check with the pi binary, with folded and with mid-conversation
system messages. A nightly job runs them against the newest pi. When any of these control checks fails, it
opens an issue saying pi has fixed the flaw, and it never records that pi as verified. GitHub pauses scheduled
workflows in a repository with no activity for 60 days; check pi#5581 yourself if the last nightly run is old.

**What happens to this package then.** A final release whose `pi-compat.json` stops at the last pi line that
has the flaw, then `npm deprecate` with a message naming the pi version that fixed it. There is no date; it
follows pi.

**What you do.** Once you run that pi version or newer, uninstall it:

```bash
pi remove npm:pi-system-pin
```

Leaving it installed on a fixed pi is not useful and has one cost: it does not treat a custom-message run as a
user run, so a section change an extension makes on purpose during such a run is held until the next user
run. After you remove it, a session that has pinned patches may rebuild its head once, on its next request,
from the transcript's own system messages. Its `system-pin.*` entries stay in the transcript and pi ignores them.

## Transcript entries

pi-system-pin writes two custom entry types. Code that reads, filters or rewrites pi transcripts (a
compactor, an exporter, a fork tool) must keep both, or a reopened session holds back nothing and its head
changes as it would without pi-system-pin.

| `customType` | `data` | Meaning |
|---|---|---|
| `system-pin.patch` | `{ "key": "<timestamp>:<16 hex digits>" }` | A system patch pi wrote outside a user run; its section changes are held back. |
| `system-pin.release` | `{ "key": "<patch key>#<section name>" }` | A held section change a user run agreed with; it applies from then on. |

The key is the patch message's `timestamp` and the first 16 hex digits of the SHA-256 of
`JSON.stringify(sections)`.

## Configuration

None: no settings, no environment variables, no files. To turn it off, uninstall it
(`pi remove npm:pi-system-pin`).

## pi versions

pi-system-pin relies on parts of pi that are not a stable API, so each pi release line it supports is verified
and listed in [pi-compat.json](pi-compat.json). On a listed line (same major and minor version) it runs
silently. On any other pi it warns once per session and keeps running. A nightly job tests against the newest
pi, including both control tests and the real-pi smoke, and opens an issue when anything fails.

## Known issues

- **Another extension that also returns messages from `context_with_system`** runs before or after this one by
  load order. pi-system-pin only removes section changes from patches it pinned and leaves everything else as
  it receives it.

## Versioning

pi-system-pin follows [Semantic Versioning](https://semver.org). The contract is:

- the custom entry types `system-pin.patch` and `system-pin.release`, their `data` and the key format,
  including that pins in an older transcript are still honoured;
- that it never rewrites the transcript, and that a request only ever loses held section changes: from the
  patch messages and, after a compaction, from the leading system message pi folded them into.

Removing or renaming any of these, or changing what it means, is a major version. The warning text is not part
of the contract. Dropping support for an old pi line is a minor version. Changes are listed in
[CHANGELOG.md](CHANGELOG.md).

## More

[CONTRIBUTING.md](https://github.com/lobo235/pi-system-pin/blob/main/CONTRIBUTING.md), [SECURITY.md](https://github.com/lobo235/pi-system-pin/blob/main/SECURITY.md), [CODE_OF_CONDUCT.md](https://github.com/lobo235/pi-system-pin/blob/main/CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
