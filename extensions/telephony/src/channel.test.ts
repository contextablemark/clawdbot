import { describe, expect, it, beforeEach } from "vitest";
import { telephonyPlugin, setTelephonyProvider, setTelephonyConfig } from "./channel.js";
import { MockProvider } from "./providers/mock.js";
import type { TelephonyConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestConfig(): TelephonyConfig {
  return {
    enabled: true,
    provider: "mock",
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
  } as TelephonyConfig;
}

// ---------------------------------------------------------------------------
// Channel Plugin Metadata
// ---------------------------------------------------------------------------

describe("telephonyPlugin", () => {
  beforeEach(() => {
    const provider = new MockProvider();
    setTelephonyProvider(provider);
    setTelephonyConfig(createTestConfig());
  });

  it("has correct channel id", () => {
    expect(telephonyPlugin.id).toBe("telephony");
  });

  it("has correct meta", () => {
    expect(telephonyPlugin.meta.id).toBe("telephony");
    expect(telephonyPlugin.meta.label).toContain("Telephony");
    expect(telephonyPlugin.meta.aliases).toContain("sms");
    expect(telephonyPlugin.meta.aliases).toContain("phone");
  });

  it("declares pairing support", () => {
    expect(telephonyPlugin.pairing).toBeDefined();
    expect(telephonyPlugin.pairing?.idLabel).toBe("phoneNumber");
  });

  it("declares direct chat capability", () => {
    expect(telephonyPlugin.capabilities.chatTypes).toContain("direct");
  });

  it("supports media", () => {
    expect(telephonyPlugin.capabilities.media).toBe(true);
  });

  it("does not support reactions, polls, edit, unsend, reply, threads", () => {
    expect(telephonyPlugin.capabilities.reactions).toBe(false);
    expect(telephonyPlugin.capabilities.polls).toBe(false);
    expect(telephonyPlugin.capabilities.edit).toBe(false);
    expect(telephonyPlugin.capabilities.unsend).toBe(false);
    expect(telephonyPlugin.capabilities.reply).toBe(false);
    expect(telephonyPlugin.capabilities.threads).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Pairing
  // ---------------------------------------------------------------------------

  describe("pairing", () => {
    it("has normalizeAllowEntry that normalizes E.164", () => {
      const normalize = telephonyPlugin.pairing?.normalizeAllowEntry;
      expect(normalize).toBeDefined();
      // Valid E.164 should pass through
      if (normalize) {
        const result = normalize("+15550001234");
        expect(result).toBeTruthy();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Config Adapter
  // ---------------------------------------------------------------------------

  describe("config", () => {
    it("lists account IDs for single-account config", () => {
      const cfg = {
        channels: {
          telephony: {
            provider: "mock",
            fromNumber: "+15550001234",
          },
        },
      };
      const ids = telephonyPlugin.config.listAccountIds(cfg);
      expect(ids).toContain("default");
    });

    it("lists account IDs for multi-account config", () => {
      const cfg = {
        channels: {
          telephony: {
            accounts: {
              personal: { provider: "twilio", fromNumber: "+15550001111" },
              business: { provider: "telnyx", fromNumber: "+15550002222" },
            },
          },
        },
      };
      const ids = telephonyPlugin.config.listAccountIds(cfg);
      expect(ids).toContain("personal");
      expect(ids).toContain("business");
    });

    it("returns empty array when no telephony config", () => {
      const cfg = { channels: {} };
      const ids = telephonyPlugin.config.listAccountIds(cfg);
      expect(ids).toEqual([]);
    });

    it("resolves single-account config", () => {
      const cfg = {
        channels: {
          telephony: {
            enabled: true,
            provider: "mock",
            fromNumber: "+15550001234",
            dmPolicy: "pairing",
          },
        },
      };
      const account = telephonyPlugin.config.resolveAccount(cfg, "default");
      expect(account.enabled).toBe(true);
      expect(account.provider).toBe("mock");
      expect(account.fromNumber).toBe("+15550001234");
    });

    it("resolves multi-account config", () => {
      const cfg = {
        channels: {
          telephony: {
            accounts: {
              biz: {
                enabled: true,
                provider: "twilio",
                fromNumber: "+15550009999",
                name: "Business Line",
              },
            },
          },
        },
      };
      const account = telephonyPlugin.config.resolveAccount(cfg, "biz");
      expect(account.accountId).toBe("biz");
      expect(account.name).toBe("Business Line");
      expect(account.provider).toBe("twilio");
    });

    it("returns disabled account when no telephony section", () => {
      const cfg = { channels: {} };
      const account = telephonyPlugin.config.resolveAccount(cfg, "default");
      expect(account.enabled).toBe(false);
    });

    it("isEnabled returns true for enabled account", () => {
      const account = {
        accountId: "default",
        enabled: true,
        provider: "mock",
        fromNumber: "+15550001234",
      };
      expect(telephonyPlugin.config.isEnabled(account)).toBe(true);
    });

    it("isConfigured returns true when provider and fromNumber set", () => {
      const account = {
        accountId: "default",
        enabled: true,
        provider: "mock",
        fromNumber: "+15550001234",
      };
      expect(telephonyPlugin.config.isConfigured(account)).toBe(true);
    });

    it("isConfigured returns false when provider missing", () => {
      const account = {
        accountId: "default",
        enabled: true,
        fromNumber: "+15550001234",
      };
      expect(telephonyPlugin.config.isConfigured(account)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Security
  // ---------------------------------------------------------------------------

  describe("security", () => {
    it("resolves DM policy from account", () => {
      const account = {
        accountId: "default",
        enabled: true,
        provider: "mock",
        fromNumber: "+15550001234",
        dmPolicy: "allowlist",
        allowFrom: ["+15550009999"],
      };
      const cfg = { channels: { telephony: {} } };
      const result = telephonyPlugin.security.resolveDmPolicy({
        cfg,
        accountId: "default",
        account,
      });
      expect(result.policy).toBe("allowlist");
      expect(result.allowFrom).toContain("+15550009999");
    });

    it("defaults to pairing policy", () => {
      const account = { accountId: "default", enabled: true };
      const cfg = { channels: { telephony: {} } };
      const result = telephonyPlugin.security.resolveDmPolicy({
        cfg,
        accountId: "default",
        account,
      });
      expect(result.policy).toBe("pairing");
    });
  });

  // ---------------------------------------------------------------------------
  // Messaging
  // ---------------------------------------------------------------------------

  describe("messaging", () => {
    it("recognizes E.164 phone numbers", () => {
      const resolver = telephonyPlugin.messaging?.targetResolver;
      expect(resolver?.looksLikeId("+15550001234")).toBe(true);
      expect(resolver?.looksLikeId("+442071234567")).toBe(true);
    });

    it("rejects non-E.164 targets", () => {
      const resolver = telephonyPlugin.messaging?.targetResolver;
      expect(resolver?.looksLikeId("5550001234")).toBe(false);
      expect(resolver?.looksLikeId("hello")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Outbound
  // ---------------------------------------------------------------------------

  describe("outbound", () => {
    it("has direct delivery mode", () => {
      expect(telephonyPlugin.outbound.deliveryMode).toBe("direct");
    });

    it("resolves target from 'to' param", () => {
      const result = telephonyPlugin.outbound.resolveTarget({ to: "+15550005678" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.to).toBe("+15550005678");
      }
    });

    it("resolves target from single allowFrom entry", () => {
      const result = telephonyPlugin.outbound.resolveTarget({
        allowFrom: ["+15550009999"],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.to).toBe("+15550009999");
      }
    });

    it("fails when no target and multiple allowFrom", () => {
      const result = telephonyPlugin.outbound.resolveTarget({
        allowFrom: ["+15550001111", "+15550002222"],
      });
      expect(result.ok).toBe(false);
    });

    it("fails for invalid phone number", () => {
      const result = telephonyPlugin.outbound.resolveTarget({ to: "not-a-number" });
      expect(result.ok).toBe(false);
    });

    it("sendText sends via provider", async () => {
      const provider = new MockProvider();
      setTelephonyProvider(provider);

      const result = await telephonyPlugin.outbound.sendText({
        to: "+15550005678",
        text: "Test from channel",
        accountId: "default",
      });

      expect(result.ok).toBe(true);
      expect(result.channel).toBe("telephony");
      expect(provider.sentMessages).toHaveLength(1);
      expect(provider.sentMessages[0].body).toBe("Test from channel");
    });

    it("sendMedia sends MMS when mediaUrl provided", async () => {
      const provider = new MockProvider();
      setTelephonyProvider(provider);

      const result = await telephonyPlugin.outbound.sendMedia({
        to: "+15550005678",
        text: "Photo",
        mediaUrl: "https://example.com/photo.jpg",
        accountId: "default",
      });

      expect(result.ok).toBe(true);
      expect(provider.sentMessages).toHaveLength(1);
    });

    it("sendMedia falls back to SMS when no mediaUrl", async () => {
      const provider = new MockProvider();
      setTelephonyProvider(provider);

      const result = await telephonyPlugin.outbound.sendMedia({
        to: "+15550005678",
        text: "No media",
        accountId: "default",
      });

      expect(result.ok).toBe(true);
      expect(provider.sentMessages).toHaveLength(1);
      expect(provider.sentMessages[0].body).toBe("No media");
    });

    it("sendText throws when fromNumber not configured", async () => {
      const provider = new MockProvider();
      setTelephonyProvider(provider);
      setTelephonyConfig(null as unknown as TelephonyConfig);

      await expect(
        telephonyPlugin.outbound.sendText({ to: "+15550005678", text: "Fail" }),
      ).rejects.toThrow("fromNumber not configured");
    });
  });

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  describe("status", () => {
    it("has default runtime state", () => {
      expect(telephonyPlugin.status.defaultRuntime.running).toBe(false);
      expect(telephonyPlugin.status.defaultRuntime.connected).toBe(false);
    });

    it("resolves account state correctly", () => {
      expect(
        telephonyPlugin.status.resolveAccountState({ configured: false, enabled: true }),
      ).toBe("not configured");
      expect(
        telephonyPlugin.status.resolveAccountState({ configured: true, enabled: false }),
      ).toBe("disabled");
      expect(
        telephonyPlugin.status.resolveAccountState({ configured: true, enabled: true }),
      ).toBe("ready");
    });
  });
});
