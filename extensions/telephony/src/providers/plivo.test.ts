import crypto from "node:crypto";
import { describe, expect, it, vi, afterEach } from "vitest";
import type { WebhookContext } from "../types.js";
import { PlivoProvider } from "./plivo.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createProvider(opts?: Partial<ConstructorParameters<typeof PlivoProvider>[0]>) {
  return new PlivoProvider({
    authId: "MA_TEST",
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

function signPlivo(url: string, nonce: string, body: string, authToken: string): string {
  const signingString = url + nonce + body;
  return crypto.createHmac("sha256", authToken).update(signingString).digest("base64");
}

// ---------------------------------------------------------------------------
// Webhook Verification
// ---------------------------------------------------------------------------

describe("PlivoProvider", () => {
  describe("verifyWebhook", () => {
    it("accepts valid HMAC-SHA256 V3 signature", () => {
      const provider = createProvider();
      const body = "From=%2B15550001234&To=%2B15550005678&Text=Hello";
      const url = "https://example.com/telephony/webhook";
      const nonce = "test-nonce-123";
      const signature = signPlivo(url, nonce, body, "test_auth_token");

      const ctx = createContext(body, {
        url,
        headers: {
          "x-plivo-signature-v3": signature,
          "x-plivo-signature-v3-nonce": nonce,
        },
      });

      expect(provider.verifyWebhook(ctx)).toEqual({ ok: true });
    });

    it("rejects invalid signature", () => {
      const provider = createProvider();
      const ctx = createContext("From=test", {
        headers: {
          "x-plivo-signature-v3": "invalid_sig==",
          "x-plivo-signature-v3-nonce": "nonce",
        },
      });

      const result = provider.verifyWebhook(ctx);
      expect(result.ok).toBe(false);
    });

    it("rejects missing signature header", () => {
      const provider = createProvider();
      const ctx = createContext("Body=test", {
        headers: { "x-plivo-signature-v3-nonce": "nonce" },
      });

      const result = provider.verifyWebhook(ctx);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("Missing X-Plivo-Signature-V3");
      }
    });

    it("rejects missing nonce header", () => {
      const provider = createProvider();
      const ctx = createContext("Body=test", {
        headers: { "x-plivo-signature-v3": "sig" },
      });

      const result = provider.verifyWebhook(ctx);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("Missing X-Plivo-Signature-V3-Nonce");
      }
    });

    it("skips verification when configured", () => {
      const provider = createProvider({ skipSignatureVerification: true });
      const ctx = createContext("Body=test");

      expect(provider.verifyWebhook(ctx)).toEqual({ ok: true });
    });

    it("uses publicUrl for signature reconstruction", () => {
      const provider = createProvider({ publicUrl: "https://public.example.com" });
      const body = "From=%2B15550001234&Text=Hello";
      const nonce = "nonce-456";
      const publicUrl = "https://public.example.com/telephony/webhook";
      const signature = signPlivo(publicUrl, nonce, body, "test_auth_token");

      const ctx = createContext(body, {
        url: "http://127.0.0.1:3335/telephony/webhook",
        headers: {
          "x-plivo-signature-v3": signature,
          "x-plivo-signature-v3-nonce": nonce,
        },
      });

      expect(provider.verifyWebhook(ctx)).toEqual({ ok: true });
    });
  });

  // ---------------------------------------------------------------------------
  // Inbound SMS Parsing
  // ---------------------------------------------------------------------------

  describe("parseInboundSms", () => {
    it("parses form-urlencoded inbound SMS", () => {
      const provider = createProvider();
      const body = "From=%2B15550001234&To=%2B15550005678&Text=Hello+Plivo&MessageUUID=plivo-msg-1";
      const ctx = createContext(body, {
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });

      const result = provider.parseInboundSms(ctx);

      expect(result.events.length).toBe(1);
      expect(result.events[0].type).toBe("inbound_sms");
      if (result.events[0].type === "inbound_sms") {
        expect(result.events[0].from).toBe("+15550001234");
        expect(result.events[0].to).toBe("+15550005678");
        expect(result.events[0].body).toBe("Hello Plivo");
        expect(result.events[0].messageId).toBe("plivo-msg-1");
      }
    });

    it("parses JSON inbound SMS", () => {
      const provider = createProvider();
      const body = JSON.stringify({
        From: "+15550001234",
        To: "+15550005678",
        Text: "JSON format",
        MessageUUID: "plivo-json-1",
      });
      const ctx = createContext(body, {
        headers: { "content-type": "application/json" },
      });

      const result = provider.parseInboundSms(ctx);

      expect(result.events.length).toBe(1);
      if (result.events[0].type === "inbound_sms") {
        expect(result.events[0].body).toBe("JSON format");
      }
    });

    it("parses delivery status report (form-encoded)", () => {
      const provider = createProvider();
      const body = "MessageUUID=plivo-dlr-1&Status=delivered&Type=dlr";
      const ctx = createContext(body, {
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });

      const result = provider.parseInboundSms(ctx);

      expect(result.events.length).toBe(1);
      expect(result.events[0].type).toBe("delivery_status");
      if (result.events[0].type === "delivery_status") {
        expect(result.events[0].messageId).toBe("plivo-dlr-1");
        expect(result.events[0].status).toBe("delivered");
      }
    });

    it("parses MMS with media URLs", () => {
      const provider = createProvider();
      const body =
        "From=%2B15550001234&To=%2B15550005678&Text=MMS&MessageUUID=plivo-mms-1&MediaUrls=https%3A%2F%2Fcdn.plivo.com%2Fimg1.jpg%2Chttps%3A%2F%2Fcdn.plivo.com%2Fimg2.jpg";
      const ctx = createContext(body, {
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });

      const result = provider.parseInboundSms(ctx);

      expect(result.events.length).toBe(1);
      if (result.events[0].type === "inbound_sms") {
        expect(result.events[0].mediaUrls).toHaveLength(2);
      }
    });

    it("returns XML response", () => {
      const provider = createProvider();
      const body = "From=%2B15550001234&Text=Test&MessageUUID=plivo-msg-2";
      const ctx = createContext(body);

      const result = provider.parseInboundSms(ctx);

      expect(result.responseBody).toBe("<Response></Response>");
      expect(result.responseHeaders?.["Content-Type"]).toBe("application/xml");
    });

    it("handles empty body gracefully", () => {
      const provider = createProvider();
      const ctx = createContext("");

      const result = provider.parseInboundSms(ctx);

      expect(result.events).toEqual([]);
    });

    it("maps Plivo statuses correctly", () => {
      const provider = createProvider();
      const statuses = [
        { input: "queued", expected: "queued" },
        { input: "sent", expected: "sent" },
        { input: "delivered", expected: "delivered" },
        { input: "undelivered", expected: "undelivered" },
        { input: "failed", expected: "failed" },
        { input: "rejected", expected: "failed" },
        { input: "something_else", expected: "unknown" },
      ];

      for (const { input, expected } of statuses) {
        const body = `MessageUUID=plivo-st&Status=${input}&Type=dlr`;
        const ctx = createContext(body, {
          headers: { "content-type": "application/x-www-form-urlencoded" },
        });
        const result = provider.parseInboundSms(ctx);
        if (result.events[0]?.type === "delivery_status") {
          expect(result.events[0].status).toBe(expected);
        }
      }
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

    it("sends SMS via Plivo REST API", async () => {
      const provider = createProvider();
      let capturedBody: Record<string, unknown> = {};
      let capturedUrl = "";

      globalThis.fetch = vi.fn(async (url, init) => {
        capturedUrl = String(url);
        capturedBody = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify({ message_uuid: ["plivo-sent-1"], message: "message(s) queued" }),
          { status: 202, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch;

      const result = await provider.sendSms({
        to: "+15550005678",
        from: "+15550001234",
        body: "Hello via Plivo!",
      });

      expect(result.messageId).toBe("plivo-sent-1");
      expect(result.status).toBe("queued");
      expect(result.provider).toBe("plivo");
      expect(capturedUrl).toContain("/Account/MA_TEST/Message/");
      expect(capturedBody.src).toBe("+15550001234");
      expect(capturedBody.dst).toBe("+15550005678");
      expect(capturedBody.text).toBe("Hello via Plivo!");
    });

    it("uses Basic auth with authId:authToken", async () => {
      const provider = createProvider();

      globalThis.fetch = vi.fn(async () =>
        new Response(
          JSON.stringify({ message_uuid: ["msg-auth"], message: "queued" }),
          { status: 202, headers: { "Content-Type": "application/json" } },
        ),
      ) as typeof fetch;

      await provider.sendSms({ to: "+15550005678", from: "+15550001234", body: "Test" });

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const headers = call[1]?.headers as Record<string, string>;
      const expected = `Basic ${Buffer.from("MA_TEST:test_auth_token").toString("base64")}`;
      expect(headers.Authorization).toBe(expected);
    });

    it("throws on API error", async () => {
      const provider = createProvider();

      globalThis.fetch = vi.fn(async () =>
        new Response("Bad Request", { status: 400 }),
      ) as typeof fetch;

      await expect(
        provider.sendSms({ to: "+15550005678", from: "+15550001234", body: "Test" }),
      ).rejects.toThrow("Plivo SMS send failed (400)");
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

    it("initiates a call via Plivo API", async () => {
      const provider = createProvider();
      let capturedBody: Record<string, unknown> = {};

      globalThis.fetch = vi.fn(async (_url, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify({ request_uuid: "plivo-call-1", message: "call fired" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch;

      const result = await provider.initiateCall({
        to: "+15550005678",
        from: "+15550001234",
      });

      expect(result.callId).toBe("plivo-call-1");
      expect(result.status).toBe("initiated");
      expect(result.provider).toBe("plivo");
      expect(capturedBody.from).toBe("+15550001234");
      expect(capturedBody.to).toBe("<+15550005678>");
    });
  });
});
