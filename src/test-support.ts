/**
 * An in-memory pi for the wiring tests: it delivers events to the handlers an extension registered, in the
 * order the test emits them, keeps the entries the extension appends on a transcript the next session_start
 * reads back, and records the notices it shows. Not shipped (package.json `files`).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Handler = (event: unknown, ctx: unknown) => unknown;

export interface FakePi {
  /** Delivers one event to every handler; returns their results. */
  emit(name: string, event?: Record<string, unknown>): unknown[];
  /** A finished message, as pi reports it in `message_end`. */
  end(message: unknown): void;
  /** The request transform: what `context_with_system` hands back for these messages. */
  request(messages: unknown[]): unknown;
  /** Entries on the fake transcript (also its branch), appended by the extension or seeded by the test. */
  entries: Array<{ type: string; customType?: string; data?: unknown; [field: string]: unknown }>;
  notices: Array<{ text: string; level: string | undefined }>;
  /** Makes every later notify throw, as a broken UI would. */
  breakNotify(): void;
}

export function fakePi(register: (pi: ExtensionAPI) => void): FakePi {
  const handlers = new Map<string, Handler[]>();
  const entries: FakePi["entries"] = [];
  const notices: FakePi["notices"] = [];
  let notifyBroken = false;
  const ctx = {
    sessionManager: { getEntries: () => [...entries], getBranch: () => [...entries] },
    ui: {
      notify: (text: string, level?: string) => {
        if (notifyBroken) throw new Error("ui gone");
        notices.push({ text, level });
      },
    },
  };
  const api = {
    on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
  };
  register(api as unknown as ExtensionAPI);
  const emit = (name: string, event: Record<string, unknown> = {}) => (handlers.get(name) ?? []).map((handler) => handler({ type: name, ...event }, ctx));
  return {
    emit,
    end: (message) => void emit("message_end", { message }),
    request: (messages) => emit("context_with_system", { messages })[0],
    entries,
    notices,
    breakNotify: () => {
      notifyBroken = true;
    },
  };
}
