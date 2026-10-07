/**
 * The custom entries system-pin keeps on the transcript, so a reopened session sends the same request.
 * Both names and their `{ key }` data are part of the SemVer contract: a transcript consumer that filters
 * custom entries by type must keep them.
 */

/** A patch pi wrote outside a user run; data `{ key }` is its patchKey. */
export const PATCH_ENTRY = "system-pin.patch";
/** A held section change a user run agreed with; data `{ key }` is `${patchKey}#${section}`. */
export const RELEASE_ENTRY = "system-pin.release";

export interface MutablePins {
  patches: Set<string>;
  released: Set<string>;
}

/** The key an entry of type `customType` carries, or undefined for anything else. Transcript bytes are untrusted. */
function keyOf(entry: unknown, customType: string): string | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;
  const { type, customType: entryType, data } = entry as { type?: unknown; customType?: unknown; data?: unknown };
  if (type !== "custom" || entryType !== customType || typeof data !== "object" || data === null) return undefined;
  const key = (data as { key?: unknown }).key;
  return typeof key === "string" && key.length > 0 ? key : undefined;
}

/** The pins a transcript's entries record. */
export function readPins(entries: readonly unknown[]): MutablePins {
  const pins: MutablePins = { patches: new Set(), released: new Set() };
  for (const entry of entries) {
    const patch = keyOf(entry, PATCH_ENTRY);
    if (patch !== undefined) pins.patches.add(patch);
    const release = keyOf(entry, RELEASE_ENTRY);
    if (release !== undefined) pins.released.add(release);
  }
  return pins;
}
