/**
 * Pinned changes that pi folded into a compaction's leading system message.
 *
 * At a compaction pi stores the current system state (every system message on the branch, replayed) on the
 * compaction entry, and that becomes the leading system message of every later request. A pinned change still
 * held at that moment is folded into it, where holding back the patch message no longer helps. So the head is
 * rebuilt the same way with the held changes left out, from the original system messages, which stay on the
 * branch. The transcript is never rewritten.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";

import { isSystemPatch, type SystemPatch } from "./patch.ts";
import { heldChanges, pinnedRequest, touchesSection, type Pins } from "./pin.ts";

export interface FoldedHold {
  /** The request's leading system message with the folded held changes undone. */
  head: AgentMessage;
  /** The held changes the head undoes, by patch. */
  held: Array<{ key: string; sections: string[] }>;
}

/** The sections a list of system messages leaves after replaying it, in the order pi-ai renders them. */
function replaySections(messages: readonly SystemPatch[]): Record<string, string> {
  const sections = new Map<string, string>();
  for (const message of messages) {
    for (const [name, value] of Object.entries(message.sections ?? {})) {
      if (value === null) sections.delete(name);
      else sections.set(name, value);
    }
  }
  return Object.fromEntries(sections);
}

const sameSections = (left: Record<string, unknown>, right: Record<string, unknown>) =>
  JSON.stringify(Object.entries(left)) === JSON.stringify(Object.entries(right));

function systemMessageOf(entry: unknown): SystemPatch | undefined {
  if (typeof entry !== "object" || entry === null || (entry as { type?: unknown }).type !== "message") return undefined;
  const message = (entry as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return undefined;
  return isSystemPatch(message as AgentMessage) ? (message as SystemPatch) : undefined;
}

function latestCompaction(branch: readonly unknown[]): { index: number; head: SystemPatch } | undefined {
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index] as { type?: unknown; systemMessage?: unknown } | null;
    if (typeof entry !== "object" || entry === null || entry.type !== "compaction") continue;
    const head = entry.systemMessage as SystemPatch | undefined;
    return head && typeof head === "object" && head.role === "system" ? { index, head } : undefined;
  }
  return undefined;
}

/**
 * The leading message without the held changes pi folded into it at the latest compaction, or undefined when
 * there are none, when `leading` is not that compaction's head, or when replaying the branch does not give
 * pi's own folded sections (pi changed how it folds: hold nothing rather than guess).
 */
export function foldedHold(branch: readonly unknown[], leading: AgentMessage, pins: Pins): FoldedHold | undefined {
  const compaction = latestCompaction(branch);
  if (!compaction || !isSystemPatch(leading) || leading.timestamp !== compaction.head.timestamp) return undefined;
  const system = branch.slice(0, compaction.index).map(systemMessageOf).filter((message) => message !== undefined) as AgentMessage[];
  const held = heldChanges(system, pins).map(({ key, sections }) => ({ key, sections }));
  if (held.length === 0) return undefined;
  if (!sameSections(replaySections(system as SystemPatch[]), compaction.head.sections ?? {})) return undefined;
  const pinned = pinnedRequest(system, pins) as unknown as SystemPatch[];
  return { head: { ...leading, sections: replaySections(pinned) } as AgentMessage, held };
}

/**
 * Folded held changes no later system message in the request touches, as `${key}#${section}`. Called at a
 * user run's request, like releasableChanges: a section the run left alone is one it agrees with.
 */
export function releasableFolded(messages: readonly AgentMessage[], held: FoldedHold["held"]): string[] {
  const later = messages.slice(1);
  return held.flatMap(({ key, sections }) => sections.filter((name) => !touchesSection(later, name)).map((name) => `${key}#${name}`));
}
