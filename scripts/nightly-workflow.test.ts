/**
 * The nightly workflow's reporting contract, checked against its text: what feeds the retire signal and how
 * the record pull request is guarded. The decision itself is nightly-action.ts.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

const workflow = fs.readFileSync(path.join(import.meta.dirname, "..", ".github", "workflows", "nightly-pi.yml"), "utf8");

/** The `run:` block of the step or job section that starts at `marker`, up to the next step or job. */
function sectionAfter(marker: string): string {
  const start = workflow.indexOf(marker);
  assert.ok(start >= 0, `no ${JSON.stringify(marker)} in nightly-pi.yml`);
  const rest = workflow.slice(start + marker.length);
  const end = rest.search(/\n {6}- (name|uses):|\n {2}[a-z-]+:\n/);
  return end < 0 ? rest : rest.slice(0, end);
}

test("nightly: the control step runs the binary smoke's control too, so a flaw only the binary sees retires", () => {
  const control = sectionAfter("id: control");
  assert.match(control, /--test-name-pattern="\^control:"/);
  assert.match(control, /scripts\/pi-smoke\.ts --control-only/);
});

test("nightly: the record job is guarded on an open pull request, not on the branch alone", () => {
  const record = sectionAfter("Open a pull request recording it");
  assert.match(record, /gh pr list --head "\$branch" --state open/);
});

test("nightly: a pull request the workflow token may not open fails the job, naming the setting", () => {
  const record = sectionAfter("Open a pull request recording it");
  assert.match(record, /if ! gh pr create/);
  assert.match(record, /Allow GitHub Actions to create and approve pull requests/);
});
