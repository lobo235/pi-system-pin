/**
 * Real-pi smoke: the pi binary this tree vendors, started with `--no-extensions` and only the extensions
 * named on its command line, in a fresh agent dir and HOME, against a fake OpenAI-compatible model on
 * loopback. No network, no key, and nothing of the person running it is read or written.
 *
 * It drives pi over RPC through the scenario pi#5581 is about: a user prompt, a run started by an extension's
 * custom message (two model turns), and a second user prompt. The fake model records the system text at the
 * head of every request. It runs the scenario twice:
 *
 * - control, without system-pin: the custom run's second turn must lose the fixture's section. If it does
 *   not, pi no longer has the flaw and system-pin should be retired (README, When to uninstall).
 * - with system-pin: the extension loads and registers, every request's head is byte-identical, and the
 *   transcript carries a `system-pin.patch` entry.
 *
 * Exits 1 naming the reason otherwise. `--keep` leaves the temporary directory for inspection.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";

import { SMOKE_SECTION_TEXT } from "./smoke-fixture.ts";

const repo = path.join(import.meta.dirname, "..");
const PROVIDER = "example-provider";
const MODEL = "example-model";
const STEP_TIMEOUT_MS = 60_000;
const PATCH_ENTRY = "system-pin.patch";

type Reply = { text: string } | { toolCall: string };
/** The model's answers in request order: user run; custom run (a tool call, then text); second user run. */
const REPLIES: Reply[] = [{ text: "first" }, { toolCall: "noop" }, { text: "after the notice" }, { text: "second" }];

function chunk(fields: object): string {
  return `data: ${JSON.stringify({ id: "smoke", object: "chat.completion.chunk", model: MODEL, ...fields })}\n\n`;
}

function answer(res: http.ServerResponse, reply: Reply): void {
  const delta = "text" in reply
    ? { role: "assistant", content: reply.text }
    : { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: reply.toolCall, arguments: "{}" } }] };
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.write(chunk({ choices: [{ index: 0, delta, finish_reason: null }] }));
  const finish = "text" in reply ? "stop" : "tool_calls";
  res.write(chunk({ choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 } }));
  res.end("data: [DONE]\n\n");
}

/** The system text at the head of an OpenAI chat request, or "" when it has none. */
function headOf(body: unknown): string {
  const first = (body as { messages?: Array<{ role?: string; content?: unknown }> }).messages?.[0];
  if (!first || (first.role !== "system" && first.role !== "developer")) return "";
  if (typeof first.content === "string") return first.content;
  if (!Array.isArray(first.content)) return "";
  return first.content.map((part: { text?: unknown }) => (typeof part.text === "string" ? part.text : "")).join("");
}

interface FakeModel {
  server: http.Server;
  port: number;
  heads: string[];
}

function startFakeModel(): Promise<FakeModel> {
  const heads: string[] = [];
  const server = http.createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on("data", (part: Buffer) => parts.push(part));
    req.on("end", () => {
      heads.push(headOf(JSON.parse(Buffer.concat(parts).toString("utf8"))));
      answer(res, REPLIES[heads.length - 1] ?? { text: "extra" });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as { port: number }).port, heads }));
  });
}

function writeAgentDir(root: string, port: number): string {
  const agentDir = path.join(root, "agent");
  fs.mkdirSync(agentDir, { mode: 0o700 });
  const model = { id: MODEL, name: MODEL, contextWindow: 131072, maxTokens: 4096, input: ["text"], reasoning: false };
  const models = { providers: { [PROVIDER]: { baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-completions", apiKey: "unused", models: [model] } } };
  fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify(models, null, 2));
  return agentDir;
}

/** pi's RPC stream: commands in, records out, and a wait for the next record of a type. */
class RpcPi {
  private readonly waiting: Array<{ type: string; resolve: (record: Record<string, unknown>) => void }> = [];
  private exited: string | null = null;
  private readonly child: ReturnType<typeof spawn>;

  constructor(child: ReturnType<typeof spawn>) {
    this.child = child;
    readline.createInterface({ input: child.stdout! }).on("line", (line) => this.receive(line));
    child.on("exit", (code) => {
      this.exited = `pi exited (${code}) mid-scenario`;
      for (const waiter of this.waiting.splice(0)) waiter.resolve({ type: "exit", error: this.exited });
    });
  }

  private receive(line: string): void {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return; // pi prints only JSON records in RPC mode; anything else is not ours to read
    }
    const index = this.waiting.findIndex((waiter) => waiter.type === record.type);
    if (index >= 0) this.waiting.splice(index, 1)[0].resolve(record);
  }

  /** Sends a prompt and resolves once pi reports the run it started has settled. */
  async promptAndSettle(message: string): Promise<void> {
    if (this.exited) throw new Error(this.exited);
    const settled = this.next("agent_settled");
    const response = this.next("response");
    this.child.stdin!.write(JSON.stringify({ id: message, type: "prompt", message }) + "\n");
    const accepted = await response;
    if (accepted.success !== true) throw new Error(`pi refused the prompt ${JSON.stringify(message)}: ${String(accepted.error)}`);
    const record = await settled;
    if (record.type === "exit") throw new Error(String(record.error));
  }

  private next(type: string): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${type} from pi within ${STEP_TIMEOUT_MS / 1000} s`)), STEP_TIMEOUT_MS);
      this.waiting.push({ type, resolve: (record) => { clearTimeout(timer); resolve(record); } });
    });
  }

  stop(): void {
    this.child.removeAllListeners("exit");
    this.child.stdin!.end();
    this.child.kill();
  }
}

function childEnv(root: string, agentDir: string): NodeJS.ProcessEnv {
  return { ...process.env, HOME: root, USERPROFILE: root, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" };
}

interface ScenarioResult {
  heads: string[];
  pins: number;
}

/** One pi process through the scenario, with the fixture and optionally system-pin loaded. */
async function runScenario(root: string, withPin: boolean): Promise<ScenarioResult> {
  const fake = await startFakeModel();
  const runDir = path.join(root, withPin ? "pinned" : "control");
  const cwd = path.join(runDir, "project");
  const sessionDir = path.join(runDir, "sessions");
  fs.mkdirSync(cwd, { recursive: true });
  const extensions = [path.join(repo, "scripts", "smoke-fixture.ts"), ...(withPin ? [path.join(repo, "src", "index.ts")] : [])];
  const cli = path.join(repo, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");
  const args = [cli, "--mode", "rpc", "-ne", "-ns", "-np", "-nc", "--session-dir", sessionDir, "--model", `${PROVIDER}/${MODEL}`, ...extensions.flatMap((file) => ["-e", file])];
  const child = spawn(process.execPath, args, { cwd, env: childEnv(runDir, writeAgentDir(runDir, fake.port)), stdio: ["pipe", "pipe", "inherit"] });
  const pi = new RpcPi(child);
  try {
    await pi.promptAndSettle("hello");
    await pi.promptAndSettle("/notice");
    await pi.promptAndSettle("again");
  } finally {
    pi.stop();
    fake.server.close();
  }
  return { heads: fake.heads, pins: countPins(sessionDir) };
}

function countPins(sessionDir: string): number {
  if (!fs.existsSync(sessionDir)) return 0;
  const files = fs.readdirSync(sessionDir, { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".jsonl"));
  const lines = files.flatMap((name) => fs.readFileSync(path.join(sessionDir, name), "utf8").split("\n").filter(Boolean));
  return lines.filter((line) => {
    const entry = JSON.parse(line) as { type?: string; customType?: string };
    return entry.type === "custom" && entry.customType === PATCH_ENTRY;
  }).length;
}

/** Why the control run does not show the flaw, or null when it does. */
function controlVerdict(heads: string[]): string | null {
  if (heads.length !== REPLIES.length) return `control: ${heads.length} model requests, expected ${REPLIES.length}`;
  if (!heads[0].includes(SMOKE_SECTION_TEXT)) return "control: the user run does not carry the fixture's section; the smoke is broken";
  if (heads[2].includes(SMOKE_SECTION_TEXT)) return "control: the custom run kept the section, so pi no longer has the flaw (pi#5581 fixed?): verify, then retire pi-system-pin";
  return null;
}

/** Why the pinned run failed, or null when every head is identical and a pin was recorded. */
function pinnedVerdict(result: ScenarioResult): string | null {
  const { heads, pins } = result;
  if (heads.length !== REPLIES.length) return `with system-pin: ${heads.length} model requests, expected ${REPLIES.length}`;
  if (!heads[0].includes(SMOKE_SECTION_TEXT)) return "with system-pin: the user run does not carry the fixture's section";
  const changed = heads.findIndex((head) => head !== heads[0]);
  if (changed >= 0) return `with system-pin: request ${changed + 1} changed the system block`;
  if (pins < 1) return `with system-pin: no ${PATCH_ENTRY} entry on the transcript; the extension did not load or did not pin`;
  return null;
}

async function main(): Promise<number> {
  const keep = process.argv.includes("--keep");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "system-pin-smoke-"));
  try {
    const control = await runScenario(root, false);
    const pinned = await runScenario(root, true);
    const failures = [controlVerdict(control.heads), pinnedVerdict(pinned)].filter((failure): failure is string => failure !== null);
    for (const failure of failures) console.error(`pi smoke: ${failure}`);
    console.log(`pi smoke: ${control.heads.length + pinned.heads.length} model requests, ${pinned.pins} pin(s): ${failures.length ? "FAIL" : "ok"}`);
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
