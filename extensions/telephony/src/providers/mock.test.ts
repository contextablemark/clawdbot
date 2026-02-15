import { describe, expect, it } from "vitest";
import { MockProvider } from "./mock.js";

// ---------------------------------------------------------------------------
// Mock Provider Tests
// ---------------------------------------------------------------------------

describe("MockProvider", () => {
  it("has name 'mock'", () => {
    const provider = new MockProvider();
    expect(provider.name).toBe("mock");
  });

  describe("verifyWebhook", () => {
    it("always returns ok", () => {
      const provider = new MockProvider();
      const result = provider.verifyWebhook({
        headers: {},
        rawBody: "",
        url: "http://localhost/webhook",
        method: "POST",
        query: {},
      });
      expect(result).toEqual({ ok: true });
    });
  });

  describe("parseInboundSms", () => {
    it("parses JSON body as inbound message", () => {
      const provider = new MockProvider();
      const result = provider.parseInboundSms({
        headers: {},
        rawBody: JSON.stringify({
          messageId: "test-1",
          from: "+15550009999",
          to: "+15550001111",
          body: "Test message",
        }),
        url: "http://localhost/webhook",
        method: "POST",
        query: {},
      });

      expect(result.events.length).toBe(1);
      expect(result.events[0].type).toBe("inbound_sms");
      if (result.events[0].type === "inbound_sms") {
        expect(result.events[0].from).toBe("+15550009999");
        expect(result.events[0].to).toBe("+15550001111");
        expect(result.events[0].body).toBe("Test message");
        expect(result.events[0].messageId).toBe("test-1");
      }
    });

    it("generates messageId if not provided", () => {
      const provider = new MockProvider();
      const result = provider.parseInboundSms({
        headers: {},
        rawBody: JSON.stringify({ body: "Hello" }),
        url: "http://localhost/webhook",
        method: "POST",
        query: {},
      });

      expect(result.events.length).toBe(1);
      if (result.events[0].type === "inbound_sms") {
        expect(result.events[0].messageId).toMatch(/^mock-/);
      }
    });

    it("handles invalid JSON gracefully", () => {
      const provider = new MockProvider();
      const result = provider.parseInboundSms({
        headers: {},
        rawBody: "not json",
        url: "http://localhost/webhook",
        method: "POST",
        query: {},
      });

      expect(result.events).toEqual([]);
      expect(result.statusCode).toBe(200);
    });

    it("uses 'text' field as fallback for 'body'", () => {
      const provider = new MockProvider();
      const result = provider.parseInboundSms({
        headers: {},
        rawBody: JSON.stringify({ text: "Via text field" }),
        url: "http://localhost/webhook",
        method: "POST",
        query: {},
      });

      if (result.events[0]?.type === "inbound_sms") {
        expect(result.events[0].body).toBe("Via text field");
      }
    });
  });

  describe("sendSms", () => {
    it("returns a mock message ID", async () => {
      const provider = new MockProvider();
      const result = await provider.sendSms({
        to: "+15550005678",
        from: "+15550001234",
        body: "Hello!",
      });

      expect(result.messageId).toMatch(/^mock-msg-/);
      expect(result.status).toBe("sent");
      expect(result.provider).toBe("mock");
      expect(result.segments).toBe(1);
    });

    it("logs sent messages for inspection", async () => {
      const provider = new MockProvider();
      await provider.sendSms({ to: "+1", from: "+2", body: "msg1" });
      await provider.sendSms({ to: "+3", from: "+4", body: "msg2" });

      expect(provider.sentMessages).toHaveLength(2);
      expect(provider.sentMessages[0].body).toBe("msg1");
      expect(provider.sentMessages[1].body).toBe("msg2");
    });

    it("increments message counter", async () => {
      const provider = new MockProvider();
      const r1 = await provider.sendSms({ to: "+1", from: "+2", body: "a" });
      const r2 = await provider.sendSms({ to: "+1", from: "+2", body: "b" });

      expect(r1.messageId).toBe("mock-msg-1");
      expect(r2.messageId).toBe("mock-msg-2");
    });
  });

  describe("sendMms", () => {
    it("returns a mock MMS ID", async () => {
      const provider = new MockProvider();
      const result = await provider.sendMms({
        to: "+15550005678",
        from: "+15550001234",
        body: "Photo",
        mediaUrls: ["https://example.com/img.jpg"],
      });

      expect(result.messageId).toMatch(/^mock-mms-/);
      expect(result.status).toBe("sent");
    });

    it("logs sent MMS for inspection", async () => {
      const provider = new MockProvider();
      await provider.sendMms({
        to: "+1",
        from: "+2",
        body: "img",
        mediaUrls: ["https://example.com/a.jpg"],
      });

      expect(provider.sentMessages).toHaveLength(1);
    });
  });

  describe("initiateCall", () => {
    it("returns a mock call ID", async () => {
      const provider = new MockProvider();
      const result = await provider.initiateCall({
        to: "+15550005678",
        from: "+15550001234",
      });

      expect(result.callId).toMatch(/^mock-call-/);
      expect(result.status).toBe("initiated");
      expect(result.provider).toBe("mock");
    });

    it("logs initiated calls", async () => {
      const provider = new MockProvider();
      await provider.initiateCall({ to: "+1", from: "+2" });
      await provider.initiateCall({ to: "+3", from: "+4" });

      expect(provider.initiatedCalls).toHaveLength(2);
    });
  });
});
