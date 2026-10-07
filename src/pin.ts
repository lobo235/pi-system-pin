/**
 * Holding pinned section changes back from a request, and deciding when a held change is real.
 *
 * A pinned patch is one pi wrote outside a user run (see index.ts). Its section changes are held back from
 * every request until a user run agrees with them; its tool changes always apply, because they are real.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";

import { changedSections, isEmptyPatch, isSystemPatch, patchKey, type SystemPatch } from "./patch.ts";

/** Pinned patches by key, and released section changes as `${key}#${section}`. */
export interface Pins {
  patches: ReadonlySet<string>;
  released: ReadonlySet<string>;
}

export interface HeldChange {
  index: number;
  key: string;
  sections: string[];
}

/** The pinned section changes still held back, by message index. The leading system message is never one. */
export function heldChanges(messages: AgentMessage[], pins: Pins): HeldChange[] {
  if (pins.patches.size === 0) return [];
  const held: HeldChange[] = [];
  messages.forEach((message, index) => {
    if (index === 0 || !isSystemPatch(message)) return;
    const key = patchKey(message);
    if (!pins.patches.has(key)) return;
    const sections = changedSections(message).filter((name) => !pins.released.has(`${key}#${name}`));
    if (sections.length > 0) held.push({ index, key, sections });
  });
  return held;
}

/** The request with every held section change removed; the same array when nothing is held. */
export function pinnedRequest(messages: AgentMessage[], pins: Pins): AgentMessage[] {
  const held = new Map(heldChanges(messages, pins).map((change) => [change.index, change.sections]));
  if (held.size === 0) return messages;
  return messages.flatMap((message, index) => {
    const drop = held.get(index);
    if (!drop || !isSystemPatch(message)) return [message];
    const sections = Object.fromEntries(Object.entries(message.sections ?? {}).filter(([name]) => !drop.includes(name)));
    const kept: SystemPatch = { ...message, sections };
    return isEmptyPatch(kept) ? [] : [kept as AgentMessage];
  });
}

/**
 * Held changes no later system message touches, as `${key}#${section}`. Called at a user run's request,
 * after pi diffed that run's options against the transcript: a section the run left alone is one it agrees
 * with, so the change was real (an extension stopped adding the section, a reload changed a context file).
 */
export function releasableChanges(messages: AgentMessage[], pins: Pins): string[] {
  return heldChanges(messages, pins).flatMap(({ index, key, sections }) =>
    sections
      .filter((name) => !messages.slice(index + 1).some((later) => isSystemPatch(later) && Object.hasOwn(later.sections ?? {}, name)))
      .map((name) => `${key}#${name}`),
  );
}
