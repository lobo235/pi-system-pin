/**
 * A system patch: a system message after the leading one. pi-ai replays every system message in order to
 * get the current prompt; `sections` replace named prompt sections (`null` removes one), and
 * `toolsAdded`/`toolsRemoved` change the tool set.
 */
import { createHash } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

/** The fields of pi-ai's SystemMessage this extension reads; the rest pass through untouched. */
export interface SystemPatch {
  role: "system";
  content?: unknown;
  sections?: Record<string, string | null>;
  toolsAdded?: unknown[];
  toolsRemoved?: unknown[];
  timestamp: number;
}

export function isSystemPatch(message: AgentMessage): message is AgentMessage & SystemPatch {
  return (message as { role?: unknown }).role === "system";
}

/** The names of the sections a patch sets or removes. */
export function changedSections(message: SystemPatch): string[] {
  return Object.keys(message.sections ?? {});
}

/**
 * A patch's identity on the transcript: its timestamp and a digest of its section changes, so two patches
 * written in the same millisecond still differ. Persisted in `system-pin.patch` entries: the format never changes.
 */
export function patchKey(message: SystemPatch): string {
  const digest = createHash("sha256").update(JSON.stringify(message.sections ?? {})).digest("hex").slice(0, 16);
  return `${message.timestamp}:${digest}`;
}

/** True when a patch carries nothing: no instruction text, no section change and no tool change. */
export function isEmptyPatch(message: SystemPatch): boolean {
  const content = message.content;
  const noContent = content === undefined || content === "" || (Array.isArray(content) && content.length === 0);
  const noTools = (message.toolsAdded?.length ?? 0) === 0 && (message.toolsRemoved?.length ?? 0) === 0;
  return noContent && noTools && changedSections(message).length === 0;
}
