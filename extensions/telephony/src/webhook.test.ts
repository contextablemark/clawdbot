import http from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TelephonyConfig } from "./config.js";
import type { NormalizedSmsEvent } from "./types.js";
import { MockProvider } from "./providers/mock.js";
import { TelephonyWebhookServer } from "./webhook.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestConfig(overrides?: Partial<TelephonyConfig>): TelephonyConfig {
  return {
    enabled: true,
    provider: "mock",
    fromNumber: "+15550001234",
    inboundPolicy: "pairing",
    allowFrom: [],
    sms: { chunkMode: "auto", maxLength: 1600, segmentNumbering: true },
    voice: { enabled: false, maxDurationSeconds: 300 },
    serve: { port: 0, bind: "127.0.0.1", path: "/telephony/webhook", statusPath: "/telephony/status" },
    tunnel: { provider: "none" },
    webhookSecurity: { allowedHosts: [], trustForwardingHeaders: false, trustedProxyIPs: [] },
    skipSignatureVerification: false,
    maxConcurrentSessions: 50,
    ...overrides,
  } as TelephonyConfig;
}

function postToServer(
  port: number,
  path: string,
  body: string,
  headers?: Record<string, string>,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ statusCode: res.statusCode ?? 500, body: data }));
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function getFromServer(
  port: number,
  path: string,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method: "GET" },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ statusCode: res.statusCode ?? 500, body: data }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TelephonyWebhookServer", () => {
  let server: TelephonyWebhookServer;
  let port: number;
  let receivedEvents: NormalizedSmsEvent[];

  beforeAll(async () => {
    receivedEvents = [];
    const config = createTestConfig();
    const provider = new MockProvider();

    server = new TelephonyWebhookServer(config, provider, (event) => {
      receivedEvents.push(event);
    });

    // Use port 0 for random available port
    const localUrl = await server.start();
    const match = localUrl.match(/:(\d+)/);
    port = match ? parseInt(match[1], 10) : 3335;
  });

  afterAll(async () => {
    await server.stop();
  });

  it("responds to health check", async () => {
    const res = await getFromServer(port, "/health");
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.provider).toBe("mock");
  });

  it("rejects GET requests to webhook path", async () => {
    const res = await getFromServer(port, "/telephony/webhook");
    expect(res.statusCode).toBe(405);
  });

  it("returns 404 for unknown paths", async () => {
    const res = await postToServer(port, "/unknown/path", "test");
    expect(res.statusCode).toBe(404);
  });

  it("accepts POST to webhook path and processes events", async () => {
    receivedEvents.length = 0;
    const body = JSON.stringify({
      messageId: "webhook-test-1",
      from: "+15550009999",
      to: "+15550001234",
      body: "Webhook test",
    });

    const res = await postToServer(port, "/telephony/webhook", body, {
      "Content-Type": "application/json",
    });

    expect(res.statusCode).toBe(200);
    expect(receivedEvents.length).toBe(1);
    expect(receivedEvents[0].type).toBe("inbound_sms");
    if (receivedEvents[0].type === "inbound_sms") {
      expect(receivedEvents[0].body).toBe("Webhook test");
    }
  });

  it("accepts POST to status path", async () => {
    receivedEvents.length = 0;
    const body = JSON.stringify({
      messageId: "status-test-1",
      from: "+15550009999",
      body: "Status check",
    });

    const res = await postToServer(port, "/telephony/status", body, {
      "Content-Type": "application/json",
    });

    expect(res.statusCode).toBe(200);
  });

  it("handles empty JSON body", async () => {
    const res = await postToServer(port, "/telephony/webhook", "{}", {
      "Content-Type": "application/json",
    });

    expect(res.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Signature Verification Integration
// ---------------------------------------------------------------------------

describe("TelephonyWebhookServer signature verification", () => {
  it("rejects requests when provider verification fails", async () => {
    const events: NormalizedSmsEvent[] = [];
    const config = createTestConfig({ skipSignatureVerification: false });

    // Create a mock provider that rejects all webhooks
    const rejectingProvider = new MockProvider();
    rejectingProvider.verifyWebhook = () => ({ ok: false, reason: "test rejection" });

    const testServer = new TelephonyWebhookServer(config, rejectingProvider, (event) => {
      events.push(event);
    });

    const localUrl = await testServer.start();
    const match = localUrl.match(/:(\d+)/);
    const testPort = match ? parseInt(match[1], 10) : 3336;

    try {
      const res = await postToServer(testPort, "/telephony/webhook", "test body");
      expect(res.statusCode).toBe(401);
      expect(events.length).toBe(0);
    } finally {
      await testServer.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// Server Lifecycle
// ---------------------------------------------------------------------------

describe("TelephonyWebhookServer lifecycle", () => {
  it("can start and stop cleanly", async () => {
    const config = createTestConfig();
    const provider = new MockProvider();
    const testServer = new TelephonyWebhookServer(config, provider, () => {});

    await testServer.start();
    await testServer.stop();
    // Should not throw on double stop
    await testServer.stop();
  });

  it("stop is safe when server was never started", async () => {
    const config = createTestConfig();
    const provider = new MockProvider();
    const testServer = new TelephonyWebhookServer(config, provider, () => {});

    // Stop without starting should not throw
    await testServer.stop();
  });
});
