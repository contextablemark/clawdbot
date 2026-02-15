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

export type TelnyxProviderOptions = {
  apiKey: string;
  messagingProfileId?: string;
  publicKey?: string;
  skipSignatureVerification?: boolean;
};

const TELNYX_API_BASE = "https://api.telnyx.com/v2";

/**
 * Telnyx provider for SMS/MMS and voice calls.
 *
 * Uses the Telnyx v2 REST API directly (no SDK dependency).
 * Webhook verification uses Ed25519 public key signature validation.
 */
export class TelnyxProvider implements TelephonyProvider {
  readonly name = "telnyx" as const;
  private readonly opts: TelnyxProviderOptions;

  constructor(opts: TelnyxProviderOptions) {
    this.opts = opts;
  }

  // ---------------------------------------------------------------------------
  // Webhook Verification
  // ---------------------------------------------------------------------------

  verifyWebhook(ctx: WebhookContext): WebhookVerificationResult {
    if (this.opts.skipSignatureVerification) {
      return { ok: true };
    }

    if (!this.opts.publicKey) {
      return { ok: false, reason: "No Telnyx public key configured for verification" };
    }

    const signature = ctx.headers["telnyx-signature-ed25519"];
    const timestamp = ctx.headers["telnyx-timestamp"];

    if (!signature || typeof signature !== "string") {
      return { ok: false, reason: "Missing telnyx-signature-ed25519 header" };
    }
    if (!timestamp || typeof timestamp !== "string") {
      return { ok: false, reason: "Missing telnyx-timestamp header" };
    }

    // Reject timestamps older than 5 minutes
    const tsMs = parseInt(timestamp, 10) * 1000;
    if (Math.abs(Date.now() - tsMs) > 5 * 60 * 1000) {
      return { ok: false, reason: "Webhook timestamp too old" };
    }

    try {
      const signingPayload = `${timestamp}|${ctx.rawBody}`;
      const signatureBytes = Buffer.from(signature, "base64");
      const publicKeyBytes = Buffer.from(this.opts.publicKey, "base64");

      const valid = crypto.verify(
        null, // Ed25519 doesn't use a separate hash algorithm
        Buffer.from(signingPayload),
        { key: publicKeyBytes, format: "der", type: "spki" },
        signatureBytes,
      );

      if (!valid) {
        return { ok: false, reason: "Signature mismatch" };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: `Verification error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // ---------------------------------------------------------------------------
  // Inbound SMS Parsing
  // ---------------------------------------------------------------------------

  parseInboundSms(ctx: WebhookContext): InboundSmsParseResult {
    let payload: TelnyxWebhookPayload;
    try {
      payload = JSON.parse(ctx.rawBody);
    } catch {
      return { events: [], statusCode: 400, responseBody: "Invalid JSON" };
    }

    const data = payload.data;
    if (!data) {
      return { events: [], statusCode: 200, responseBody: "" };
    }

    const eventType = data.event_type;

    // Delivery status update
    if (
      eventType === "message.sent" ||
      eventType === "message.delivered" ||
      eventType === "message.failed"
    ) {
      const messagePayload = data.payload;
      return {
        events: [
          {
            type: "delivery_status",
            messageId: messagePayload?.id || data.id || "",
            status: mapTelnyxStatus(eventType),
            errorCode: messagePayload?.errors?.[0]?.code,
            errorMessage: messagePayload?.errors?.[0]?.title,
            timestamp: Date.now(),
          },
        ],
        statusCode: 200,
        responseBody: "",
      };
    }

    // Inbound message
    if (eventType === "message.received") {
      const messagePayload = data.payload;
      if (!messagePayload) {
        return { events: [], statusCode: 200, responseBody: "" };
      }

      const mediaUrls: string[] = [];
      if (messagePayload.media?.length) {
        for (const m of messagePayload.media) {
          if (m.url) mediaUrls.push(m.url);
        }
      }

      return {
        events: [
          {
            type: "inbound_sms",
            messageId: data.id || messagePayload.id || "",
            from: messagePayload.from?.phone_number || "",
            to: messagePayload.to?.[0]?.phone_number || "",
            body: messagePayload.text || "",
            timestamp: Date.now(),
            mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
          },
        ],
        statusCode: 200,
        responseBody: "",
      };
    }

    // Unknown event type
    return { events: [], statusCode: 200, responseBody: "" };
  }

  // ---------------------------------------------------------------------------
  // Send SMS
  // ---------------------------------------------------------------------------

  async sendSms(params: SendSmsParams): Promise<SendSmsResult> {
    const body: TelnyxSendMessageBody = {
      from: params.from,
      to: params.to,
      text: params.body,
      type: "SMS",
    };

    if (this.opts.messagingProfileId) {
      body.messaging_profile_id = this.opts.messagingProfileId;
    }

    if (params.statusCallback) {
      body.webhook_url = params.statusCallback;
    }

    const response = await fetch(`${TELNYX_API_BASE}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Telnyx SMS send failed (${response.status}): ${error}`);
    }

    const result = (await response.json()) as { data: { id: string; to: Array<{ status: string }> } };

    return {
      messageId: result.data.id,
      status: mapTelnyxSendStatus(result.data.to?.[0]?.status),
      provider: "telnyx",
    };
  }

  // ---------------------------------------------------------------------------
  // Send MMS
  // ---------------------------------------------------------------------------

  async sendMms(params: SendMmsParams): Promise<SendSmsResult> {
    const body: TelnyxSendMessageBody = {
      from: params.from,
      to: params.to,
      text: params.body,
      type: "MMS",
      media_urls: params.mediaUrls,
    };

    if (this.opts.messagingProfileId) {
      body.messaging_profile_id = this.opts.messagingProfileId;
    }

    if (params.statusCallback) {
      body.webhook_url = params.statusCallback;
    }

    const response = await fetch(`${TELNYX_API_BASE}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Telnyx MMS send failed (${response.status}): ${error}`);
    }

    const result = (await response.json()) as { data: { id: string; to: Array<{ status: string }> } };

    return {
      messageId: result.data.id,
      status: mapTelnyxSendStatus(result.data.to?.[0]?.status),
      provider: "telnyx",
    };
  }

  // ---------------------------------------------------------------------------
  // Voice Call Initiation
  // ---------------------------------------------------------------------------

  async initiateCall(params: InitiateCallParams): Promise<InitiateCallResult> {
    const body: Record<string, unknown> = {
      to: params.to,
      from: params.from,
      connection_id: this.opts.messagingProfileId, // Telnyx uses connection_id for calls
    };

    if (params.webhookUrl) {
      body.webhook_url = params.webhookUrl;
    }
    if (params.timeoutSec) {
      body.timeout_secs = params.timeoutSec;
    }

    const response = await fetch(`${TELNYX_API_BASE}/calls`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Telnyx call initiation failed (${response.status}): ${error}`);
    }

    const result = (await response.json()) as { data: { call_control_id: string; state: string } };

    return {
      callId: result.data.call_control_id,
      status: "initiated",
      provider: "telnyx",
    };
  }
}

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type TelnyxWebhookPayload = {
  data?: {
    id?: string;
    event_type?: string;
    payload?: {
      id?: string;
      from?: { phone_number?: string };
      to?: Array<{ phone_number?: string }>;
      text?: string;
      media?: Array<{ url?: string }>;
      errors?: Array<{ code?: string; title?: string }>;
    };
  };
};

type TelnyxSendMessageBody = {
  from: string;
  to: string;
  text: string;
  type: "SMS" | "MMS";
  messaging_profile_id?: string;
  media_urls?: string[];
  webhook_url?: string;
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function mapTelnyxStatus(eventType: string): SendSmsResult["status"] {
  switch (eventType) {
    case "message.sent":
      return "sent";
    case "message.delivered":
      return "delivered";
    case "message.failed":
      return "failed";
    default:
      return "unknown";
  }
}

function mapTelnyxSendStatus(status: string | undefined): SendSmsResult["status"] {
  switch (status) {
    case "queued":
      return "queued";
    case "sending":
      return "sending";
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    default:
      return "queued"; // Telnyx typically returns queued on send
  }
}
