/**
 * pi-system-pin: the system block a request carries does not depend on what started the run.
 *
 * A stopgap for pi#5581 (https://github.com/earendil-works/pi/issues/5581). pi fires `before_agent_start`,
 * where extensions shape the system prompt, only for a user prompt. A run that an extension's custom message
 * starts (`sendMessage` with `triggerTurn`) prepares its later turns from pi's BASE prompt options, so pi
 * appends a system patch that drops every section an extension added, or reverts every built-in section an
 * extension rewrote; the next user prompt puts them back. A provider without mid-conversation system messages
 * rebuilds the leading system message from every patch, so each flip rewrites the head of the request and a
 * prefix-caching provider re-reads the whole conversation.
 *
 * A section change written outside a user run is that fallback, not a decision, so this extension PINS it
 * (a `system-pin.patch` entry) and holds its section changes back from every request, keeping its tool
 * changes. The next user run decides: if it puts the section back, the head stays byte-identical; if it
 * leaves the section alone, it agrees with the change, which is RELEASED (a `system-pin.release` entry) and
 * applies from then on. A held change pi folds into a compaction's leading system message is left out there
 * too (fold.ts). The transcript's own system messages are never rewritten.
 */
import { VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { PATCH_ENTRY, readPins, RELEASE_ENTRY, type MutablePins } from "./entries.ts";
import { changedSections, isSystemPatch, patchKey } from "./patch.ts";
import { readPiCompat, unverifiedPiVersionNotice, type PiCompat } from "./pi-compat.ts";
import { pinRequest } from "./request.ts";

export interface SystemPinOptions {
  /** The running pi's version (`VERSION` from pi-coding-agent). */
  piVersion: string;
  /** The verified record (pi-compat.json). */
  compat: PiCompat;
}

/** The extension, with the pi version and the record it checks against passed in. */
export function createSystemPin(options: SystemPinOptions): (pi: ExtensionAPI) => void {
  const versionNotice = unverifiedPiVersionNotice(options.piVersion, options.compat);
  return (pi) => {
    let pins: MutablePins = { patches: new Set(), released: new Set() };
    // A user run is armed by before_agent_start and confirmed by its own prompt message; pi writes that run's
    // patch just before the prompt, so an armed patch is the user run's too. Any other message disarms: pi
    // can throw after before_agent_start (no run, no agent_settled), and a stale arm must not exempt the
    // custom run that comes next. A confirmed run lasts until it settles, every turn of it, pi's own
    // continuations included, all prepared from the options extensions shaped.
    let armed = false;
    let userRun = false;

    pi.on("session_start", (_event, ctx) => {
      pins = readPins(ctx.sessionManager.getEntries());
      armed = false;
      userRun = false;
      if (!versionNotice) return;
      try {
        ctx.ui.notify(versionNotice, "warning");
      } catch {
        // A notice the UI cannot show must never affect the session.
      }
    });
    pi.on("before_agent_start", () => {
      armed = true;
    });
    pi.on("agent_settled", () => {
      armed = false;
      userRun = false;
    });

    pi.on("message_end", (event) => {
      const message = event.message;
      if (!isSystemPatch(message)) {
        if (armed && message.role === "user") userRun = true;
        armed = false;
        return;
      }
      if (userRun || armed || changedSections(message).length === 0) return;
      const key = patchKey(message);
      if (pins.patches.has(key)) return;
      pins.patches.add(key);
      pi.appendEntry(PATCH_ENTRY, { key });
    });

    pi.on("context_with_system", (event, ctx) => {
      const outcome = pinRequest(event.messages, ctx.sessionManager.getBranch(), pins, userRun);
      for (const key of outcome.released) {
        pins.released.add(key);
        pi.appendEntry(RELEASE_ENTRY, { key });
      }
      return outcome.messages ? { messages: outcome.messages } : undefined;
    });
  };
}

export default function systemPin(pi: ExtensionAPI): void {
  createSystemPin({ piVersion: VERSION, compat: readPiCompat() })(pi);
}
