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

export type TwilioProviderOptions = {
  accountSid: string;
  authToken: string;
  messagingServiceSid?: string;
  publicUrl?: string;
  skipSignatureVerification?: boolean;
};

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

/**
 * Twilio provider for SMS/MMS and voice calls.
 *
 * Uses the Twilio REST API directly (no SDK dependency).
 * Webhook verification uses HMAC-SHA1 signature validation.
 */
export class TwilioProvider implements TelephonyProvider {
  readonly name = "twilio" as const;
  private readonly opts: TwilioProviderOptions;

  constructor(opts: TwilioProviderOptions) {
    this.opts = opts;
  }

  // ---------------------------------------------------------------------------
  // Webhook Verification
  // ---------------------------------------------------------------------------

  verifyWebhook(ctx: WebhookContext): WebhookVerificationResult {
    if (this.opts.skipSignatureVerification) {
      return { ok: true };
    }

    const signature = ctx.headers["x-twilio-signature"];
    if (!signature || typeof signature !== "string") {
      return { ok: false, reason: "Missing X-Twilio-Signature header" };
    }

    // Reconstruct the full URL used for signing
    const url = this.opts.publicUrl
      ? this.opts.publicUrl + new URL(ctx.url).pathname + new URL(ctx.url).search
      : ctx.url;

    // Build the signing string: URL + sorted POST parameters
    const params = new URLSearchParams(ctx.rawBody);
    const sortedKeys = [...params.keys()].sort();
    let signingString = url;
    for (const key of sortedKeys) {
      signingString += key + params.get(key);
    }

    const expected = crypto
      .createHmac("sha1", this.opts.authToken)
      .update(signingString)
      .digest("base64");

    // Timing-safe comparison
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
    const params = new URLSearchParams(ctx.rawBody);
    const messageSid = params.get("MessageSid") || params.get("SmsSid");
    const from = params.get("From") || "";
    const to = params.get("To") || "";
    const body = params.get("Body") || "";
    const messageStatus = params.get("MessageStatus") || params.get("SmsStatus");
    const numSegments = params.get("NumSegments");

    // Delivery status callback (no Body, has MessageStatus)
    if (messageStatus && !body && messageSid) {
      return {
        events: [
          {
            type: "delivery_status",
            messageId: messageSid,
            status: mapTwilioStatus(messageStatus),
            errorCode: params.get("ErrorCode") || undefined,
            errorMessage: params.get("ErrorMessage") || undefined,
            timestamp: Date.now(),
          },
        ],
        statusCode: 200,
        responseBody: "<Response></Response>",
        responseHeaders: { "Content-Type": "application/xml" },
      };
    }

    // Inbound SMS
    if (!messageSid) {
      return { events: [], statusCode: 200, responseBody: "<Response></Response>" };
    }

    // Collect media URLs
    const numMedia = parseInt(params.get("NumMedia") || "0", 10);
    const mediaUrls: string[] = [];
    for (let i = 0; i < numMedia; i++) {
      const url = params.get(`MediaUrl${i}`);
      if (url) mediaUrls.push(url);
    }

    return {
      events: [
        {
          type: "inbound_sms",
          messageId: messageSid,
          from,
          to,
          body,
          timestamp: Date.now(),
          mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
          numSegments: numSegments ? parseInt(numSegments, 10) : undefined,
        },
      ],
      statusCode: 200,
      // Empty TwiML response (no auto-reply at this level)
      responseBody: "<Response></Response>",
      responseHeaders: { "Content-Type": "application/xml" },
    };
  }

  // ---------------------------------------------------------------------------
  // Send SMS
  // ---------------------------------------------------------------------------

  async sendSms(params: SendSmsParams): Promise<SendSmsResult> {
    const body = new URLSearchParams();
    body.set("To", params.to);
    body.set("Body", params.body);

    if (this.opts.messagingServiceSid) {
      body.set("MessagingServiceSid", this.opts.messagingServiceSid);
    } else {
      body.set("From", params.from);
    }

    if (params.statusCallback) {
      body.set("StatusCallback", params.statusCallback);
    }

    const url = `${TWILIO_API_BASE}/Accounts/${this.opts.accountSid}/Messages.json`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${this.opts.accountSid}:${this.opts.authToken}`).toString("base64")}`,
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Twilio SMS send failed (${response.status}): ${error}`);
    }

    const result = (await response.json()) as {
      sid: string;
      status: string;
      num_segments: string;
    };

    return {
      messageId: result.sid,
      status: mapTwilioStatus(result.status),
      provider: "twilio",
      segments: parseInt(result.num_segments || "1", 10),
    };
  }

  // ---------------------------------------------------------------------------
  // Send MMS
  // ---------------------------------------------------------------------------

  async sendMms(params: SendMmsParams): Promise<SendSmsResult> {
    const body = new URLSearchParams();
    body.set("To", params.to);
    body.set("Body", params.body);

    if (this.opts.messagingServiceSid) {
      body.set("MessagingServiceSid", this.opts.messagingServiceSid);
    } else {
      body.set("From", params.from);
    }

    for (const mediaUrl of params.mediaUrls) {
      body.append("MediaUrl", mediaUrl);
    }

    if (params.statusCallback) {
      body.set("StatusCallback", params.statusCallback);
    }

    const url = `${TWILIO_API_BASE}/Accounts/${this.opts.accountSid}/Messages.json`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${this.opts.accountSid}:${this.opts.authToken}`).toString("base64")}`,
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Twilio MMS send failed (${response.status}): ${error}`);
    }

    const result = (await response.json()) as {
      sid: string;
      status: string;
      num_segments: string;
    };

    return {
      messageId: result.sid,
      status: mapTwilioStatus(result.status),
      provider: "twilio",
      segments: parseInt(result.num_segments || "1", 10),
    };
  }

  // ---------------------------------------------------------------------------
  // Voice Call Initiation
  // ---------------------------------------------------------------------------

  async initiateCall(params: InitiateCallParams): Promise<InitiateCallResult> {
    const body = new URLSearchParams();
    body.set("To", params.to);
    body.set("From", params.from);

    if (params.webhookUrl) {
      body.set("Url", params.webhookUrl);
    }
    if (params.timeoutSec) {
      body.set("Timeout", String(params.timeoutSec));
    }

    const url = `${TWILIO_API_BASE}/Accounts/${this.opts.accountSid}/Calls.json`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${this.opts.accountSid}:${this.opts.authToken}`).toString("base64")}`,
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Twilio call initiation failed (${response.status}): ${error}`);
    }

    const result = (await response.json()) as { sid: string; status: string };

    return {
      callId: result.sid,
      status: result.status === "queued" ? "queued" : "initiated",
      provider: "twilio",
    };
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function mapTwilioStatus(status: string): SendSmsResult["status"] {
  switch (status.toLowerCase()) {
    case "queued":
    case "accepted":
      return "queued";
    case "sending":
      return "sending";
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "undelivered":
      return "undelivered";
    case "failed":
      return "failed";
    default:
      return "unknown";
  }
}
