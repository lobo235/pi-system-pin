import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

import { patchKey, type SystemPatch } from "./patch.ts";
import { pinRequest } from "./request.ts";

const head: SystemPatch = { role: "system", content: "", sections: { shell: "S" }, timestamp: 1 };
const deletion: SystemPatch = { role: "system", content: "", sections: { shell: null }, timestamp: 3 };
const folded = { role: "system", content: "", timestamp: 100 };
const user = (timestamp: number) => ({ role: "user", content: "hi", timestamp });
const asMessages = (list: unknown[]) => list as AgentMessage[];
const pinned = { patches: new Set([patchKey(deletion)]), released: new Set<string>() };
const entries = [{ type: "message", message: head }, { type: "message", message: deletion }, { type: "compaction", systemMessage: folded }];
const branch = () => entries;
const noBranch = () => [];

test("pinRequest: what a request sends and releases (table)", () => {
  const cases: Array<[string, unknown[], () => readonly unknown[], boolean, unknown[] | undefined, string[]]> = [
    ["nothing held: pi's request as it is", [head, user(2)], noBranch, false, undefined, []],
    ["a held patch is left out", [head, user(2), deletion], noBranch, false, [head, user(2)], []],
    ["a user run releases a held patch it left alone", [head, deletion, user(4)], noBranch, true, undefined, [`${patchKey(deletion)}#shell`]],
    ["a folded held change is undone in the head", [folded, user(101)], branch, false, [{ ...folded, sections: { shell: "S" } }, user(101)], []],
    ["a user run releases a folded change it left alone", [folded, user(101)], branch, true, undefined, [`${patchKey(deletion)}#shell`]],
    ["an empty request", [], branch, true, undefined, []],
  ];
  for (const [name, messages, onBranch, inUserRun, expected, released] of cases) {
    const outcome = pinRequest(asMessages(messages), onBranch, pinned, inUserRun);
    assert.deepEqual(outcome.messages, expected, name);
    assert.deepEqual(outcome.released, released, name);
  }
});

test("pinRequest: with nothing pinned, the branch is never read (no per-request walk for sessions that need no pin)", () => {
  const unread = () => {
    throw new Error("the branch was read");
  };
  const nothing = { patches: new Set<string>(), released: new Set<string>() };
  for (const inUserRun of [false, true]) {
    assert.deepEqual(pinRequest(asMessages([folded, user(101)]), unread, nothing, inUserRun), { messages: undefined, released: [] });
  }
});

test("pinRequest: the branch is read once per request, in a user run too", () => {
  let reads = 0;
  const counted = () => {
    reads += 1;
    return entries;
  };
  pinRequest(asMessages([folded, user(101)]), counted, pinned, true);
  assert.equal(reads, 1);
});
