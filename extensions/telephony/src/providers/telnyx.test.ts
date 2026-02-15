import { describe, expect, it, vi, afterEach } from "vitest";
import type { WebhookContext } from "../types.js";
import { TelnyxProvider } from "./telnyx.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createProvider(opts?: Partial<ConstructorParameters<typeof TelnyxProvider>[0]>) {
  return new TelnyxProvider({
    apiKey: "KEY_TEST",
    ...opts,
  });
}

function createContext(rawBody: string, overrides?: Partial<WebhookContext>): WebhookContext {
  return {
    headers: {},
    rawBody,
    url: "https://example.com/telephony/webhook",
    method: "POST",
    query: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Webhook Verification
// ---------------------------------------------------------------------------

describe("TelnyxProvider", () => {
  describe("verifyWebhook", () => {
    it("skips verification when configured", () => {
      const provider = createProvider({ skipSignatureVerification: true });
      const ctx = createContext("{}");

      expect(provider.verifyWebhook(ctx)).toEqual({ ok: true });
    });

    it("rejects when no public key is configured", () => {
      const provider = createProvider({ publicKey: undefined });
      const ctx = createContext("{}", {
        headers: {
          "telnyx-signature-ed25519": "sig",
          "telnyx-timestamp": String(Math.floor(Date.now() / 1000)),
        },
      });

      const result = provider.verifyWebhook(ctx);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("No Telnyx public key");
      }
    });

    it("rejects missing signature header", () => {
      const provider = createProvider({ publicKey: "pk" });
      const ctx = createContext("{}", {
        headers: { "telnyx-timestamp": String(Math.floor(Date.now() / 1000)) },
      });

      const result = provider.verifyWebhook(ctx);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("Missing telnyx-signature-ed25519");
      }
    });

    it("rejects missing timestamp header", () => {
      const provider = createProvider({ publicKey: "pk" });
      const ctx = createContext("{}", {
        headers: { "telnyx-signature-ed25519": "sig" },
      });

      const result = provider.verifyWebhook(ctx);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("Missing telnyx-timestamp");
      }
    });

    it("rejects timestamps older than 5 minutes", () => {
      const provider = createProvider({ publicKey: "pk" });
      const oldTimestamp = String(Math.floor(Date.now() / 1000) - 400); // 6+ minutes ago
      const ctx = createContext("{}", {
        headers: {
          "telnyx-signature-ed25519": "sig",
          "telnyx-timestamp": oldTimestamp,
        },
      });

      const result = provider.verifyWebhook(ctx);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("too old");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Inbound SMS Parsing
  // ---------------------------------------------------------------------------

  describe("parseInboundSms", () => {
    it("parses message.received event", () => {
      const provider = createProvider();
      const payload = {
        data: {
          id: "msg-123",
          event_type: "message.received",
          payload: {
            id: "msg-123",
            from: { phone_number: "+15550001234" },
            to: [{ phone_number: "+15550005678" }],
            text: "Hello from Telnyx!",
          },
        },
      };
      const ctx = createContext(JSON.stringify(payload));

      const result = provider.parseInboundSms(ctx);

      expect(result.events.length).toBe(1);
      expect(result.events[0].type).toBe("inbound_sms");
      if (result.events[0].type === "inbound_sms") {
        expect(result.events[0].from).toBe("+15550001234");
        expect(result.events[0].to).toBe("+15550005678");
        expect(result.events[0].body).toBe("Hello from Telnyx!");
        expect(result.events[0].messageId).toBe("msg-123");
      }
    });

    it("parses MMS with media", () => {
      const provider = createProvider();
      const payload = {
        data: {
          id: "mms-123",
          event_type: "message.received",
          payload: {
            id: "mms-123",
            from: { phone_number: "+15550001234" },
            to: [{ phone_number: "+15550005678" }],
            text: "Photo",
            media: [
              { url: "https://telnyx.com/img1.jpg" },
              { url: "https://telnyx.com/img2.png" },
            ],
          },
        },
      };
      const ctx = createContext(JSON.stringify(payload));

      const result = provider.parseInboundSms(ctx);

      expect(result.events.length).toBe(1);
      if (result.events[0].type === "inbound_sms") {
        expect(result.events[0].mediaUrls).toHaveLength(2);
        expect(result.events[0].mediaUrls?.[0]).toBe("https://telnyx.com/img1.jpg");
      }
    });

    it("parses message.delivered status", () => {
      const provider = createProvider();
      const payload = {
        data: {
          id: "msg-456",
          event_type: "message.delivered",
          payload: { id: "msg-456" },
        },
      };
      const ctx = createContext(JSON.stringify(payload));

      const result = provider.parseInboundSms(ctx);

      expect(result.events.length).toBe(1);
      expect(result.events[0].type).toBe("delivery_status");
      if (result.events[0].type === "delivery_status") {
        expect(result.events[0].status).toBe("delivered");
      }
    });

    it("parses message.sent status", () => {
      const provider = createProvider();
      const payload = {
        data: {
          id: "msg-789",
          event_type: "message.sent",
          payload: { id: "msg-789" },
        },
      };
      const ctx = createContext(JSON.stringify(payload));

      const result = provider.parseInboundSms(ctx);

      expect(result.events[0].type).toBe("delivery_status");
      if (result.events[0].type === "delivery_status") {
        expect(result.events[0].status).toBe("sent");
      }
    });

    it("parses message.failed with error details", () => {
      const provider = createProvider();
      const payload = {
        data: {
          id: "msg-err",
          event_type: "message.failed",
          payload: {
            id: "msg-err",
            errors: [{ code: "40001", title: "Invalid destination" }],
          },
        },
      };
      const ctx = createContext(JSON.stringify(payload));

      const result = provider.parseInboundSms(ctx);

      expect(result.events[0].type).toBe("delivery_status");
      if (result.events[0].type === "delivery_status") {
        expect(result.events[0].status).toBe("failed");
        expect(result.events[0].errorCode).toBe("40001");
        expect(result.events[0].errorMessage).toBe("Invalid destination");
      }
    });

    it("handles invalid JSON body", () => {
      const provider = createProvider();
      const ctx = createContext("not json");

      const result = provider.parseInboundSms(ctx);

      expect(result.events).toEqual([]);
      expect(result.statusCode).toBe(400);
    });

    it("handles empty data", () => {
      const provider = createProvider();
      const ctx = createContext(JSON.stringify({}));

      const result = provider.parseInboundSms(ctx);

      expect(result.events).toEqual([]);
    });

    it("handles unknown event type gracefully", () => {
      const provider = createProvider();
      const payload = {
        data: {
          id: "evt-unknown",
          event_type: "call.initiated",
          payload: {},
        },
      };
      const ctx = createContext(JSON.stringify(payload));

      const result = provider.parseInboundSms(ctx);

      expect(result.events).toEqual([]);
      expect(result.statusCode).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // Send SMS
  // ---------------------------------------------------------------------------

  describe("sendSms", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("sends SMS via Telnyx API", async () => {
      const provider = createProvider();
      let capturedBody: Record<string, unknown> = {};

      globalThis.fetch = vi.fn(async (_url, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify({ data: { id: "telnyx-msg-1", to: [{ status: "queued" }] } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch;

      const result = await provider.sendSms({
        to: "+15550005678",
        from: "+15550001234",
        body: "Hello via Telnyx!",
      });

      expect(result.messageId).toBe("telnyx-msg-1");
      expect(result.status).toBe("queued");
      expect(result.provider).toBe("telnyx");
      expect(capturedBody.to).toBe("+15550005678");
      expect(capturedBody.from).toBe("+15550001234");
      expect(capturedBody.text).toBe("Hello via Telnyx!");
      expect(capturedBody.type).toBe("SMS");
    });

    it("includes messaging profile ID when configured", async () => {
      const provider = createProvider({ messagingProfileId: "mp-123" });
      let capturedBody: Record<string, unknown> = {};

      globalThis.fetch = vi.fn(async (_url, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify({ data: { id: "telnyx-msg-2", to: [{ status: "queued" }] } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch;

      await provider.sendSms({
        to: "+15550005678",
        from: "+15550001234",
        body: "Test",
      });

      expect(capturedBody.messaging_profile_id).toBe("mp-123");
    });

    it("uses Bearer auth", async () => {
      const provider = createProvider();

      globalThis.fetch = vi.fn(async () =>
        new Response(
          JSON.stringify({ data: { id: "telnyx-msg-3", to: [{ status: "queued" }] } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ) as typeof fetch;

      await provider.sendSms({ to: "+15550005678", from: "+15550001234", body: "Test" });

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer KEY_TEST");
    });

    it("throws on API error", async () => {
      const provider = createProvider();

      globalThis.fetch = vi.fn(async () =>
        new Response("Forbidden", { status: 403 }),
      ) as typeof fetch;

      await expect(
        provider.sendSms({ to: "+15550005678", from: "+15550001234", body: "Test" }),
      ).rejects.toThrow("Telnyx SMS send failed (403)");
    });
  });

  // ---------------------------------------------------------------------------
  // Send MMS
  // ---------------------------------------------------------------------------

  describe("sendMms", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("sends MMS with media URLs and type MMS", async () => {
      const provider = createProvider();
      let capturedBody: Record<string, unknown> = {};

      globalThis.fetch = vi.fn(async (_url, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify({ data: { id: "telnyx-mms-1", to: [{ status: "queued" }] } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch;

      await provider.sendMms({
        to: "+15550005678",
        from: "+15550001234",
        body: "Media",
        mediaUrls: ["https://example.com/photo.jpg"],
      });

      expect(capturedBody.type).toBe("MMS");
      expect(capturedBody.media_urls).toEqual(["https://example.com/photo.jpg"]);
    });
  });
});
