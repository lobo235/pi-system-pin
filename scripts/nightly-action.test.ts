import assert from "node:assert/strict";
import { test } from "node:test";

import { nightlyAction } from "./nightly-action.ts";

test("nightlyAction: what the nightly job does with a run's outcome (table)", () => {
  const cases: Array<[string, Parameters<typeof nightlyAction>[0], ReturnType<typeof nightlyAction>]> = [
    ["the newest pi is already verified: nothing ran", { version: "1.0.4", status: "exact", suite: "skipped", control: "skipped" }, "none"],
    ["npm could not be asked: nothing ran", { version: "", status: "", suite: "skipped", control: "skipped" }, "none"],
    ["a new line passes and pi still has the flaw: record it", { version: "1.1.0", status: "unverified", suite: "success", control: "success" }, "record"],
    ["a patch on a verified line passes: nothing to record", { version: "1.0.5", status: "line", suite: "success", control: "success" }, "none"],
    ["a control test fails: retire, never record", { version: "1.1.0", status: "unverified", suite: "success", control: "failure" }, "retire"],
    ["a control test fails and the suite too: retire", { version: "1.1.0", status: "unverified", suite: "failure", control: "failure" }, "retire"],
    ["a control test fails on a verified line: retire", { version: "1.0.5", status: "line", suite: "success", control: "failure" }, "retire"],
    ["the suite fails, pi still has the flaw: a failure issue", { version: "1.1.0", status: "unverified", suite: "failure", control: "success" }, "fail"],
    ["the control step did not run: a failure issue, never record", { version: "1.1.0", status: "unverified", suite: "success", control: "skipped" }, "fail"],
    ["the suite was cancelled: a failure issue", { version: "1.1.0", status: "unverified", suite: "cancelled", control: "success" }, "fail"],
  ];
  for (const [name, outcome, expected] of cases) assert.equal(nightlyAction(outcome), expected, name);
});
