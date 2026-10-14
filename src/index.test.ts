/**
 * The wiring, on pi's event order with an in-memory pi: which patches are pinned, when held changes are
 * released, and the pi-version notice. The end-to-end proof through a real pi session is session.test.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { PATCH_ENTRY, RELEASE_ENTRY } from "./entries.ts";
import { createSystemPin } from "./index.ts";
import { patchKey, type SystemPatch } from "./patch.ts";
import { fakePi } from "./test-support.ts";

const VERIFIED = { verified: [{ pi: "1.0.4", date: "2026-10-07", how: ["a", "b"] }] };
const head: SystemPatch = { role: "system", content: "", sections: { shell: "S" }, timestamp: 1 };
const user = (timestamp: number) => ({ role: "user", content: "hi", timestamp });
const assistant = (timestamp: number) => ({ role: "assistant", content: [], timestamp });
const custom = (timestamp: number) => ({ role: "custom", customType: "notice", content: "task finished", timestamp });
const patch = (timestamp: number, sections: Record<string, string | null>, extra: Partial<SystemPatch> = {}): SystemPatch => ({ role: "system", content: "", sections, ...extra, timestamp });

function started(piVersion = "1.0.4") {
  const pi = fakePi(createSystemPin({ piVersion, compat: VERIFIED }));
  pi.emit("session_start", { reason: "startup" });
  return pi;
}
const pinned = (pi: ReturnType<typeof started>) => pi.entries.filter((entry) => entry.customType === PATCH_ENTRY).map((entry) => entry.data);
const released = (pi: ReturnType<typeof started>) => pi.entries.filter((entry) => entry.customType === RELEASE_ENTRY).map((entry) => entry.data);

test("a section patch written by a custom-message run is pinned, once", () => {
  const pi = started();
  const deletion = patch(4, { shell: null });
  pi.end(custom(2));
  pi.end(assistant(3));
  pi.end(deletion);
  pi.end(deletion);
  assert.deepEqual(pinned(pi), [{ key: patchKey(deletion) }]);
});

test("a patch with no section change (tools only) is never pinned", () => {
  const pi = started();
  pi.end(custom(2));
  pi.end(patch(3, {}, { toolsAdded: [{ name: "noop" }] }));
  pi.end({ role: "system", content: "", toolsRemoved: [{ name: "noop" }], timestamp: 4 });
  assert.deepEqual(pinned(pi), []);
});

test("a user run's own patches are never pinned, before or after its prompt message, on every turn", () => {
  const pi = started();
  pi.emit("before_agent_start");
  pi.end(patch(2, { shell: "S" }));
  pi.end(user(3));
  pi.end(assistant(4));
  pi.end(patch(5, { shell: "S2" }));
  pi.end({ role: "toolResult", content: [], timestamp: 6 });
  pi.end(patch(7, { shell: "S3" }));
  pi.emit("agent_settled");
  assert.deepEqual(pinned(pi), []);
});

test("a user prompt that fails after before_agent_start (no run, no agent_settled) does not exempt the next custom run", () => {
  const pi = started();
  pi.emit("before_agent_start");
  pi.end(custom(2));
  pi.end(assistant(3));
  pi.end(patch(4, { shell: null }));
  assert.equal(pinned(pi).length, 1, "the custom run's fallback patch is pinned");
});

test("agent_settled ends the user run: the next custom run's patch is pinned", () => {
  const pi = started();
  pi.emit("before_agent_start");
  pi.end(user(2));
  pi.emit("agent_settled");
  pi.end(custom(3));
  pi.end(patch(4, { shell: null }));
  assert.equal(pinned(pi).length, 1);
});

test("context_with_system: nothing held leaves pi's request alone (no result)", () => {
  const pi = started();
  assert.equal(pi.request([head, user(2)]), undefined);
});

test("context_with_system: a pinned change is held back from the request", () => {
  const pi = started();
  const deletion = patch(4, { shell: null });
  pi.end(custom(2));
  pi.end(deletion);
  assert.deepEqual(pi.request([head, custom(2), deletion]), { messages: [head, custom(2)] });
});

test("context_with_system in a user run releases a held change the run agreed with, once, and applies it", () => {
  const pi = started();
  const deletion = patch(4, { shell: null });
  pi.end(custom(2));
  pi.end(deletion);
  pi.emit("before_agent_start");
  pi.end(user(5));
  const messages = [head, custom(2), deletion, user(5)];
  assert.equal(pi.request(messages), undefined, "released, so the deletion applies");
  pi.request(messages);
  assert.deepEqual(released(pi), [{ key: `${patchKey(deletion)}#shell` }]);
});

test("context_with_system outside a user run never releases", () => {
  const pi = started();
  const deletion = patch(4, { shell: null });
  pi.end(custom(2));
  pi.end(deletion);
  pi.request([head, custom(2), deletion]);
  assert.deepEqual(released(pi), []);
});

test("context_with_system in a user run that restores the section releases nothing and keeps the head", () => {
  const pi = started();
  const deletion = patch(4, { shell: null });
  const restore = patch(5, { shell: "S" });
  pi.end(custom(2));
  pi.end(deletion);
  pi.emit("before_agent_start");
  pi.end(restore);
  pi.end(user(6));
  assert.deepEqual(pi.request([head, custom(2), deletion, restore, user(6)]), { messages: [head, custom(2), restore, user(6)] });
  assert.deepEqual(released(pi), []);
});

test("session_start reads the pins back from the transcript, so a reopened session holds the same changes", () => {
  const first = started();
  const deletion = patch(4, { shell: null });
  first.end(custom(2));
  first.end(deletion);
  const reopened = fakePi(createSystemPin({ piVersion: "1.0.4", compat: VERIFIED }));
  reopened.entries.push(...first.entries);
  reopened.emit("session_start", { reason: "resume" });
  assert.deepEqual(reopened.request([head, custom(2), deletion]), { messages: [head, custom(2)] });
});

test("session_start ends a user run left open by the previous session", () => {
  const pi = started();
  pi.emit("before_agent_start");
  pi.end(user(2));
  pi.emit("session_start", { reason: "new" });
  pi.end(custom(3));
  pi.end(patch(4, { shell: null }));
  assert.equal(pinned(pi).length, 1);
});

test("pi version: a verified version or line is silent; any other warns once per session and still runs (table)", () => {
  for (const [version, warnings] of [["1.0.4", 0], ["1.0.9", 0], ["1.1.0", 1], ["0.98.0", 1]] as const) {
    const pi = started(version);
    pi.emit("session_start", { reason: "reload" });
    assert.equal(pi.notices.length, warnings * 2, `${version}: one warning per session start`);
    for (const notice of pi.notices) assert.equal(notice.level, "warning", version);
    pi.end(custom(2));
    pi.end(patch(3, { shell: null }));
    assert.equal(pinned(pi).length, 1, `${version}: still pins`);
  }
});

test("pi version: a notice the UI cannot show never breaks the session", () => {
  const pi = fakePi(createSystemPin({ piVersion: "0.98.0", compat: VERIFIED }));
  pi.breakNotify();
  assert.doesNotThrow(() => pi.emit("session_start", { reason: "startup" }));
  pi.end(custom(2));
  pi.end(patch(3, { shell: null }));
  assert.equal(pinned(pi).length, 1);
});

test("pi 1.2.0 and newer fix pi#5581: one notice per session says to remove the package, and nothing is pinned or held (table)", () => {
  for (const version of ["1.2.0", "1.2.3", "1.10.0", "2.0.0"]) {
    const pi = started(version);
    pi.emit("session_start", { reason: "reload" });
    assert.equal(pi.notices.length, 2, `${version}: one notice per session start`);
    for (const notice of pi.notices) assert.match(notice.text, /pi remove npm:pi-system-pin/, version);
    pi.end(custom(2));
    pi.end(patch(3, { shell: null }));
    assert.equal(pinned(pi).length, 0, `${version}: pins nothing`);
    assert.equal(pi.request([head, user(4), patch(5, { shell: null })]), undefined, `${version}: leaves the request to pi`);
  }
});

/** A branch where a custom run's pinned deletion was folded into a compaction's head (pi does this at a compaction). */
function compactedOverPin() {
  const pi = started();
  const deletion = patch(4, { shell: null });
  pi.end(custom(2));
  pi.end(deletion);
  const folded = { role: "system", content: "", timestamp: 100 };
  pi.entries.unshift({ type: "message", message: head }, { type: "message", message: custom(2) });
  pi.entries.push({ type: "message", message: deletion }, { type: "compaction", systemMessage: folded });
  return { pi, deletion, folded };
}

test("context_with_system after a compaction that folded a held change: the head is rebuilt without it", () => {
  const { pi, folded } = compactedOverPin();
  pi.end(custom(101));
  assert.deepEqual(pi.request([folded, custom(101)]), { messages: [{ ...folded, sections: { shell: "S" } }, custom(101)] });
});

test("context_with_system in a user run after a compaction releases a folded change the run left alone", () => {
  const { pi, deletion, folded } = compactedOverPin();
  pi.emit("before_agent_start");
  pi.end(user(101));
  assert.equal(pi.request([folded, user(101)]), undefined, "released, so pi's own folded head applies");
  assert.deepEqual(released(pi), [{ key: `${patchKey(deletion)}#shell` }]);
});

test("context_with_system in a user run after a compaction keeps the folded change held when the run restores it", () => {
  const { pi, folded } = compactedOverPin();
  const restore = patch(101, { shell: "S" });
  pi.emit("before_agent_start");
  pi.end(restore);
  pi.end(user(102));
  assert.deepEqual(pi.request([folded, restore, user(102)]), { messages: [{ ...folded, sections: { shell: "S" } }, restore, user(102)] });
  assert.deepEqual(released(pi), []);
});
