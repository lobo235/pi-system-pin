/**
 * The request transform and the release rule, on hand-built transcripts. The end-to-end proof through a
 * real pi session is session.test.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

import { patchKey, type SystemPatch } from "./patch.ts";
import { pinnedRequest, releasableChanges, type Pins } from "./pin.ts";

const head: SystemPatch = { role: "system", content: "", sections: { base: "B", shell: "S" }, timestamp: 1 };
const user = (timestamp: number) => ({ role: "user", content: "hi", timestamp });
const patch = (timestamp: number, sections: Record<string, string | null>, extra: Partial<SystemPatch> = {}): SystemPatch => ({
  role: "system",
  content: "",
  sections,
  ...extra,
  timestamp,
});
const asMessages = (list: unknown[]) => list as AgentMessage[];
const pins = (keys: string[], released: string[] = []): Pins => ({ patches: new Set(keys), released: new Set(released) });

test("pinnedRequest: nothing pinned leaves the request as the transcript (the same array)", () => {
  const messages = asMessages([head, user(2), patch(3, { shell: null })]);
  assert.equal(pinnedRequest(messages, pins([])), messages);
});

test("pinnedRequest: a pinned deletion is dropped from the request, and the emptied patch with it", () => {
  const deletion = patch(3, { shell: null });
  const messages = asMessages([head, user(2), deletion]);
  assert.deepEqual(pinnedRequest(messages, pins([patchKey(deletion)])), [head, user(2)]);
});

test("pinnedRequest: a pinned section SET is held too (the base options can rewrite a section, not only drop it)", () => {
  const rewrite = patch(3, { base: "B-from-base-options" });
  const messages = asMessages([head, user(2), rewrite]);
  assert.deepEqual(pinnedRequest(messages, pins([patchKey(rewrite)])), [head, user(2)]);
});

test("pinnedRequest: only the section changes go; the patch's tool changes stay", () => {
  const mixed = patch(3, { shell: null, base: "B2" }, { toolsAdded: ["noop"] });
  const [, , kept] = pinnedRequest(asMessages([head, user(2), mixed]), pins([patchKey(mixed)])) as unknown as SystemPatch[];
  assert.deepEqual(kept.sections, {});
  assert.deepEqual(kept.toolsAdded, ["noop"]);
});

test("pinnedRequest: a pinned patch keeps what it carries besides held sections (table)", () => {
  const cases: Array<[string, Partial<SystemPatch>, boolean]> = [
    ["instruction text", { content: "extra rule" }, true],
    ["instruction blocks", { content: [{ type: "text", text: "extra rule" }] }, true],
    ["an empty block list", { content: [] }, false],
    ["no content field", { content: undefined }, false],
    ["a removed tool", { toolsRemoved: [{ name: "noop" }] }, true],
    ["an empty tool list", { toolsAdded: [] }, false],
  ];
  for (const [name, extra, survives] of cases) {
    const pinned = patch(3, { shell: null }, extra);
    const request = pinnedRequest(asMessages([head, user(2), pinned]), pins([patchKey(pinned)]));
    assert.equal(request.length, survives ? 3 : 2, name);
  }
});

test("pinnedRequest: a section another key released applies, the rest of the patch stays held", () => {
  const deletion = patch(3, { shell: null, base: "B2" });
  const key = patchKey(deletion);
  const [, , kept] = pinnedRequest(asMessages([head, user(2), deletion]), pins([key], [`${key}#shell`])) as unknown as SystemPatch[];
  assert.deepEqual(kept.sections, { shell: null });
});

test("pinnedRequest: a released deletion applies (a user run that did not restore the section really removed it)", () => {
  const deletion = patch(3, { shell: null });
  const key = patchKey(deletion);
  const messages = asMessages([head, user(2), deletion, user(4)]);
  assert.equal(pinnedRequest(messages, pins([key], [`${key}#shell`])), messages);
});

test("pinnedRequest: the leading system message is never touched, even when its key is pinned", () => {
  const messages = asMessages([head, user(2)]);
  assert.equal(pinnedRequest(messages, pins([patchKey(head)])), messages);
});

test("pinnedRequest: an unpinned patch beside a pinned one is left alone", () => {
  const pinned = patch(3, { shell: null });
  const other = patch(5, { shell: "S" });
  const messages = asMessages([head, user(2), pinned, user(4), other]);
  assert.deepEqual(pinnedRequest(messages, pins([patchKey(pinned)])), [head, user(2), user(4), other]);
});

test("releasableChanges: a pinned deletion no later patch restores", () => {
  const deletion = patch(3, { shell: null });
  const key = patchKey(deletion);
  assert.deepEqual(releasableChanges(asMessages([head, deletion, user(4)]), pins([key])), [`${key}#shell`]);
});

test("releasableChanges: a pinned set no later patch touches (the user run agreed with it)", () => {
  const rewrite = patch(3, { base: "B2" });
  const key = patchKey(rewrite);
  assert.deepEqual(releasableChanges(asMessages([head, rewrite, user(4)]), pins([key])), [`${key}#base`]);
});

test("releasableChanges: none when a later patch touches the section, or it is already released (table)", () => {
  const deletion = patch(3, { shell: null });
  const rewrite = patch(3, { base: "B2" });
  const cases: Array<[string, unknown[], Pins]> = [
    ["a later patch restores a deletion", [head, deletion, user(4), patch(5, { shell: "S" })], pins([patchKey(deletion)])],
    ["a later patch reverts a rewrite", [head, rewrite, user(4), patch(5, { base: "B" })], pins([patchKey(rewrite)])],
    ["already released", [head, deletion], pins([patchKey(deletion)], [`${patchKey(deletion)}#shell`])],
    ["nothing pinned", [head, deletion], pins([])],
  ];
  for (const [name, messages, given] of cases) assert.deepEqual(releasableChanges(asMessages(messages), given), [], name);
});

test("releasableChanges: of one patch, only the sections no later patch touches", () => {
  const both = patch(3, { shell: null, base: "B2" });
  const key = patchKey(both);
  const messages = asMessages([head, both, user(4), patch(5, { shell: "S" })]);
  assert.deepEqual(releasableChanges(messages, pins([key])), [`${key}#base`]);
});

test("patchKey: two patches written in the same millisecond differ; the same patch keys the same", () => {
  assert.notEqual(patchKey(patch(3, { a: null })), patchKey(patch(3, { b: null })));
  assert.equal(patchKey(patch(3, { a: null })), patchKey(patch(3, { a: null }, { toolsAdded: ["noop"] })));
  assert.match(patchKey(patch(3, { a: null })), /^3:[0-9a-f]{16}$/);
});

test("a system message without a sections field: keyed like an empty change, never held, never released", () => {
  const instructions = { role: "system", content: "extra rule", timestamp: 3 } as SystemPatch;
  assert.equal(patchKey(instructions), patchKey(patch(3, {})));
  const messages = asMessages([head, user(2), instructions]);
  const given = pins([patchKey(instructions)]);
  assert.equal(pinnedRequest(messages, given), messages);
  assert.deepEqual(releasableChanges(messages, given), []);
});

test("releasableChanges: a later system message without sections does not count as touching the section", () => {
  const deletion = patch(3, { shell: null });
  const key = patchKey(deletion);
  const later = { role: "system", content: "extra rule", timestamp: 5 };
  assert.deepEqual(releasableChanges(asMessages([head, deletion, user(4), later]), pins([key])), [`${key}#shell`]);
});
