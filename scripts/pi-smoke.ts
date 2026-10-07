/**
 * Real-pi smoke: the pi binary this tree vendors, in a fresh agent dir and HOME, against a fake
 * OpenAI-compatible model on loopback (scripts/smoke-harness.ts). No network, no key, and nothing of the person
 * running it is read or written.
 *
 * It drives pi over RPC through the scenario pi#5581 is about: a user prompt, a run started by an extension's
 * custom message (two model turns), and a second user prompt. Each scenario runs with the model's
 * mid-conversation system messages off (pi's default for a custom model: every patch is folded into the leading
 * system message) and on (patches go out as later system messages):
 *
 * - control, without system-pin: the custom run's second turn must lose the fixture's section. If it does
 *   not, pi no longer has the flaw and system-pin should be retired (README, When pi fixes pi#5581).
 * - with system-pin, packed with `npm pack` and installed with `pi install` the way a user installs it (no
 *   `-e`): every request's leading system message is byte-identical, no request carries a later system
 *   message that drops the section, and the transcript carries a `system-pin.patch` entry.
 *
 * `--control-only` runs only the control scenarios (the nightly's retire signal). `--keep` leaves the temporary
 * directory for inspection. Exits 1 naming the reason otherwise.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { SMOKE_SECTION_TEXT } from "./smoke-fixture.ts";
import {
  childEnv, countPins, installPackage, packPackage, repo, RpcPi, startFakeModel, writeAgentDir,
  type Reply, type SeenRequest,
} from "./smoke-harness.ts";

/** The model's answers in request order: user run; custom run (a tool call, then text); second user run. */
const REPLIES: Reply[] = [{ text: "first" }, { toolCall: "noop" }, { text: "after the notice" }, { text: "second" }];
/** The custom run's second turn: the request pi prepares from the base prompt options. */
const AFTER_TOOL = 2;

interface Scenario {
  name: string;
  midConvo: boolean;
  /** The unpacked package to install, or undefined for a control run without system-pin. */
  packageDir?: string;
}

interface ScenarioResult {
  requests: SeenRequest[];
  pins: number;
}

/** One pi process through the scenario, with the fixture on its command line and system-pin only if installed. */
async function runScenario(root: string, scenario: Scenario): Promise<ScenarioResult> {
  const fake = await startFakeModel(REPLIES);
  const runDir = path.join(root, scenario.name);
  const cwd = path.join(runDir, "project");
  const sessionDir = path.join(runDir, "sessions");
  fs.mkdirSync(cwd, { recursive: true });
  const agentDir = writeAgentDir(runDir, fake.port, scenario.midConvo);
  if (scenario.packageDir) installPackage(scenario.packageDir, runDir, agentDir);
  // No --no-extensions: it would also skip the packages pi install recorded, which is what is under test.
  const args = ["-ns", "-np", "-nc", "--session-dir", sessionDir, "-e", path.join(repo, "scripts", "smoke-fixture.ts")];
  const pi = new RpcPi(args, cwd, childEnv(runDir, agentDir));
  try {
    await pi.promptAndSettle("hello");
    await pi.promptAndSettle("/notice");
    await pi.promptAndSettle("again");
  } finally {
    pi.stop();
    fake.server.close();
  }
  fs.writeFileSync(path.join(runDir, "requests.json"), JSON.stringify(fake.requests, null, 2)); // for --keep
  return { requests: fake.requests, pins: countPins(sessionDir) };
}

const carriesSection = (request: SeenRequest) => request.head.includes(SMOKE_SECTION_TEXT);
/** A later system message that drops the section: pi's patch for the custom run's second turn. */
const dropsSection = (request: SeenRequest) => request.laterSystem.some((text) => !text.includes(SMOKE_SECTION_TEXT));

/** Why the control run does not show the flaw, or null when it does. */
function controlVerdict(name: string, midConvo: boolean, requests: SeenRequest[]): string | null {
  if (requests.length !== REPLIES.length) return `${name}: ${requests.length} model requests, expected ${REPLIES.length}`;
  if (!carriesSection(requests[0])) return `${name}: the user run does not carry the fixture's section; the smoke is broken`;
  const flawed = midConvo ? dropsSection(requests[AFTER_TOOL]) : !carriesSection(requests[AFTER_TOOL]);
  if (!flawed) return `${name}: the custom run kept the section, so pi no longer has the flaw (pi#5581 fixed?): verify, then retire pi-system-pin`;
  return null;
}

/** Why the pinned run failed, or null when every head is identical, no request drops the section, and it pinned. */
function pinnedVerdict(name: string, result: ScenarioResult): string | null {
  const { requests, pins } = result;
  if (requests.length !== REPLIES.length) return `${name}: ${requests.length} model requests, expected ${REPLIES.length}`;
  if (!carriesSection(requests[0])) return `${name}: the user run does not carry the fixture's section`;
  const changed = requests.findIndex((request) => request.head !== requests[0].head);
  if (changed >= 0) return `${name}: request ${changed + 1} changed the leading system message`;
  const dropped = requests.findIndex(dropsSection);
  if (dropped >= 0) return `${name}: request ${dropped + 1} carries a system message without the section`;
  if (pins < 1) return `${name}: no system-pin.patch entry on the transcript; the installed package did not load or did not pin`;
  return null;
}

async function runAll(root: string, controlOnly: boolean): Promise<{ failures: string[]; requests: number }> {
  const failures: string[] = [];
  let requests = 0;
  const packageDir = controlOnly ? undefined : packPackage(root);
  for (const midConvo of [false, true]) {
    const suffix = midConvo ? "mid-conversation system messages" : "folded system messages";
    const control = await runScenario(root, { name: `control${midConvo ? "-mid" : ""}`, midConvo });
    failures.push(controlVerdict(`control, ${suffix}`, midConvo, control.requests) ?? "");
    requests += control.requests.length;
    if (!packageDir) continue;
    const pinned = await runScenario(root, { name: `pinned${midConvo ? "-mid" : ""}`, midConvo, packageDir });
    failures.push(pinnedVerdict(`installed system-pin, ${suffix}`, pinned) ?? "");
    requests += pinned.requests.length;
  }
  return { failures: failures.filter(Boolean), requests };
}

async function main(): Promise<number> {
  const keep = process.argv.includes("--keep");
  const controlOnly = process.argv.includes("--control-only");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "system-pin-smoke-"));
  try {
    const { failures, requests } = await runAll(root, controlOnly);
    for (const failure of failures) console.error(`pi smoke: ${failure}`);
    console.log(`pi smoke${controlOnly ? " (control only)" : ""}: ${requests} model requests: ${failures.length ? "FAIL" : "ok"}`);
    return failures.length ? 1 : 0;
  } finally {
    if (keep) console.log(`kept ${root}`);
    else fs.rmSync(root, { recursive: true, force: true });
  }
}

main().then((code) => process.exit(code), (error: unknown) => {
  console.error(`pi smoke: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
