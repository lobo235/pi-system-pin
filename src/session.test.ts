/**
 * End to end through a REAL pi session (pi's own AgentSession, extension runner, agent loop and transcript),
 * with only the model faked. It compares the leading system text exactly as pi-ai builds it for a provider
 * without mid-conversation system messages (`getCurrentSystemPrompt`, the replay that provider puts at the
 * head) for every request of: a user run, a two-turn custom-message run, and a second user run.
 *
 * The two tests named `control:` run WITHOUT system-pin and assert that pi still has the flaw (pi#5581).
 * They are the retirement signal: when one fails on a new pi, pi has fixed the flaw and system-pin should be
 * uninstalled (README, When to uninstall). Do not weaken or delete them to make a pi upgrade pass.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";

import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionAPI,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import { PATCH_ENTRY } from "./entries.ts";
import systemPin from "./index.ts";

const SECTION = "shell_policy";
const SECTION_TEXT = "Background shell: /bin/bash -c";
const GUIDELINE = "Prefer rg over grep.";

/** An extension that adds one prompt section on every user run while `state.on`, and registers a tool. */
function sectionAdder(state: { on: boolean } = { on: true }): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.on("before_agent_start", (event) => {
      if (state.on) event.systemPromptOptions.sections[SECTION] = SECTION_TEXT;
    });
    pi.registerTool({
      name: "noop",
      label: "noop",
      description: "Does nothing.",
      parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: "text", text: "done" }], details: {} }),
    });
  };
}

/** An extension that REWRITES one of pi's own sections (the guidelines) on every user run, rather than adding one. */
const builtinRewriter: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.on("before_agent_start", (event) => {
    event.systemPromptOptions.promptGuidelines = [...(event.systemPromptOptions.promptGuidelines ?? []), GUIDELINE];
  });
};

type Reply = ReturnType<typeof fauxAssistantMessage>;
const TEXT = (text: string): Reply => fauxAssistantMessage(text);
const TOOL_CALL = (): Reply => fauxAssistantMessage(fauxToolCall("noop", {}), { stopReason: "toolUse" });

/** Extension handler errors across every session a test opens; each test asserts there were none. */
const extensionErrors: string[] = [];
afterEach(() => assert.deepEqual(extensionErrors.splice(0), [], "an extension handler threw"));

/** A real pi session on a faux model; every request's leading system text lands in `heads`. */
async function openSession(dir: string, extensions: ExtensionFactory[], sessionManager: SessionManager, replies: Reply[], heads: string[]) {
  const faux = fauxProvider();
  faux.setResponses(
    replies.map((message) => (context: { messages: unknown[] }) => {
      heads.push(getCurrentSystemPrompt(context.messages as never));
      return message;
    }),
  );
  const modelRuntime = await ModelRuntime.create({ authPath: path.join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory();
  const resourceLoader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    settingsManager,
    extensionFactories: extensions,
    noSkills: true,
    noPromptTemplates: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd: dir,
    agentDir: dir,
    modelRuntime,
    model: faux.getModel(),
    thinkingLevel: "off",
    resourceLoader,
    settingsManager,
    sessionManager,
  });
  // What pi itself does before the first prompt: emit session_start to the extensions.
  await session.bindExtensions({ onError: (error) => extensionErrors.push(`${error.event}: ${error.error}`) });
  return session;
}

const notice = { customType: "notice", content: "task T1 finished", display: false };

/** A user run, a two-turn custom-message run, then a second user run: four requests. */
async function runScenario(extensions: ExtensionFactory[], beforeSecondPrompt: () => void = () => {}): Promise<{ heads: string[]; pins: number }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "system-pin-"));
  const heads: string[] = [];
  const replies = [TEXT("first"), TOOL_CALL(), TEXT("after the notice"), TEXT("second")];
  const session = await openSession(dir, extensions, SessionManager.inMemory(dir), replies, heads);
  try {
    await session.prompt("hello");
    await session.sendCustomMessage(notice, { triggerTurn: true });
    beforeSecondPrompt();
    await session.prompt("again");
    const pins = session.sessionManager.getEntries().filter((entry) => entry.type === "custom" && entry.customType === PATCH_ENTRY).length;
    return { heads, pins };
  } finally {
    session.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const RETIRE = "pi no longer has the flaw (pi#5581 fixed?): verify, then retire pi-system-pin (README, When to uninstall)";

test("control: without system-pin, a custom-message run drops a section an extension added", async () => {
  const { heads } = await runScenario([sectionAdder()]);
  assert.equal(heads.length, 4, "four model requests");
  assert.ok(heads[0].includes(SECTION_TEXT), "the user run carries the section");
  assert.ok(!heads[2].includes(SECTION_TEXT), `the custom run's second turn still carries the section: ${RETIRE}`);
});

test("control: without system-pin, a custom-message run reverts a built-in section an extension rewrote", async () => {
  const { heads } = await runScenario([sectionAdder(), builtinRewriter]);
  assert.equal(heads.length, 4, "four model requests");
  assert.ok(heads[0].includes(GUIDELINE), "the user run carries the rewrite");
  assert.ok(!heads[2].includes(GUIDELINE), `the custom run's second turn still carries the rewrite: ${RETIRE}`);
});

test("with system-pin, every request's system block is byte-identical whatever started the run", async () => {
  const { heads, pins } = await runScenario([sectionAdder(), systemPin]);
  assert.equal(pins, 1, "only the custom run's patch is pinned, never the user run's");
  assert.equal(heads.length, 4, "four model requests");
  assert.ok(heads[0].includes(SECTION_TEXT));
  for (const [index, head] of heads.entries()) assert.equal(head, heads[0], `request ${index + 1} changed the system block`);
});

test("with system-pin, a rewritten built-in section stays byte-identical across a custom-message run", async () => {
  const { heads } = await runScenario([sectionAdder(), builtinRewriter, systemPin]);
  assert.equal(heads.length, 4, "four model requests");
  assert.ok(heads[0].includes(GUIDELINE));
  for (const [index, head] of heads.entries()) assert.equal(head, heads[0], `request ${index + 1} changed the system block`);
});

test("with system-pin, a section the next user run does NOT put back really goes", async () => {
  const state = { on: true };
  const { heads } = await runScenario([sectionAdder(state), systemPin], () => {
    state.on = false;
  });
  assert.equal(heads.length, 4, "four model requests");
  for (const index of [1, 2]) assert.equal(heads[index], heads[0], `request ${index + 1} changed the system block`);
  assert.ok(!heads[3].includes(SECTION_TEXT), "the user run that dropped the section sends it dropped");
});

test("with system-pin, a reopened session sends the same system block", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "system-pin-"));
  const sessionDir = path.join(dir, "sessions");
  const heads: string[] = [];
  try {
    const first = await openSession(dir, [sectionAdder(), systemPin], SessionManager.create(dir, sessionDir), [TEXT("first"), TOOL_CALL(), TEXT("after the notice")], heads);
    await first.prompt("hello");
    await first.sendCustomMessage(notice, { triggerTurn: true });
    const file = first.sessionManager.getSessionFile();
    first.dispose();
    assert.ok(file, "the session was written to disk");
    const reopened = await openSession(dir, [sectionAdder(), systemPin], SessionManager.open(file, sessionDir), [TOOL_CALL(), TEXT("after the restart"), TEXT("second")], heads);
    await reopened.sendCustomMessage({ ...notice, content: "task T2 finished" }, { triggerTurn: true });
    await reopened.prompt("again");
    reopened.dispose();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(heads.length, 6, "six model requests");
  for (const [index, head] of heads.entries()) assert.equal(head, heads[0], `request ${index + 1} changed the system block`);
});

test("with system-pin, a session whose first run a custom message starts changes its head once, at the first user prompt", async () => {
  // pi 1.0.4 sends that first run with no system prompt at all (before_agent_start has never run). The head
  // holds within the run, changes once when the first user run shapes the prompt, and then holds.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "system-pin-"));
  const heads: string[] = [];
  const replies = [TOOL_CALL(), TEXT("after the notice"), TEXT("first"), TOOL_CALL(), TEXT("after the second notice")];
  const session = await openSession(dir, [sectionAdder(), systemPin], SessionManager.inMemory(dir), replies, heads);
  try {
    await session.sendCustomMessage(notice, { triggerTurn: true });
    await session.prompt("hello");
    await session.sendCustomMessage({ ...notice, content: "task T2 finished" }, { triggerTurn: true });
  } finally {
    session.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(heads.length, 5, "five model requests");
  assert.equal(heads[1], heads[0], "the first custom run keeps its head on its second turn");
  assert.ok(heads[2].includes(SECTION_TEXT), "the first user run carries the section");
  for (const index of [3, 4]) assert.equal(heads[index], heads[2], `request ${index + 1} changed the system block`);
});
