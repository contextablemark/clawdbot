import crypto from "node:crypto";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { WebhookContext } from "../types.js";
import { TwilioProvider } from "./twilio.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createProvider(opts?: Partial<ConstructorParameters<typeof TwilioProvider>[0]>) {
  return new TwilioProvider({
    accountSid: "AC123",
    authToken: "test_auth_token",
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

function signTwilio(url: string, body: string, authToken: string): string {
  const params = new URLSearchParams(body);
  const sortedKeys = [...params.keys()].sort();
  let signingString = url;
  for (const key of sortedKeys) {
    signingString += key + params.get(key);
  }
  return crypto.createHmac("sha1", authToken).update(signingString).digest("base64");
}

// ---------------------------------------------------------------------------
// Webhook Verification
// ---------------------------------------------------------------------------

describe("TwilioProvider", () => {
  describe("verifyWebhook", () => {
    it("accepts valid HMAC-SHA1 signature", () => {
      const provider = createProvider();
      const body = "From=%2B15550001234&To=%2B15550005678&Body=Hello";
      const url = "https://example.com/telephony/webhook";
      const signature = signTwilio(url, body, "test_auth_token");

      const ctx = createContext(body, {
        url,
        headers: { "x-twilio-signature": signature },
      });

      expect(provider.verifyWebhook(ctx)).toEqual({ ok: true });
    });

    it("rejects invalid signature", () => {
      const provider = createProvider();
      const body = "From=%2B15550001234&Body=Hello";
      const ctx = createContext(body, {
        headers: { "x-twilio-signature": "invalid_signature_base64==" },
      });

      const result = provider.verifyWebhook(ctx);
      expect(result.ok).toBe(false);
    });

    it("rejects missing signature header", () => {
      const provider = createProvider();
      const ctx = createContext("From=%2B15550001234&Body=Hello");

      const result = provider.verifyWebhook(ctx);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("Missing");
      }
    });

    it("skips verification when configured", () => {
      const provider = createProvider({ skipSignatureVerification: true });
      const ctx = createContext("Body=test");

      expect(provider.verifyWebhook(ctx)).toEqual({ ok: true });
    });

    it("uses publicUrl for signature reconstruction", () => {
      const provider = createProvider({ publicUrl: "https://public.example.com" });
      const body = "From=%2B15550001234&Body=Hello";
      const publicUrl = "https://public.example.com/telephony/webhook";
      const signature = signTwilio(publicUrl, body, "test_auth_token");

      const ctx = createContext(body, {
        url: "http://127.0.0.1:3335/telephony/webhook",
        headers: { "x-twilio-signature": signature },
      });

      expect(provider.verifyWebhook(ctx)).toEqual({ ok: true });
    });
  });

  // ---------------------------------------------------------------------------
  // Inbound SMS Parsing
  // ---------------------------------------------------------------------------

  describe("parseInboundSms", () => {
    it("parses standard inbound SMS", () => {
      const provider = createProvider();
      const body =
        "MessageSid=SM123&From=%2B15550001234&To=%2B15550005678&Body=Hello+World&NumSegments=1";
      const ctx = createContext(body);

      const result = provider.parseInboundSms(ctx);

      expect(result.events.length).toBe(1);
      expect(result.events[0].type).toBe("inbound_sms");
      if (result.events[0].type === "inbound_sms") {
        expect(result.events[0].from).toBe("+15550001234");
        expect(result.events[0].to).toBe("+15550005678");
        expect(result.events[0].body).toBe("Hello World");
        expect(result.events[0].messageId).toBe("SM123");
        expect(result.events[0].numSegments).toBe(1);
      }
    });

    it("parses MMS with media", () => {
      const provider = createProvider();
      const body =
        "MessageSid=MM456&From=%2B15550001234&To=%2B15550005678&Body=Photo&NumMedia=2&MediaUrl0=https%3A%2F%2Fapi.twilio.com%2Fimg1.jpg&MediaUrl1=https%3A%2F%2Fapi.twilio.com%2Fimg2.jpg";
      const ctx = createContext(body);

      const result = provider.parseInboundSms(ctx);

      expect(result.events.length).toBe(1);
      if (result.events[0].type === "inbound_sms") {
        expect(result.events[0].mediaUrls).toHaveLength(2);
        expect(result.events[0].mediaUrls?.[0]).toBe("https://api.twilio.com/img1.jpg");
      }
    });

    it("parses delivery status callback", () => {
      const provider = createProvider();
      const body = "MessageSid=SM789&MessageStatus=delivered";
      const ctx = createContext(body);

      const result = provider.parseInboundSms(ctx);

      expect(result.events.length).toBe(1);
      expect(result.events[0].type).toBe("delivery_status");
      if (result.events[0].type === "delivery_status") {
        expect(result.events[0].messageId).toBe("SM789");
        expect(result.events[0].status).toBe("delivered");
      }
    });

    it("parses failed delivery with error", () => {
      const provider = createProvider();
      const body =
        "MessageSid=SM111&MessageStatus=failed&ErrorCode=30006&ErrorMessage=Landline+or+unreachable";
      const ctx = createContext(body);

      const result = provider.parseInboundSms(ctx);

      expect(result.events.length).toBe(1);
      if (result.events[0].type === "delivery_status") {
        expect(result.events[0].status).toBe("failed");
        expect(result.events[0].errorCode).toBe("30006");
      }
    });

    it("returns empty TwiML response", () => {
      const provider = createProvider();
      const body = "MessageSid=SM123&From=%2B15550001234&Body=Test";
      const ctx = createContext(body);

      const result = provider.parseInboundSms(ctx);

      expect(result.responseBody).toBe("<Response></Response>");
      expect(result.responseHeaders?.["Content-Type"]).toBe("application/xml");
      expect(result.statusCode).toBe(200);
    });

    it("handles empty webhook body", () => {
      const provider = createProvider();
      const ctx = createContext("");

      const result = provider.parseInboundSms(ctx);

      expect(result.events).toEqual([]);
    });

    it("uses SmsSid as fallback for MessageSid", () => {
      const provider = createProvider();
      const body = "SmsSid=SM_LEGACY&From=%2B15550001234&Body=Legacy+format";
      const ctx = createContext(body);

      const result = provider.parseInboundSms(ctx);

      expect(result.events.length).toBe(1);
      if (result.events[0].type === "inbound_sms") {
        expect(result.events[0].messageId).toBe("SM_LEGACY");
      }
    });

    it("maps all Twilio status values correctly", () => {
      const provider = createProvider();
      const statuses = [
        { input: "queued", expected: "queued" },
        { input: "sending", expected: "sending" },
        { input: "sent", expected: "sent" },
        { input: "delivered", expected: "delivered" },
        { input: "undelivered", expected: "undelivered" },
        { input: "failed", expected: "failed" },
        { input: "accepted", expected: "queued" },
        { input: "unknown_status", expected: "unknown" },
      ];

      for (const { input, expected } of statuses) {
        const body = `MessageSid=SM_TEST&MessageStatus=${input}`;
        const ctx = createContext(body);
        const result = provider.parseInboundSms(ctx);
        if (result.events[0]?.type === "delivery_status") {
          expect(result.events[0].status).toBe(expected);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Send SMS (mocked fetch)
  // ---------------------------------------------------------------------------

  describe("sendSms", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("sends SMS via Twilio REST API", async () => {
      const provider = createProvider();
      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;

      globalThis.fetch = vi.fn(async (url, init) => {
        capturedUrl = String(url);
        capturedInit = init;
        return new Response(
          JSON.stringify({ sid: "SM_SENT", status: "queued", num_segments: "1" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch;

      const result = await provider.sendSms({
        to: "+15550005678",
        from: "+15550001234",
        body: "Test message",
      });

      expect(result.messageId).toBe("SM_SENT");
      expect(result.status).toBe("queued");
      expect(result.provider).toBe("twilio");
      expect(result.segments).toBe(1);
      expect(capturedUrl).toContain("/Accounts/AC123/Messages.json");
      expect(capturedInit?.method).toBe("POST");

      const bodyStr = capturedInit?.body as string;
      const params = new URLSearchParams(bodyStr);
      expect(params.get("To")).toBe("+15550005678");
      expect(params.get("From")).toBe("+15550001234");
      expect(params.get("Body")).toBe("Test message");
    });

    it("uses MessagingServiceSid when configured", async () => {
      const provider = createProvider({ messagingServiceSid: "MG_SERVICE" });

      globalThis.fetch = vi.fn(async () =>
        new Response(
          JSON.stringify({ sid: "SM_SVC", status: "queued", num_segments: "1" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ) as typeof fetch;

      await provider.sendSms({
        to: "+15550005678",
        from: "+15550001234",
        body: "Test",
      });

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const bodyStr = call[1]?.body as string;
      const params = new URLSearchParams(bodyStr);
      expect(params.get("MessagingServiceSid")).toBe("MG_SERVICE");
      expect(params.has("From")).toBe(false);
    });

    it("includes status callback URL when provided", async () => {
      const provider = createProvider();

      globalThis.fetch = vi.fn(async () =>
        new Response(
          JSON.stringify({ sid: "SM_CB", status: "queued", num_segments: "1" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ) as typeof fetch;

      await provider.sendSms({
        to: "+15550005678",
        from: "+15550001234",
        body: "Test",
        statusCallback: "https://example.com/status",
      });

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const bodyStr = call[1]?.body as string;
      const params = new URLSearchParams(bodyStr);
      expect(params.get("StatusCallback")).toBe("https://example.com/status");
    });

    it("throws on API error", async () => {
      const provider = createProvider();

      globalThis.fetch = vi.fn(async () =>
        new Response("Unauthorized", { status: 401 }),
      ) as typeof fetch;

      await expect(
        provider.sendSms({ to: "+15550005678", from: "+15550001234", body: "Test" }),
      ).rejects.toThrow("Twilio SMS send failed (401)");
    });

    it("includes Basic auth header", async () => {
      const provider = createProvider();

      globalThis.fetch = vi.fn(async () =>
        new Response(
          JSON.stringify({ sid: "SM_AUTH", status: "queued", num_segments: "1" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ) as typeof fetch;

      await provider.sendSms({ to: "+15550005678", from: "+15550001234", body: "Test" });

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const headers = call[1]?.headers as Record<string, string>;
      const expected = `Basic ${Buffer.from("AC123:test_auth_token").toString("base64")}`;
      expect(headers.Authorization).toBe(expected);
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

    it("sends MMS with media URLs", async () => {
      const provider = createProvider();

      globalThis.fetch = vi.fn(async () =>
        new Response(
          JSON.stringify({ sid: "MM_SENT", status: "queued", num_segments: "1" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ) as typeof fetch;

      const result = await provider.sendMms({
        to: "+15550005678",
        from: "+15550001234",
        body: "Check this out",
        mediaUrls: ["https://example.com/photo.jpg"],
      });

      expect(result.messageId).toBe("MM_SENT");

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const bodyStr = call[1]?.body as string;
      const params = new URLSearchParams(bodyStr);
      expect(params.get("MediaUrl")).toBe("https://example.com/photo.jpg");
    });
  });

  // ---------------------------------------------------------------------------
  // Voice Call Initiation
  // ---------------------------------------------------------------------------

  describe("initiateCall", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("initiates a call via Twilio REST API", async () => {
      const provider = createProvider();

      globalThis.fetch = vi.fn(async () =>
        new Response(
          JSON.stringify({ sid: "CA_CALL", status: "queued" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ) as typeof fetch;

      const result = await provider.initiateCall({
        to: "+15550005678",
        from: "+15550001234",
      });

      expect(result.callId).toBe("CA_CALL");
      expect(result.status).toBe("queued");
      expect(result.provider).toBe("twilio");

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const url = String(call[0]);
      expect(url).toContain("/Calls.json");
    });
  });
});
