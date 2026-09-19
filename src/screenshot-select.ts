import { VrefError } from "./errors.js";
import type { VrefScreenshot } from "./types.js";

/** The entry an id names, or a failure that names the id rather than the shape. */
export function screenshotById(screenshots: VrefScreenshot[], id: string): VrefScreenshot {
  const found = screenshots.find((screenshot) => screenshot.id === id);

  if (found === undefined) {
    throw new VrefError("VREF_UNKNOWN_SELECTOR", `manifest has no screenshot id "${id}"`);
  }

  return found;
}

/**
 * The manifest's screenshots as authored.
 *
 * Edits patch these rather than the decoded entries so fields `vref` does not
 * model survive a round trip.
 */
export function rawScreenshots(document: Record<string, unknown>): unknown[] {
  if (Array.isArray(document.screenshots)) {
    return document.screenshots;
  }

  throw new VrefError("VREF_MANIFEST_SCHEMA_INVALID", "manifest:screenshots must be an array");
}
