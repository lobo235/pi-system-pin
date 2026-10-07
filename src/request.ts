/**
 * The request a `context_with_system` handler returns: held changes left out of the patch messages and, after a
 * compaction, out of the leading system message pi folded them into. In a user run, the held changes that run
 * agreed with are released first.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";

import { foldedHold, releasableFolded } from "./fold.ts";
import { pinnedRequest, releasableChanges, type Pins } from "./pin.ts";

export interface PinOutcome {
  /** The messages to send, or undefined to leave pi's request as it is. */
  messages: AgentMessage[] | undefined;
  /** Keys released by this request, to record as `system-pin.release` entries. */
  released: string[];
}

/** The request for `messages` on `branch`, given the pins and whether a user run is sending it. */
export function pinRequest(messages: AgentMessage[], branch: readonly unknown[], pins: Pins, inUserRun: boolean): PinOutcome {
  const leading = messages[0];
  const released = new Set<string>();
  if (inUserRun) {
    for (const key of releasableChanges(messages, pins)) released.add(key);
    const folded = leading ? foldedHold(branch, leading, pins) : undefined;
    for (const key of folded ? releasableFolded(messages, folded.held) : []) released.add(key);
  }
  const current: Pins = { patches: pins.patches, released: new Set([...pins.released, ...released]) };
  const folded = leading ? foldedHold(branch, leading, current) : undefined;
  const pinned = pinnedRequest(messages, current);
  const result = folded ? [folded.head, ...pinned.slice(1)] : pinned === messages ? undefined : pinned;
  return { messages: result, released: [...released] };
}
