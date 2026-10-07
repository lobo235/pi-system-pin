/**
 * The other extension in the real-pi smoke (scripts/pi-smoke.ts): it does what the extensions affected by
 * pi#5581 do. It adds a prompt section on every user run, registers a tool, and has a `/notice` command that
 * starts a run with a custom message (`sendMessage` with `triggerTurn`), as a background-task or messaging
 * extension would. Not shipped.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const SMOKE_SECTION_TEXT = "<smoke_policy>Run background commands with /bin/sh -c.</smoke_policy>";

export default function smokeFixture(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => {
    event.systemPromptOptions.sections.smoke_policy = SMOKE_SECTION_TEXT;
  });
  pi.registerTool({
    name: "noop",
    label: "noop",
    description: "Does nothing.",
    parameters: Type.Object({}),
    execute: async () => ({ content: [{ type: "text", text: "done" }], details: {} }),
  });
  pi.registerCommand("notice", {
    description: "Start a run with a custom message, as a background task finishing would",
    handler: async () => {
      pi.sendMessage({ customType: "smoke-notice", content: "Background task T1 finished.", display: false }, { triggerTurn: true });
    },
  });
}
