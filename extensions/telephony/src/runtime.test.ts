import { describe, expect, it } from "vitest";
import type { TelephonyConfig } from "./config.js";
import { createProvider } from "./runtime.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestConfig(provider: TelephonyConfig["provider"]): TelephonyConfig {
  return {
    enabled: true,
    provider,
    fromNumber: "+15550001234",
    inboundPolicy: "pairing",
    allowFrom: [],
    sms: { chunkMode: "auto", maxLength: 1600, segmentNumbering: true },
    voice: { enabled: false, maxDurationSeconds: 300 },
    serve: { port: 3335, bind: "127.0.0.1", path: "/telephony/webhook", statusPath: "/telephony/status" },
    tunnel: { provider: "none" },
    webhookSecurity: { allowedHosts: [], trustForwardingHeaders: false, trustedProxyIPs: [] },
    skipSignatureVerification: false,
    maxConcurrentSessions: 50,
    twilio: { accountSid: "AC123", authToken: "secret" },
    telnyx: { apiKey: "KEY123" },
    plivo: { authId: "MA123", authToken: "secret" },
  } as TelephonyConfig;
}

// ---------------------------------------------------------------------------
// createProvider
// ---------------------------------------------------------------------------

describe("createProvider", () => {
  it("creates TwilioProvider for 'twilio'", () => {
    const config = createTestConfig("twilio");
    const provider = createProvider(config);
    expect(provider.name).toBe("twilio");
  });

  it("creates TelnyxProvider for 'telnyx'", () => {
    const config = createTestConfig("telnyx");
    const provider = createProvider(config);
    expect(provider.name).toBe("telnyx");
  });

  it("creates PlivoProvider for 'plivo'", () => {
    const config = createTestConfig("plivo");
    const provider = createProvider(config);
    expect(provider.name).toBe("plivo");
  });

  it("creates MockProvider for 'mock'", () => {
    const config = createTestConfig("mock");
    const provider = createProvider(config);
    expect(provider.name).toBe("mock");
  });

  it("throws for unknown provider", () => {
    const config = createTestConfig("mock");
    (config as Record<string, unknown>).provider = "unknown";
    expect(() => createProvider(config)).toThrow("Unknown telephony provider");
  });

  it("throws when Twilio credentials are missing", () => {
    const config = createTestConfig("twilio");
    config.twilio = undefined;
    expect(() => createProvider(config)).toThrow("Twilio accountSid and authToken are required");
  });

  it("throws when Telnyx API key is missing", () => {
    const config = createTestConfig("telnyx");
    config.telnyx = undefined;
    expect(() => createProvider(config)).toThrow("Telnyx apiKey is required");
  });

  it("throws when Plivo credentials are missing", () => {
    const config = createTestConfig("plivo");
    config.plivo = undefined;
    expect(() => createProvider(config)).toThrow("Plivo authId and authToken are required");
  });
});
