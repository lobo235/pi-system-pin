/**
 * The pi-version record (pi-compat.json) and the checks against it. The first test pins the pi this tree
 * VENDORS (an exact devDependency) to a verified release line; the nightly job skips it by name when it
 * tests a newer pi.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import * as pi from "@earendil-works/pi-coding-agent";

import { PI_COMPAT_PATH, piVersionStatus, readPiCompat, unverifiedPiVersionNotice, withVerification, type PiVerification } from "./pi-compat.ts";

const PKG = new URL("../node_modules/@earendil-works/pi-coding-agent/", import.meta.url);
const vendoredVersion = (JSON.parse(readFileSync(new URL("package.json", PKG), "utf8")) as { version: string }).version;
const record = (...versions: string[]) => ({ verified: versions.map((version) => ({ pi: version, date: "2026-10-01", how: ["a", "b"] })) });

test("pi-compat: the vendored pi is on a release line this extension was verified against", () => {
  const compat = readPiCompat();
  assert.notEqual(
    piVersionStatus(vendoredVersion, compat),
    "unverified",
    `pi ${vendoredVersion} is not in ${PI_COMPAT_PATH} (verified: ${compat.verified.map((entry) => entry.pi).join(", ")}). Follow CONTRIBUTING.md (Verifying a new pi version) and record it.`,
  );
  assert.equal(pi.VERSION, vendoredVersion);
  for (const entry of compat.verified) {
    assert.match(entry.pi, /^\d+\.\d+\.\d+$/);
    assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(entry.how.length >= 2, "how must list the steps that were run");
  }
});

test("pi-compat: the pi-ai and pi-agent-core the tests import are the vendored pi's own versions", () => {
  // pi publishes its packages in lockstep. Another version fails the typecheck (two AgentMessage types) and can put
  // the session tests' faux model in a pi-ai copy pi does not run, so the nightly installs all three together.
  for (const name of ["pi-ai", "pi-agent-core"]) {
    const manifest = new URL(`../node_modules/@earendil-works/${name}/package.json`, import.meta.url);
    const version = (JSON.parse(readFileSync(manifest, "utf8")) as { version: string }).version;
    assert.equal(version, vendoredVersion, `@earendil-works/${name} ${version} is not pi ${vendoredVersion}'s; install them at the same version`);
  }
});

test("piVersionStatus: exact, the same major.minor line, or unverified (table)", () => {
  const compat = record("1.0.4", "0.99.1");
  for (const [version, expected] of [
    ["1.0.4", "exact"],
    ["1.0.5", "line"],
    ["1.0.0", "line"],
    ["1.0.6-rc.1", "line"],
    ["0.99.7", "line"],
    ["1.1.0", "unverified"],
    ["2.0.4", "unverified"],
    ["0.98.0", "unverified"],
    ["not-a-version", "unverified"],
    ["", "unverified"],
  ] as const) assert.equal(piVersionStatus(version, compat), expected, version);
});

test("unverifiedPiVersionNotice: silent on a verified line; otherwise names the extension, both versions and that it still runs", () => {
  const compat = record("1.0.4");
  assert.equal(unverifiedPiVersionNotice("1.0.4", compat), null);
  assert.equal(unverifiedPiVersionNotice("1.0.9", compat), null);
  const notice = unverifiedPiVersionNotice("1.1.0", compat) ?? "";
  assert.match(notice, /^pi-system-pin: pi 1\.1\.0 has not been verified/);
  assert.match(notice, /verified: 1\.0\.4/);
  assert.match(notice, /It still runs/);
  assert.match(unverifiedPiVersionNotice("1.1.0", { verified: [] }) ?? "", /verified: \(none\)/);
});

test("readPiCompat: refuses a missing file and a record without a verified list, naming the file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "system-pin-compat-"));
  try {
    const empty = path.join(dir, "pi-compat.json");
    writeFileSync(empty, "{}");
    assert.throws(() => readPiCompat(empty), (error: Error) => error.message.includes(empty) && /verified/.test(error.message));
    assert.throws(() => readPiCompat(path.join(dir, "absent.json")), /absent\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("withVerification: appends a version with its date and steps and keeps the earlier entries", () => {
  const compat = record("1.0.4");
  const next = withVerification(compat, { pi: "1.1.0", date: "2026-11-02", how: ["npm test", "npm run smoke"] });
  assert.deepEqual(next.verified.map((entry) => entry.pi), ["1.0.4", "1.1.0"]);
  assert.equal(compat.verified.length, 1, "the input is not modified");
});

test("withVerification: refuses a listed version, a malformed version or date, and fewer than two steps (table)", () => {
  const compat = record("1.0.4");
  const cases: Array<[string, PiVerification, RegExp]> = [
    ["already listed", { pi: "1.0.4", date: "2026-11-02", how: ["a", "b"] }, /already/],
    ["not a version", { pi: "latest", date: "2026-11-02", how: ["a", "b"] }, /version/],
    ["shell text in the version", { pi: "1.1.0; rm -rf x", date: "2026-11-02", how: ["a", "b"] }, /version/],
    ["bad date", { pi: "1.1.0", date: "Nov 2", how: ["a", "b"] }, /date/],
    ["one step", { pi: "1.1.0", date: "2026-11-02", how: ["a"] }, /how/],
  ];
  for (const [name, entry, message] of cases) assert.throws(() => withVerification(compat, entry), message, name);
});
