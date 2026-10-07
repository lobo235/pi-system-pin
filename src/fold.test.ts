/**
 * Pinned changes pi folded into a compaction's leading system message, on hand-built branches. The end-to-end
 * proof with pi's own compaction is session.test.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

import { foldedHold, releasableFolded } from "./fold.ts";
import { patchKey, type SystemPatch } from "./patch.ts";
import type { Pins } from "./pin.ts";

const head: SystemPatch = { role: "system", content: "base", sections: { base: "B", shell: "S" }, timestamp: 1 };
const patch = (timestamp: number, sections: Record<string, string | null>): SystemPatch => ({ role: "system", content: "", sections, timestamp });
const entry = (message: unknown) => ({ type: "message", message });
const compaction = (sections: Record<string, string>, timestamp = 100) => ({ type: "compaction", systemMessage: { role: "system", content: "base", sections, timestamp } });
const leading = (sections: Record<string, string>, timestamp = 100) => ({ role: "system", content: "base", sections, timestamp }) as unknown as AgentMessage;
const pins = (keys: string[], released: string[] = []): Pins => ({ patches: new Set(keys), released: new Set(released) });
const user = (timestamp: number) => ({ role: "user", content: "hi", timestamp }) as unknown as AgentMessage;

test("foldedHold: a pinned deletion folded into the compaction's head is undone there, in its original place", () => {
  const deletion = patch(3, { shell: null });
  const branch = [entry(head), entry(user(2)), entry(deletion), compaction({ base: "B" })];
  const hold = foldedHold(branch, leading({ base: "B" }), pins([patchKey(deletion)]));
  assert.deepEqual(hold?.head, { ...leading({ base: "B" }), sections: { base: "B", shell: "S" } });
  assert.deepEqual(Object.keys((hold?.head as unknown as SystemPatch).sections ?? {}), ["base", "shell"]);
  assert.deepEqual(hold?.held, [{ key: patchKey(deletion), sections: ["shell"] }]);
});

test("foldedHold: a pinned rewrite is undone, other folded changes stay", () => {
  const rewrite = patch(3, { base: "B-base-options" });
  const real = patch(4, { extra: "E" });
  const branch = [entry(head), entry(rewrite), entry(real), compaction({ base: "B-base-options", shell: "S", extra: "E" })];
  const hold = foldedHold(branch, leading({ base: "B-base-options", shell: "S", extra: "E" }), pins([patchKey(rewrite)]));
  assert.deepEqual((hold?.head as unknown as SystemPatch).sections, { base: "B", shell: "S", extra: "E" });
});

test("foldedHold: nothing to undo (table)", () => {
  const deletion = patch(3, { shell: null });
  const folded = compaction({ base: "B" });
  const cases: Array<[string, unknown[], AgentMessage, Pins]> = [
    ["no compaction on the branch", [entry(head), entry(deletion)], leading({ base: "B" }, 1), pins([patchKey(deletion)])],
    ["nothing pinned", [entry(head), entry(deletion), folded], leading({ base: "B" }), pins([])],
    ["the pinned change was released", [entry(head), entry(deletion), folded], leading({ base: "B" }), pins([patchKey(deletion)], [`${patchKey(deletion)}#shell`])],
    ["the pin comes after the compaction", [entry(head), folded, entry(deletion)], leading({ base: "B" }), pins([patchKey(deletion)])],
    ["the request's head is not the compaction's", [entry(head), entry(deletion), folded], leading({ base: "B" }, 99), pins([patchKey(deletion)])],
    ["the head is not a system message", [entry(head), entry(deletion), folded], user(100), pins([patchKey(deletion)])],
    ["the compaction kept no system message", [entry(head), entry(deletion), { type: "compaction" }], leading({ base: "B" }), pins([patchKey(deletion)])],
  ];
  for (const [name, branch, given, pinned] of cases) assert.equal(foldedHold(branch, given, pinned), undefined, name);
});

test("foldedHold: stands down when replaying the branch does not give pi's own folded head (pi changed how it folds)", () => {
  const deletion = patch(3, { shell: null });
  const branch = [entry(head), entry(deletion), compaction({ base: "B", surprise: "X" })];
  assert.equal(foldedHold(branch, leading({ base: "B", surprise: "X" }), pins([patchKey(deletion)])), undefined);
});

test("foldedHold: uses the latest compaction, and the pins folded into an earlier one stay undone", () => {
  const deletion = patch(3, { shell: null });
  const branch = [entry(head), entry(deletion), compaction({ base: "B" }, 50), entry(user(60)), compaction({ base: "B" }, 100)];
  assert.deepEqual((foldedHold(branch, leading({ base: "B" }), pins([patchKey(deletion)]))?.head as unknown as SystemPatch).sections, { base: "B", shell: "S" });
});

test("foldedHold: ignores malformed entries (transcript bytes are untrusted)", () => {
  const deletion = patch(3, { shell: null });
  const branch = [null, "x", { type: "message" }, entry(null), entry(head), entry(deletion), compaction({ base: "B" })];
  assert.ok(foldedHold(branch, leading({ base: "B" }), pins([patchKey(deletion)])));
});

test("releasableFolded: a folded held section no later system message in the request touches", () => {
  const held = [{ key: "3:k", sections: ["shell", "base"] }];
  const messages = [leading({ base: "B" }), user(101), patch(102, { base: "B" }) as unknown as AgentMessage, user(103)];
  assert.deepEqual(releasableFolded(messages, held), ["3:k#shell"]);
  assert.deepEqual(releasableFolded([leading({ base: "B" })], []), []);
});
