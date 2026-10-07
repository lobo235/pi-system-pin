/**
 * The smoke's child environment (smoke-harness.ts): pi gets an allowlist, never the parent's whole environment.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

import { childEnv, startFakeModel } from "./smoke-harness.ts";

const parent = { PATH: "/usr/bin", TMPDIR: "/tmp/x", LANG: "C.UTF-8", HOME: "/home/someone", FAKE_API_KEY: "sentinel-key", OPENAI_API_KEY: "sentinel-openai" };

test("childEnv: a key in the parent environment never reaches pi", () => {
  const env = childEnv("/scratch/run", "/scratch/run/agent", parent);
  assert.equal(env.FAKE_API_KEY, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.ok(!Object.values(env).some((value) => value?.startsWith("sentinel")));
});

test("childEnv: pi gets the allowlisted variables and the smoke's own HOME and agent dir", () => {
  assert.deepEqual(childEnv("/scratch/run", "/scratch/run/agent", parent), {
    PATH: "/usr/bin", TMPDIR: "/tmp/x", LANG: "C.UTF-8",
    HOME: "/scratch/run", USERPROFILE: "/scratch/run", PI_CODING_AGENT_DIR: "/scratch/run/agent", PI_OFFLINE: "1",
  });
});

test("childEnv: by default it reads the real environment, and a child started with it does not see a key set there", () => {
  process.env.FAKE_API_KEY = "sentinel-from-parent";
  try {
    const env = childEnv("/scratch/run", "/scratch/run/agent");
    const seen = execFileSync(process.execPath, ["-e", "process.stdout.write(String(process.env.FAKE_API_KEY))"], { env, encoding: "utf8" });
    assert.equal(seen, "undefined");
  } finally {
    delete process.env.FAKE_API_KEY;
  }
});

test("startFakeModel: only POST to the completion route is a model request; a port probe gets 404 and is not counted", async (t) => {
  const fake = await startFakeModel([{ text: "hi" }]);
  t.after(() => {
    fake.server.closeAllConnections();
    fake.server.close();
  });
  const base = `http://127.0.0.1:${fake.port}`;
  assert.equal((await fetch(`${base}/`)).status, 404);
  assert.equal((await fetch(`${base}/v1/chat/completions`)).status, 404);
  assert.equal((await fetch(`${base}/v1/models`, { method: "POST", body: "{}" })).status, 404);
  assert.equal((await fetch(`${base}/v1/chat/completions`, { method: "POST", body: "not json" })).status, 400);
  assert.equal(fake.requests.length, 0);
  const completion = await fetch(`${base}/v1/chat/completions`, { method: "POST", body: JSON.stringify({ messages: [{ role: "system", content: "S" }] }) });
  assert.equal(completion.status, 200);
  await completion.text();
  assert.deepEqual(fake.requests, [{ head: "S", laterSystem: [] }]);
});
