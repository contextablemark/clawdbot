import http from "node:http";
import { URL } from "node:url";
import type { TelephonyConfig } from "./config.js";
import type { TelephonyProvider } from "./providers/base.js";
import type { InboundSmsEvent, NormalizedSmsEvent, WebhookContext } from "./types.js";

const MAX_WEBHOOK_BODY_BYTES = 512 * 1024; // 512 KB

export type WebhookEventHandler = (event: NormalizedSmsEvent) => void;

/**
 * HTTP server for receiving SMS/MMS webhooks from telephony providers.
 */
export class TelephonyWebhookServer {
  private server: http.Server | null = null;
  private config: TelephonyConfig;
  private provider: TelephonyProvider;
  private onEvent: WebhookEventHandler;

  constructor(config: TelephonyConfig, provider: TelephonyProvider, onEvent: WebhookEventHandler) {
    this.config = config;
    this.provider = provider;
    this.onEvent = onEvent;
  }

  /**
   * Start the webhook server.
   */
  async start(): Promise<string> {
    const { port, bind, path: webhookPath, statusPath } = this.config.serve;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res, webhookPath, statusPath).catch((err) => {
          console.error("[telephony] Webhook error:", err);
          res.statusCode = 500;
          res.end("Internal Server Error");
        });
      });

      this.server.on("error", reject);

      this.server.listen(port, bind, () => {
        const url = `http://${bind}:${port}${webhookPath}`;
        console.log(`[telephony] Webhook server listening on ${url}`);
        console.log(`[telephony] Status callback URL: http://${bind}:${port}${statusPath}`);
        resolve(url);
      });
    });
  }

  /**
   * Stop the webhook server.
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Handle incoming HTTP request.
   */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    webhookPath: string,
    statusPath: string,
  ): Promise<void> {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    // Health check
    if (url.pathname === "/health" && req.method === "GET") {
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, provider: this.provider.name }));
      return;
    }

    // Only accept POST for webhook paths
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end("Method Not Allowed");
      return;
    }

    // Check that the path matches either webhook or status path
    if (!url.pathname.startsWith(webhookPath) && !url.pathname.startsWith(statusPath)) {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }

    // Read body
    let body: string;
    try {
      body = await this.readBody(req, MAX_WEBHOOK_BODY_BYTES);
    } catch (err) {
      if (err instanceof Error && err.message.includes("too large")) {
        res.statusCode = 413;
        res.end("Payload Too Large");
        return;
      }
      throw err;
    }

    // Build webhook context
    const ctx: WebhookContext = {
      headers: req.headers as Record<string, string | string[] | undefined>,
      rawBody: body,
      url: `http://${req.headers.host}${req.url}`,
      method: "POST",
      query: Object.fromEntries(url.searchParams),
      remoteAddress: req.socket.remoteAddress ?? undefined,
    };

    // Verify signature
    const verification = this.provider.verifyWebhook(ctx);
    if (!verification.ok) {
      console.warn(`[telephony] Webhook verification failed: ${verification.reason}`);
      res.statusCode = 401;
      res.end("Unauthorized");
      return;
    }

    // Parse events
    const result = this.provider.parseInboundSms(ctx);

    // Process each event
    for (const event of result.events) {
      try {
        this.onEvent(event);
      } catch (err) {
        console.error(`[telephony] Error processing event ${event.type}:`, err);
      }
    }

    // Send response
    res.statusCode = result.statusCode || 200;
    if (result.responseHeaders) {
      for (const [key, value] of Object.entries(result.responseHeaders)) {
        res.setHeader(key, value);
      }
    }
    res.end(result.responseBody || "OK");
  }

  /**
   * Read request body as string with size limit.
   */
  private readBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      req.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          req.destroy();
          reject(new Error("Request body too large"));
          return;
        }
        chunks.push(chunk);
      });

      req.on("end", () => {
        resolve(Buffer.concat(chunks).toString("utf-8"));
      });

      req.on("error", reject);

      // Timeout after 30 seconds
      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error("Request body read timeout"));
      }, 30_000);

      req.on("close", () => clearTimeout(timer));
    });
  }
}
