/**
 * SMS message chunker that handles GSM-7 vs UCS-2 encoding limits.
 *
 * GSM-7: 160 chars per single SMS, 153 per segment in multi-part (7 chars for UDH header)
 * UCS-2: 70 chars per single SMS, 67 per segment in multi-part (3 chars for UDH header)
 */

const GSM7_SINGLE_LIMIT = 160;
const GSM7_MULTI_LIMIT = 153;
const UCS2_SINGLE_LIMIT = 70;
const UCS2_MULTI_LIMIT = 67;

/**
 * GSM 7-bit default alphabet characters (basic set).
 * If a message only contains these characters, it uses GSM-7 encoding.
 */
const GSM7_CHARS = new Set(
  (
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ" +
    " !\"#¤%&'()*+,-./0123456789:;<=>?" +
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
    "ÄÖÑÜabcdefghijklmnopqrstuvwxyz" +
    "äöñüà§"
  ).split(""),
);

/** Characters that require an escape in GSM-7 (count as 2 chars) */
const GSM7_EXTENDED = new Set(["|", "^", "€", "{", "}", "[", "]", "~", "\\"]);

/**
 * Detect whether the message can be encoded as GSM-7 or requires UCS-2.
 */
export function isGsm7(text: string): boolean {
  for (const char of text) {
    if (!GSM7_CHARS.has(char) && !GSM7_EXTENDED.has(char)) {
      return false;
    }
  }
  return true;
}

/**
 * Count the number of "character slots" a message uses in GSM-7 encoding.
 * Extended characters count as 2 slots.
 */
function gsm7Length(text: string): number {
  let len = 0;
  for (const char of text) {
    len += GSM7_EXTENDED.has(char) ? 2 : 1;
  }
  return len;
}

export type ChunkOptions = {
  /** "auto" (detect encoding), "single" (truncate), "multi" (allow multi-part) */
  mode: "auto" | "single" | "multi";
  /** Maximum total characters before hard truncation */
  maxLength: number;
  /** Add "[1/3]" segment numbering */
  segmentNumbering: boolean;
};

/**
 * Split a message into SMS-sized chunks.
 * Returns an array of strings, each fitting within a single SMS segment.
 */
export function chunkSms(text: string, options: ChunkOptions): string[] {
  if (!text) {
    return [];
  }

  // Hard truncation
  const truncated = text.length > options.maxLength ? text.slice(0, options.maxLength) + "…" : text;

  const gsm7 = isGsm7(truncated);
  const singleLimit = gsm7 ? GSM7_SINGLE_LIMIT : UCS2_SINGLE_LIMIT;
  const multiLimit = gsm7 ? GSM7_MULTI_LIMIT : UCS2_MULTI_LIMIT;

  // Check if message fits in a single SMS
  const effectiveLength = gsm7 ? gsm7Length(truncated) : truncated.length;
  if (effectiveLength <= singleLimit) {
    return [truncated];
  }

  // Single mode: truncate to fit one SMS
  if (options.mode === "single") {
    return [truncateToLimit(truncated, singleLimit, gsm7)];
  }

  // Multi mode: split into segments
  const segments = splitIntoSegments(truncated, multiLimit, gsm7);

  if (!options.segmentNumbering || segments.length <= 1) {
    return segments;
  }

  // Add segment numbering, accounting for the numbering overhead
  return addSegmentNumbering(truncated, multiLimit, gsm7, segments.length);
}

/**
 * Truncate text to fit within a character limit, respecting GSM-7 extended chars.
 */
function truncateToLimit(text: string, limit: number, gsm7: boolean): string {
  if (!gsm7) {
    return text.slice(0, limit - 1) + "…";
  }

  let len = 0;
  let i = 0;
  const chars = [...text];
  while (i < chars.length && len < limit - 1) {
    const charLen = GSM7_EXTENDED.has(chars[i]) ? 2 : 1;
    if (len + charLen > limit - 1) break;
    len += charLen;
    i++;
  }
  return chars.slice(0, i).join("") + "…";
}

/**
 * Split text into segments of at most `limit` character slots.
 * Tries to split at word boundaries when possible.
 */
function splitIntoSegments(text: string, limit: number, gsm7: boolean): string[] {
  const segments: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const effectiveLen = gsm7 ? gsm7Length(remaining) : remaining.length;
    if (effectiveLen <= limit) {
      segments.push(remaining);
      break;
    }

    // Find split point
    let splitAt = findSplitPoint(remaining, limit, gsm7);
    segments.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return segments;
}

/**
 * Find the best split point (prefer word boundaries).
 */
function findSplitPoint(text: string, limit: number, gsm7: boolean): number {
  // Find the maximum character index that fits within limit
  let maxIdx: number;
  if (!gsm7) {
    maxIdx = limit;
  } else {
    let len = 0;
    maxIdx = 0;
    const chars = [...text];
    for (let i = 0; i < chars.length; i++) {
      const charLen = GSM7_EXTENDED.has(chars[i]) ? 2 : 1;
      if (len + charLen > limit) break;
      len += charLen;
      maxIdx = i + 1;
    }
  }

  // Look back for a word boundary (space, newline)
  const searchRegion = text.slice(0, maxIdx);
  const lastSpace = Math.max(searchRegion.lastIndexOf(" "), searchRegion.lastIndexOf("\n"));
  if (lastSpace > maxIdx * 0.3) {
    return lastSpace + 1;
  }

  return maxIdx;
}

/**
 * Re-segment with numbering like "[1/3] " prefix.
 */
function addSegmentNumbering(
  text: string,
  baseLimit: number,
  gsm7: boolean,
  estimatedCount: number,
): string[] {
  // Calculate overhead: "[XX/XX] " = 8 chars for up to 99 segments
  const digits = String(estimatedCount).length;
  const overhead = 2 + digits + 1 + digits + 2; // "[N/N] "
  const effectiveLimit = baseLimit - overhead;

  if (effectiveLimit < 20) {
    // Not enough room for numbering, skip it
    return splitIntoSegments(text, baseLimit, gsm7);
  }

  const rawSegments = splitIntoSegments(text, effectiveLimit, gsm7);
  const total = rawSegments.length;

  return rawSegments.map((seg, i) => `[${i + 1}/${total}] ${seg}`);
}

/**
 * Convenience: chunk for the OpenClaw outbound adapter.
 * Uses multi mode with auto encoding detection.
 */
export function chunkSmsForOutbound(text: string, maxLength: number): string[] {
  return chunkSms(text, {
    mode: "auto",
    maxLength,
    segmentNumbering: true,
  });
}
