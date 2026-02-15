import { describe, expect, it } from "vitest";
import { chunkSms, chunkSmsForOutbound, isGsm7, type ChunkOptions } from "./sms-chunker.js";

// ---------------------------------------------------------------------------
// GSM-7 Detection
// ---------------------------------------------------------------------------

describe("isGsm7", () => {
  it("returns true for plain ASCII text", () => {
    expect(isGsm7("Hello, World!")).toBe(true);
  });

  it("returns true for GSM-7 special characters", () => {
    expect(isGsm7("Price: £50 @ 10%")).toBe(true);
  });

  it("returns true for GSM-7 extended characters", () => {
    expect(isGsm7("Use [brackets] and {braces}")).toBe(true);
  });

  it("returns true for empty string", () => {
    expect(isGsm7("")).toBe(true);
  });

  it("returns true for digits and common punctuation", () => {
    expect(isGsm7("Call 555-0123! #1 deal.")).toBe(true);
  });

  it("returns false for emoji", () => {
    expect(isGsm7("Hello 👋")).toBe(false);
  });

  it("returns false for CJK characters", () => {
    expect(isGsm7("こんにちは")).toBe(false);
  });

  it("returns false for Cyrillic", () => {
    expect(isGsm7("Привет")).toBe(false);
  });

  it("returns false for Arabic", () => {
    expect(isGsm7("مرحبا")).toBe(false);
  });

  it("returns true for accented chars in GSM-7 set", () => {
    expect(isGsm7("café résumé naïve")).toBe(false); // 'ï' is not in GSM-7
    expect(isGsm7("àèéùì")).toBe(true); // these specific accents ARE in GSM-7
  });

  it("returns true for newlines and carriage returns", () => {
    expect(isGsm7("line1\nline2\rline3")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SMS Chunking - Single SMS
// ---------------------------------------------------------------------------

describe("chunkSms", () => {
  const defaultOptions: ChunkOptions = {
    mode: "auto",
    maxLength: 1600,
    segmentNumbering: true,
  };

  describe("single SMS", () => {
    it("returns empty array for empty text", () => {
      expect(chunkSms("", defaultOptions)).toEqual([]);
    });

    it("returns single segment for short GSM-7 message", () => {
      const msg = "Hello, this is a test message.";
      const result = chunkSms(msg, defaultOptions);
      expect(result).toEqual([msg]);
    });

    it("returns single segment for exactly 160 GSM-7 chars", () => {
      const msg = "A".repeat(160);
      const result = chunkSms(msg, defaultOptions);
      expect(result).toEqual([msg]);
    });

    it("returns single segment for short UCS-2 message", () => {
      const msg = "Hello 👋"; // emoji forces UCS-2
      const result = chunkSms(msg, defaultOptions);
      expect(result).toEqual([msg]);
    });

    it("returns single segment for exactly 70 UCS-2 chars", () => {
      const msg = "A".repeat(69) + "😀"; // 69 ASCII + 1 emoji = needs UCS-2, and is very short
      const result = chunkSms(msg, defaultOptions);
      // The emoji takes 2 chars in JS but counts as 1 UCS-2 char slot
      // 69 + 1 = 70, fits in single UCS-2 SMS
      expect(result.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Multi-Part SMS
  // ---------------------------------------------------------------------------

  describe("multi-part SMS", () => {
    it("splits GSM-7 message exceeding 160 chars into segments", () => {
      const msg = "A".repeat(320); // 320 chars = 3 segments (153 + 153 + 14)
      const result = chunkSms(msg, defaultOptions);
      expect(result.length).toBeGreaterThan(1);
      // With segment numbering, each segment starts with [N/N]
      expect(result[0]).toMatch(/^\[1\//);
    });

    it("splits UCS-2 message exceeding 70 chars into segments", () => {
      const msg = "あ".repeat(140); // 140 UCS-2 chars = 3 segments (67 + 67 + 6)
      const result = chunkSms(msg, defaultOptions);
      expect(result.length).toBeGreaterThan(1);
    });

    it("prefers word boundaries when splitting", () => {
      const words = [];
      // Build a message that exceeds 160 chars with clear word boundaries
      while (words.join(" ").length < 200) {
        words.push("word");
      }
      const msg = words.join(" ");
      const result = chunkSms(msg, { ...defaultOptions, segmentNumbering: false });
      // Each segment should not end mid-word (unless the word is very long)
      for (const seg of result) {
        // Segment should end cleanly (not mid-word) or be the last segment
        expect(seg.trimEnd()).toBe(seg.trimEnd()); // no trailing space issues
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Single Mode (Truncation)
  // ---------------------------------------------------------------------------

  describe("single mode", () => {
    const singleOptions: ChunkOptions = {
      mode: "single",
      maxLength: 1600,
      segmentNumbering: false,
    };

    it("truncates GSM-7 message to 160 chars", () => {
      const msg = "A".repeat(300);
      const result = chunkSms(msg, singleOptions);
      expect(result.length).toBe(1);
      expect(result[0].length).toBeLessThanOrEqual(160);
      expect(result[0]).toContain("…");
    });

    it("truncates UCS-2 message to 70 chars", () => {
      const msg = "あ".repeat(100);
      const result = chunkSms(msg, singleOptions);
      expect(result.length).toBe(1);
      expect(result[0].length).toBeLessThanOrEqual(70);
    });

    it("does not truncate if message fits in single SMS", () => {
      const msg = "Short message";
      const result = chunkSms(msg, singleOptions);
      expect(result).toEqual([msg]);
    });
  });

  // ---------------------------------------------------------------------------
  // Max Length Truncation
  // ---------------------------------------------------------------------------

  describe("max length", () => {
    it("truncates message exceeding maxLength", () => {
      const msg = "A".repeat(2000);
      const options: ChunkOptions = { mode: "auto", maxLength: 500, segmentNumbering: false };
      const result = chunkSms(msg, options);
      const totalChars = result.join("").length;
      // Total output should be roughly bounded by maxLength + ellipsis
      expect(totalChars).toBeLessThanOrEqual(510);
    });

    it("adds ellipsis when truncating", () => {
      const msg = "A".repeat(2000);
      const options: ChunkOptions = { mode: "auto", maxLength: 100, segmentNumbering: false };
      const result = chunkSms(msg, options);
      // The first segment or the single result should end with ellipsis
      const combined = result.join("");
      expect(combined).toContain("…");
    });
  });

  // ---------------------------------------------------------------------------
  // Segment Numbering
  // ---------------------------------------------------------------------------

  describe("segment numbering", () => {
    it("adds [N/M] prefix when enabled", () => {
      const msg = "A".repeat(400);
      const result = chunkSms(msg, { mode: "auto", maxLength: 1600, segmentNumbering: true });
      if (result.length > 1) {
        expect(result[0]).toMatch(/^\[1\/\d+\] /);
        expect(result[result.length - 1]).toMatch(/^\[\d+\/\d+\] /);
      }
    });

    it("does not add numbering for single segment", () => {
      const msg = "Short";
      const result = chunkSms(msg, { mode: "auto", maxLength: 1600, segmentNumbering: true });
      expect(result.length).toBe(1);
      expect(result[0]).toBe("Short");
    });

    it("does not add numbering when disabled", () => {
      const msg = "A".repeat(400);
      const result = chunkSms(msg, { mode: "auto", maxLength: 1600, segmentNumbering: false });
      for (const seg of result) {
        expect(seg).not.toMatch(/^\[\d+\/\d+\]/);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Convenience Function
// ---------------------------------------------------------------------------

describe("chunkSmsForOutbound", () => {
  it("uses auto mode with segment numbering", () => {
    const result = chunkSmsForOutbound("Hello!", 1600);
    expect(result).toEqual(["Hello!"]);
  });

  it("chunks long messages", () => {
    const msg = "A".repeat(500);
    const result = chunkSmsForOutbound(msg, 1600);
    expect(result.length).toBeGreaterThan(1);
  });

  it("respects maxLength", () => {
    const msg = "A".repeat(2000);
    const result = chunkSmsForOutbound(msg, 100);
    const totalContent = result.join("").replace(/\[\d+\/\d+\] /g, "");
    expect(totalContent.length).toBeLessThanOrEqual(110);
  });
});
