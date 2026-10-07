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

/**
 * The request for `messages`, given the pins and whether a user run is sending it. `readBranch` is called at most
 * once, and not at all while nothing is pinned, so a session that never needed a pin pays no per-request walk.
 */
export function pinRequest(messages: AgentMessage[], readBranch: () => readonly unknown[], pins: Pins, inUserRun: boolean): PinOutcome {
  if (pins.patches.size === 0) return { messages: undefined, released: [] };
  const branch = readBranch();
  const leading = messages[0];
  const holdFolded = (given: Pins) => (leading ? foldedHold(branch, leading, given) : undefined);
  let folded = holdFolded(pins);
  const released = inUserRun ? [...new Set([...releasableChanges(messages, pins), ...(folded ? releasableFolded(messages, folded.held) : [])])] : [];
  const current: Pins = released.length === 0 ? pins : { patches: pins.patches, released: new Set([...pins.released, ...released]) };
  if (current !== pins) folded = holdFolded(current);
  const pinned = pinnedRequest(messages, current);
  const result = folded ? [folded.head, ...pinned.slice(1)] : pinned === messages ? undefined : pinned;
  return { messages: result, released };
}
