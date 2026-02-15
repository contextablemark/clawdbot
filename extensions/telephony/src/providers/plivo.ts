import crypto from "node:crypto";
import type {
  InboundSmsParseResult,
  InitiateCallParams,
  InitiateCallResult,
  SendMmsParams,
  SendSmsParams,
  SendSmsResult,
  WebhookContext,
  WebhookVerificationResult,
} from "../types.js";
import type { TelephonyProvider } from "./base.js";

export type PlivoProviderOptions = {
  authId: string;
  authToken: string;
  skipSignatureVerification?: boolean;
  publicUrl?: string;
};

const PLIVO_API_BASE = "https://api.plivo.com/v1";

/**
 * Plivo provider for SMS/MMS and voice calls.
 *
 * Uses the Plivo REST API directly (no SDK dependency).
 * Webhook verification uses HMAC-SHA256 signature validation (X-Plivo-Signature-V3).
 */
export class PlivoProvider implements TelephonyProvider {
  readonly name = "plivo" as const;
  private readonly opts: PlivoProviderOptions;

  constructor(opts: PlivoProviderOptions) {
    this.opts = opts;
  }

  // ---------------------------------------------------------------------------
  // Webhook Verification
  // ---------------------------------------------------------------------------

  verifyWebhook(ctx: WebhookContext): WebhookVerificationResult {
    if (this.opts.skipSignatureVerification) {
      return { ok: true };
    }

    // Plivo V3 signature
    const signature = ctx.headers["x-plivo-signature-v3"];
    const nonce = ctx.headers["x-plivo-signature-v3-nonce"];

    if (!signature || typeof signature !== "string") {
      return { ok: false, reason: "Missing X-Plivo-Signature-V3 header" };
    }
    if (!nonce || typeof nonce !== "string") {
      return { ok: false, reason: "Missing X-Plivo-Signature-V3-Nonce header" };
    }

    const url = this.opts.publicUrl
      ? this.opts.publicUrl + new URL(ctx.url).pathname + new URL(ctx.url).search
      : ctx.url;

    // V3 signing: HMAC-SHA256 of (url + nonce + body)
    const signingString = url + nonce + ctx.rawBody;
    const expected = crypto
      .createHmac("sha256", this.opts.authToken)
      .update(signingString)
      .digest("base64");

    if (expected.length !== signature.length) {
      return { ok: false, reason: "Signature mismatch" };
    }
    const valid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    if (!valid) {
      return { ok: false, reason: "Signature mismatch" };
    }

    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Inbound SMS Parsing
  // ---------------------------------------------------------------------------

  parseInboundSms(ctx: WebhookContext): InboundSmsParseResult {
    // Plivo sends POST with form-urlencoded or JSON body
    let from: string;
    let to: string;
    let text: string;
    let messageUuid: string;
    let messageType: string | undefined;

    const contentType = ctx.headers["content-type"] || "";

    if (contentType.includes("application/json")) {
      try {
        const body = JSON.parse(ctx.rawBody);
        from = body.From || "";
        to = body.To || "";
        text = body.Text || "";
        messageUuid = body.MessageUUID || "";
        messageType = body.Type;
      } catch {
        return { events: [], statusCode: 400, responseBody: "Invalid JSON" };
      }
    } else {
      const params = new URLSearchParams(ctx.rawBody);
      from = params.get("From") || "";
      to = params.get("To") || "";
      text = params.get("Text") || "";
      messageUuid = params.get("MessageUUID") || "";
      messageType = params.get("Type") || undefined;
    }

    // Delivery status report
    if (messageType === "dlr" || (!text && messageUuid)) {
      let status: string;
      const contentTypeHeader = ctx.headers["content-type"] || "";
      if (contentTypeHeader.includes("application/json")) {
        try {
          const body = JSON.parse(ctx.rawBody);
          status = body.Status || "unknown";
        } catch {
          status = "unknown";
        }
      } else {
        const params = new URLSearchParams(ctx.rawBody);
        status = params.get("Status") || "unknown";
      }

      return {
        events: [
          {
            type: "delivery_status",
            messageId: messageUuid,
            status: mapPlivoStatus(status),
            timestamp: Date.now(),
          },
        ],
        statusCode: 200,
        responseBody: "<Response></Response>",
        responseHeaders: { "Content-Type": "application/xml" },
      };
    }

    // Inbound SMS
    if (!messageUuid && !text) {
      return { events: [], statusCode: 200, responseBody: "<Response></Response>" };
    }

    // Plivo MMS media URLs (comma-separated in MediaUrls field)
    let mediaUrls: string[] | undefined;
    const contentTypeHeader = ctx.headers["content-type"] || "";
    if (contentTypeHeader.includes("application/json")) {
      try {
        const body = JSON.parse(ctx.rawBody);
        if (body.MediaUrls) {
          mediaUrls = String(body.MediaUrls)
            .split(",")
            .map((u: string) => u.trim())
            .filter(Boolean);
        }
      } catch {
        // ignore
      }
    } else {
      const params = new URLSearchParams(ctx.rawBody);
      const rawMedia = params.get("MediaUrls");
      if (rawMedia) {
        mediaUrls = rawMedia
          .split(",")
          .map((u) => u.trim())
          .filter(Boolean);
      }
    }

    return {
      events: [
        {
          type: "inbound_sms",
          messageId: messageUuid || `plivo-${Date.now()}`,
          from,
          to,
          body: text,
          timestamp: Date.now(),
          mediaUrls: mediaUrls?.length ? mediaUrls : undefined,
        },
      ],
      statusCode: 200,
      responseBody: "<Response></Response>",
      responseHeaders: { "Content-Type": "application/xml" },
    };
  }

  // ---------------------------------------------------------------------------
  // Send SMS
  // ---------------------------------------------------------------------------

  async sendSms(params: SendSmsParams): Promise<SendSmsResult> {
    const body = {
      src: params.from,
      dst: params.to,
      text: params.body,
      ...(params.statusCallback ? { url: params.statusCallback } : {}),
    };

    const url = `${PLIVO_API_BASE}/Account/${this.opts.authId}/Message/`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${this.opts.authId}:${this.opts.authToken}`).toString("base64")}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Plivo SMS send failed (${response.status}): ${error}`);
    }

    const result = (await response.json()) as {
      message_uuid: string[];
      message: string;
    };

    return {
      messageId: result.message_uuid?.[0] || "",
      status: "queued",
      provider: "plivo",
    };
  }

  // ---------------------------------------------------------------------------
  // Send MMS
  // ---------------------------------------------------------------------------

  async sendMms(params: SendMmsParams): Promise<SendSmsResult> {
    const body = {
      src: params.from,
      dst: params.to,
      text: params.body,
      type: "mms",
      media_urls: params.mediaUrls,
      ...(params.statusCallback ? { url: params.statusCallback } : {}),
    };

    const url = `${PLIVO_API_BASE}/Account/${this.opts.authId}/Message/`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${this.opts.authId}:${this.opts.authToken}`).toString("base64")}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Plivo MMS send failed (${response.status}): ${error}`);
    }

    const result = (await response.json()) as {
      message_uuid: string[];
      message: string;
    };

    return {
      messageId: result.message_uuid?.[0] || "",
      status: "queued",
      provider: "plivo",
    };
  }

  // ---------------------------------------------------------------------------
  // Voice Call Initiation
  // ---------------------------------------------------------------------------

  async initiateCall(params: InitiateCallParams): Promise<InitiateCallResult> {
    const body: Record<string, unknown> = {
      from: params.from,
      to: `<${params.to}>`,
    };

    if (params.webhookUrl) {
      body.answer_url = params.webhookUrl;
    }
    if (params.timeoutSec) {
      body.ring_timeout = params.timeoutSec;
    }

    const url = `${PLIVO_API_BASE}/Account/${this.opts.authId}/Call/`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${this.opts.authId}:${this.opts.authToken}`).toString("base64")}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Plivo call initiation failed (${response.status}): ${error}`);
    }

    const result = (await response.json()) as {
      request_uuid: string;
      message: string;
    };

    return {
      callId: result.request_uuid,
      status: "initiated",
      provider: "plivo",
    };
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function mapPlivoStatus(status: string): SendSmsResult["status"] {
  switch (status.toLowerCase()) {
    case "queued":
      return "queued";
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "undelivered":
      return "undelivered";
    case "failed":
    case "rejected":
      return "failed";
    default:
      return "unknown";
  }
}
