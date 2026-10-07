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
  assert.match(record, /gh pr list --head "\$BRANCH" --state open/);
});

test("nightly: a pull request the workflow token may not open fails the job, naming the setting", () => {
  const record = sectionAfter("Open a pull request recording it");
  assert.match(record, /if ! gh pr create/);
  assert.match(record, /Allow GitHub Actions to create and approve pull requests/);
});

interface Job {
  name: string;
  header: string;
  steps: string[];
}

/** The workflow's jobs, each split into its header (everything before `steps:`) and its steps' text. */
function jobs(): Job[] {
  const body = workflow.slice(workflow.indexOf("\njobs:\n"));
  return body.split(/\n {2}(?=[a-z-]+:\n)/).slice(1).map((text) => {
    const stepsAt = text.indexOf("\n    steps:\n");
    return { name: text.slice(0, text.indexOf(":")), header: text.slice(0, stepsAt), steps: text.slice(stepsAt).split(/\n {6}- /).slice(1) };
  });
}

const TOKEN = /github\.token|secrets\./;
const stepName = (step: string) => /^name: (.+)$/m.exec(step)?.[1] ?? step.split("\n")[0];

test("nightly: a write token reaches only the two reporting steps, never a job's env or a step that runs code", () => {
  const all = jobs();
  assert.deepEqual(all.map((job) => job.name), ["test", "record", "report-failure"]);
  for (const job of all) assert.doesNotMatch(job.header, TOKEN, `${job.name}: a token in the job's env reaches every step`);
  const withToken = all.flatMap((job) => job.steps.filter((step) => TOKEN.test(step)).map(stepName));
  assert.deepEqual(withToken, ["Open a pull request recording it", "Open an issue unless one is open"]);
  for (const step of all.flatMap((job) => job.steps).filter((step) => TOKEN.test(step))) {
    // A command at the start of a line or after ;, &, | or $( -- not the words inside an issue body.
    assert.doesNotMatch(step, /(^|[;&|(])\s*(npm|npx|node)\s/m, `${stepName(step)} holds the token and must run no package code`);
  }
});

test("nightly: no checkout leaves credentials in git config", () => {
  const checkouts = jobs().flatMap((job) => job.steps).filter((step) => step.startsWith("uses: actions/checkout@"));
  assert.ok(checkouts.length >= 2);
  for (const step of checkouts) assert.match(step, /persist-credentials: false/);
});
