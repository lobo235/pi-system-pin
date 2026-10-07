/**
 * What the nightly job does after testing the newest pi: `node scripts/nightly-action.ts <version> <status>
 * <suite outcome> <control outcome>` prints one of:
 *
 * - `retire`: a control test failed, so pi no longer has the flaw; open the retire issue and never record the version;
 * - `record`: a new release line passed AND both control tests still show the flaw; open the record pull request;
 * - `fail`: something else failed; open a failure issue;
 * - `none`: nothing ran, or a version on a verified line passed.
 *
 * Outcomes are GitHub step outcomes: success, failure, cancelled or skipped.
 */
import { fileURLToPath } from "node:url";

export interface NightlyOutcome {
  version: string;
  status: string;
  suite: string;
  control: string;
}

export type NightlyAction = "retire" | "record" | "fail" | "none";

export function nightlyAction(outcome: NightlyOutcome): NightlyAction {
  if (outcome.version === "" || outcome.status === "exact") return "none";
  if (outcome.control === "failure") return "retire";
  if (outcome.suite !== "success" || outcome.control !== "success") return "fail";
  return outcome.status === "unverified" ? "record" : "none";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [version = "", status = "", suite = "", control = ""] = process.argv.slice(2);
  console.log(nightlyAction({ version, status, suite, control }));
}
