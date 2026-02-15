import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TelephonyConfigSchema,
  resolveTelephonyConfig,
  validateProviderConfig,
  type TelephonyConfig,
} from "./config.js";

function createBaseConfig(provider: "twilio" | "telnyx" | "plivo" | "mock"): TelephonyConfig {
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
  };
}

// ---------------------------------------------------------------------------
// Schema Parsing
// ---------------------------------------------------------------------------

describe("TelephonyConfigSchema", () => {
  it("parses a valid minimal config", () => {
    const result = TelephonyConfigSchema.parse({
      enabled: true,
      provider: "mock",
      fromNumber: "+15550001234",
    });
    expect(result.enabled).toBe(true);
    expect(result.provider).toBe("mock");
    expect(result.fromNumber).toBe("+15550001234");
  });

  it("applies defaults for optional fields", () => {
    const result = TelephonyConfigSchema.parse({
      enabled: true,
      provider: "mock",
      fromNumber: "+15550001234",
    });
    expect(result.inboundPolicy).toBe("pairing");
    expect(result.allowFrom).toEqual([]);
    expect(result.sms.chunkMode).toBe("auto");
    expect(result.sms.maxLength).toBe(1600);
    expect(result.serve.port).toBe(3335);
    expect(result.skipSignatureVerification).toBe(false);
  });

  it("rejects invalid E.164 phone numbers", () => {
    expect(() =>
      TelephonyConfigSchema.parse({
        enabled: true,
        provider: "mock",
        fromNumber: "not-a-number",
      }),
    ).toThrow();
  });

  it("rejects invalid provider", () => {
    expect(() =>
      TelephonyConfigSchema.parse({
        enabled: true,
        provider: "invalid",
        fromNumber: "+15550001234",
      }),
    ).toThrow();
  });

  it("accepts all valid inbound policies", () => {
    for (const policy of ["disabled", "allowlist", "pairing", "open"]) {
      const result = TelephonyConfigSchema.parse({
        enabled: true,
        provider: "mock",
        fromNumber: "+15550001234",
        inboundPolicy: policy,
      });
      expect(result.inboundPolicy).toBe(policy);
    }
  });

  it("accepts valid E.164 formats", () => {
    const numbers = ["+15550001234", "+442071234567", "+8613800138000", "+61412345678"];
    for (const num of numbers) {
      const result = TelephonyConfigSchema.parse({
        enabled: true,
        provider: "mock",
        fromNumber: num,
      });
      expect(result.fromNumber).toBe(num);
    }
  });

  it("parses Twilio provider config", () => {
    const result = TelephonyConfigSchema.parse({
      enabled: true,
      provider: "twilio",
      fromNumber: "+15550001234",
      twilio: {
        accountSid: "AC123",
        authToken: "secret",
      },
    });
    expect(result.twilio?.accountSid).toBe("AC123");
    expect(result.twilio?.authToken).toBe("secret");
  });

  it("parses Telnyx provider config", () => {
    const result = TelephonyConfigSchema.parse({
      enabled: true,
      provider: "telnyx",
      fromNumber: "+15550001234",
      telnyx: {
        apiKey: "KEY123",
        messagingProfileId: "mp-123",
        publicKey: "pk-123",
      },
    });
    expect(result.telnyx?.apiKey).toBe("KEY123");
  });

  it("parses Plivo provider config", () => {
    const result = TelephonyConfigSchema.parse({
      enabled: true,
      provider: "plivo",
      fromNumber: "+15550001234",
      plivo: {
        authId: "MA123",
        authToken: "secret",
      },
    });
    expect(result.plivo?.authId).toBe("MA123");
  });

  it("parses SMS config overrides", () => {
    const result = TelephonyConfigSchema.parse({
      enabled: true,
      provider: "mock",
      fromNumber: "+15550001234",
      sms: {
        chunkMode: "single",
        maxLength: 160,
        segmentNumbering: false,
      },
    });
    expect(result.sms.chunkMode).toBe("single");
    expect(result.sms.maxLength).toBe(160);
    expect(result.sms.segmentNumbering).toBe(false);
  });

  it("parses voice config", () => {
    const result = TelephonyConfigSchema.parse({
      enabled: true,
      provider: "mock",
      fromNumber: "+15550001234",
      voice: {
        enabled: true,
        maxDurationSeconds: 600,
      },
    });
    expect(result.voice.enabled).toBe(true);
    expect(result.voice.maxDurationSeconds).toBe(600);
  });
});

// ---------------------------------------------------------------------------
// Provider Validation
// ---------------------------------------------------------------------------

describe("validateProviderConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TELNYX_API_KEY;
    delete process.env.TELNYX_PUBLIC_KEY;
    delete process.env.TELNYX_MESSAGING_PROFILE_ID;
    delete process.env.PLIVO_AUTH_ID;
    delete process.env.PLIVO_AUTH_TOKEN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("passes when disabled", () => {
    const config = createBaseConfig("twilio");
    config.enabled = false;
    const result = validateProviderConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails when enabled but no provider", () => {
    const config = createBaseConfig("mock");
    config.provider = undefined;
    const result = validateProviderConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("channels.telephony.provider is required");
  });

  it("fails when enabled but no fromNumber (non-mock)", () => {
    const config = createBaseConfig("twilio");
    config.fromNumber = undefined;
    config.twilio = { accountSid: "AC123", authToken: "secret" };
    const result = validateProviderConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("fromNumber"))).toBe(true);
  });

  it("does not require fromNumber for mock provider", () => {
    const config = createBaseConfig("mock");
    config.fromNumber = undefined;
    const result = validateProviderConfig(config);
    expect(result.valid).toBe(true);
  });

  // Twilio
  describe("twilio provider", () => {
    it("passes with credentials in config", () => {
      const config = createBaseConfig("twilio");
      config.twilio = { accountSid: "AC123", authToken: "secret" };
      const result = validateProviderConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("passes with credentials in env", () => {
      process.env.TWILIO_ACCOUNT_SID = "AC123";
      process.env.TWILIO_AUTH_TOKEN = "secret";
      let config = createBaseConfig("twilio");
      config = resolveTelephonyConfig(config);
      const result = validateProviderConfig(config);
      expect(result.valid).toBe(true);
    });

    it("fails without accountSid", () => {
      const config = createBaseConfig("twilio");
      config.twilio = { authToken: "secret" };
      const result = validateProviderConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("accountSid"))).toBe(true);
    });

    it("fails without authToken", () => {
      const config = createBaseConfig("twilio");
      config.twilio = { accountSid: "AC123" };
      const result = validateProviderConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("authToken"))).toBe(true);
    });
  });

  // Telnyx
  describe("telnyx provider", () => {
    it("passes with credentials in config", () => {
      const config = createBaseConfig("telnyx");
      config.telnyx = { apiKey: "KEY123", publicKey: "pk" };
      const result = validateProviderConfig(config);
      expect(result.valid).toBe(true);
    });

    it("passes with env variables", () => {
      process.env.TELNYX_API_KEY = "KEY123";
      process.env.TELNYX_PUBLIC_KEY = "pk";
      let config = createBaseConfig("telnyx");
      config = resolveTelephonyConfig(config);
      const result = validateProviderConfig(config);
      expect(result.valid).toBe(true);
    });

    it("fails without apiKey", () => {
      const config = createBaseConfig("telnyx");
      config.telnyx = { publicKey: "pk" };
      const result = validateProviderConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("apiKey"))).toBe(true);
    });

    it("fails without publicKey when verification enabled", () => {
      const config = createBaseConfig("telnyx");
      config.telnyx = { apiKey: "KEY123" };
      config.skipSignatureVerification = false;
      const result = validateProviderConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("publicKey"))).toBe(true);
    });

    it("passes without publicKey when verification skipped", () => {
      const config = createBaseConfig("telnyx");
      config.telnyx = { apiKey: "KEY123" };
      config.skipSignatureVerification = true;
      const result = validateProviderConfig(config);
      expect(result.valid).toBe(true);
    });
  });

  // Plivo
  describe("plivo provider", () => {
    it("passes with credentials in config", () => {
      const config = createBaseConfig("plivo");
      config.plivo = { authId: "MA123", authToken: "secret" };
      const result = validateProviderConfig(config);
      expect(result.valid).toBe(true);
    });

    it("passes with env variables", () => {
      process.env.PLIVO_AUTH_ID = "MA123";
      process.env.PLIVO_AUTH_TOKEN = "secret";
      let config = createBaseConfig("plivo");
      config = resolveTelephonyConfig(config);
      const result = validateProviderConfig(config);
      expect(result.valid).toBe(true);
    });

    it("fails without authId", () => {
      const config = createBaseConfig("plivo");
      config.plivo = { authToken: "secret" };
      const result = validateProviderConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("authId"))).toBe(true);
    });

    it("fails without authToken", () => {
      const config = createBaseConfig("plivo");
      config.plivo = { authId: "MA123" };
      const result = validateProviderConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("authToken"))).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Config Resolution (env var merging)
// ---------------------------------------------------------------------------

describe("resolveTelephonyConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;
    delete process.env.TELNYX_API_KEY;
    delete process.env.TELNYX_MESSAGING_PROFILE_ID;
    delete process.env.TELNYX_PUBLIC_KEY;
    delete process.env.PLIVO_AUTH_ID;
    delete process.env.PLIVO_AUTH_TOKEN;
    delete process.env.NGROK_AUTHTOKEN;
    delete process.env.NGROK_DOMAIN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("merges Twilio env vars into config", () => {
    process.env.TWILIO_ACCOUNT_SID = "AC_ENV";
    process.env.TWILIO_AUTH_TOKEN = "TOKEN_ENV";
    const config = createBaseConfig("twilio");
    const resolved = resolveTelephonyConfig(config);
    expect(resolved.twilio?.accountSid).toBe("AC_ENV");
    expect(resolved.twilio?.authToken).toBe("TOKEN_ENV");
  });

  it("does not overwrite config values with env vars", () => {
    process.env.TWILIO_ACCOUNT_SID = "AC_ENV";
    const config = createBaseConfig("twilio");
    config.twilio = { accountSid: "AC_CONFIG", authToken: "TOKEN_CONFIG" };
    const resolved = resolveTelephonyConfig(config);
    expect(resolved.twilio?.accountSid).toBe("AC_CONFIG");
    expect(resolved.twilio?.authToken).toBe("TOKEN_CONFIG");
  });

  it("merges Telnyx env vars", () => {
    process.env.TELNYX_API_KEY = "KEY_ENV";
    process.env.TELNYX_MESSAGING_PROFILE_ID = "MP_ENV";
    process.env.TELNYX_PUBLIC_KEY = "PK_ENV";
    const config = createBaseConfig("telnyx");
    const resolved = resolveTelephonyConfig(config);
    expect(resolved.telnyx?.apiKey).toBe("KEY_ENV");
    expect(resolved.telnyx?.messagingProfileId).toBe("MP_ENV");
    expect(resolved.telnyx?.publicKey).toBe("PK_ENV");
  });

  it("merges Plivo env vars", () => {
    process.env.PLIVO_AUTH_ID = "MA_ENV";
    process.env.PLIVO_AUTH_TOKEN = "TOKEN_ENV";
    const config = createBaseConfig("plivo");
    const resolved = resolveTelephonyConfig(config);
    expect(resolved.plivo?.authId).toBe("MA_ENV");
    expect(resolved.plivo?.authToken).toBe("TOKEN_ENV");
  });

  it("merges ngrok env vars into tunnel config", () => {
    process.env.NGROK_AUTHTOKEN = "ngrok_token";
    process.env.NGROK_DOMAIN = "my.ngrok.io";
    const config = createBaseConfig("mock");
    const resolved = resolveTelephonyConfig(config);
    expect(resolved.tunnel.ngrokAuthToken).toBe("ngrok_token");
    expect(resolved.tunnel.ngrokDomain).toBe("my.ngrok.io");
  });

  it("does not merge env vars for non-selected provider", () => {
    process.env.TWILIO_ACCOUNT_SID = "AC_ENV";
    const config = createBaseConfig("telnyx");
    const resolved = resolveTelephonyConfig(config);
    // Twilio section should not be populated since provider is telnyx
    expect(resolved.twilio).toBeUndefined();
  });
});
