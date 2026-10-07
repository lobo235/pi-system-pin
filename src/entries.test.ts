import assert from "node:assert/strict";
import { test } from "node:test";

import { PATCH_ENTRY, RELEASE_ENTRY, readPins } from "./entries.ts";

const custom = (customType: string, data: unknown) => ({ type: "custom", customType, data });

test("entry types: the persisted names are part of the SemVer contract and never change", () => {
  assert.equal(PATCH_ENTRY, "system-pin.patch");
  assert.equal(RELEASE_ENTRY, "system-pin.release");
});

test("readPins: patch and release entries become the pins, in any order", () => {
  const pins = readPins([custom(RELEASE_ENTRY, { key: "3:abc#shell" }), custom(PATCH_ENTRY, { key: "3:abc" })]);
  assert.deepEqual([...pins.patches], ["3:abc"]);
  assert.deepEqual([...pins.released], ["3:abc#shell"]);
});

test("readPins: anything that is not one of its own well-formed entries is ignored (table)", () => {
  const cases: Array<[string, unknown]> = [
    ["a message entry", { type: "message", message: { role: "user" } }],
    ["another extension's entry", custom("other.patch", { key: "3:abc" })],
    ["no data", custom(PATCH_ENTRY, undefined)],
    ["null data", custom(PATCH_ENTRY, null)],
    ["a string as data", custom(PATCH_ENTRY, "3:abc")],
    ["a numeric key", custom(PATCH_ENTRY, { key: 3 })],
    ["an empty key", custom(RELEASE_ENTRY, { key: "" })],
    ["a null entry", null],
  ];
  for (const [name, entry] of cases) {
    const pins = readPins([entry]);
    assert.equal(pins.patches.size + pins.released.size, 0, name);
  }
});
