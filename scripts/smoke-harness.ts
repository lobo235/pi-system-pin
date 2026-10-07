/**
 * The machinery of the real-pi smoke (scripts/pi-smoke.ts): a fake OpenAI-compatible model on loopback that
 * records every request, a fresh agent dir and HOME, this package packed and installed into them the way a user
 * installs it, and pi's RPC stream. No network, no key, and nothing of the person running it is read or written.
 */
import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import * as readline from "node:readline";

export const repo = path.join(import.meta.dirname, "..");
const PROVIDER = "example-provider";
const MODEL = "example-model";
const STEP_TIMEOUT_MS = 60_000;
const PATCH_ENTRY = "system-pin.patch";

export type Reply = { text: string } | { toolCall: string };

/** What one request carried: the leading system text, and the text of every later system message. */
export interface SeenRequest {
  head: string;
  laterSystem: string[];
}

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

type ChatMessage = { role?: string; content?: unknown };
const isSystem = (message: ChatMessage) => message.role === "system" || message.role === "developer";

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part: { text?: unknown }) => (typeof part.text === "string" ? part.text : "")).join("");
}

function seen(body: unknown): SeenRequest {
  const messages = (body as { messages?: ChatMessage[] }).messages ?? [];
  const head = messages[0] && isSystem(messages[0]) ? textOf(messages[0].content) : "";
  return { head, laterSystem: messages.slice(1).filter(isSystem).map((message) => textOf(message.content)) };
}

export interface FakeModel {
  server: http.Server;
  port: number;
  requests: SeenRequest[];
}

export function startFakeModel(replies: Reply[]): Promise<FakeModel> {
  const requests: SeenRequest[] = [];
  const server = http.createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on("data", (part: Buffer) => parts.push(part));
    req.on("end", () => {
      requests.push(seen(JSON.parse(Buffer.concat(parts).toString("utf8"))));
      answer(res, replies[requests.length - 1] ?? { text: "extra" });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as { port: number }).port, requests }));
  });
}

/** A fresh agent dir whose only model is the fake one; `midConvo` turns on mid-conversation system messages. */
export function writeAgentDir(root: string, port: number, midConvo: boolean): string {
  const agentDir = path.join(root, "agent");
  fs.mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const model = {
    id: MODEL, name: MODEL, contextWindow: 131072, maxTokens: 4096, input: ["text"], reasoning: false,
    ...(midConvo ? { compat: { supportsMidConvoSystemMessages: true } } : {}),
  };
  const models = { providers: { [PROVIDER]: { baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-completions", apiKey: "unused", models: [model] } } };
  fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify(models, null, 2));
  return agentDir;
}

const piCli = path.join(repo, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");

export function childEnv(root: string, agentDir: string): NodeJS.ProcessEnv {
  return { ...process.env, HOME: root, USERPROFILE: root, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" };
}

/** npm, run the way that works on every OS: through the npm that started this script when there is one. */
function runNpm(args: string[], cwd: string): string {
  const npmCli = process.env.npm_execpath;
  if (npmCli && npmCli.endsWith(".js")) return execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: "utf8" });
  return execFileSync("npm", args, { cwd, encoding: "utf8", shell: process.platform === "win32" });
}

/**
 * Packs this repository with `npm pack` (so the `files` allowlist applies) and unpacks the tarball, returning
 * the unpacked package directory: exactly the files a user's install receives.
 */
export function packPackage(root: string): string {
  const packDir = path.join(root, "pack");
  fs.mkdirSync(packDir, { recursive: true });
  const tarball = runNpm(["pack", "--silent", "--pack-destination", packDir], repo).trim().split("\n").pop() ?? "";
  execFileSync("tar", ["-xzf", path.join(packDir, tarball), "-C", packDir]);
  return path.join(packDir, "package");
}

/**
 * Installs the unpacked package into an agent dir with pi's own `pi install`, as a user would. pi then finds the
 * entry point through the package's `pi.extensions` manifest when it starts.
 */
export function installPackage(packageDir: string, home: string, agentDir: string): void {
  execFileSync(process.execPath, [piCli, "install", packageDir], { cwd: home, env: childEnv(home, agentDir), stdio: "pipe" });
}

/** pi's RPC stream: commands in, records out, and a wait for the next record of a type. */
export class RpcPi {
  private readonly waiting: Array<{ type: string; resolve: (record: Record<string, unknown>) => void }> = [];
  private exited: string | null = null;
  private readonly child: ReturnType<typeof spawn>;

  constructor(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
    this.child = spawn(process.execPath, [piCli, "--mode", "rpc", "--model", `${PROVIDER}/${MODEL}`, ...args], { cwd, env, stdio: ["pipe", "pipe", "inherit"] });
    readline.createInterface({ input: this.child.stdout! }).on("line", (line) => this.receive(line));
    this.child.on("exit", (code) => {
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

/** The number of `system-pin.patch` entries in the session files under `sessionDir`. */
export function countPins(sessionDir: string): number {
  if (!fs.existsSync(sessionDir)) return 0;
  const files = fs.readdirSync(sessionDir, { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".jsonl"));
  const lines = files.flatMap((name) => fs.readFileSync(path.join(sessionDir, name), "utf8").split("\n").filter(Boolean));
  return lines.filter((line) => {
    const entry = JSON.parse(line) as { type?: string; customType?: string };
    return entry.type === "custom" && entry.customType === PATCH_ENTRY;
  }).length;
}
