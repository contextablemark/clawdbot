// -----------------------------------------------------------------------------
// Provider Name
// -----------------------------------------------------------------------------

export type ProviderName = "twilio" | "telnyx" | "plivo" | "mock";

// -----------------------------------------------------------------------------
// Webhook Context
// -----------------------------------------------------------------------------

export type WebhookContext = {
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
  url: string;
  method: string;
  query: Record<string, string>;
  remoteAddress?: string;
};

export type WebhookVerificationResult =
  | { ok: true }
  | { ok: false; reason: string };

// -----------------------------------------------------------------------------
// SMS Types
// -----------------------------------------------------------------------------

export type SendSmsParams = {
  to: string;
  from: string;
  body: string;
  /** Optional status callback URL */
  statusCallback?: string;
};

export type SendSmsResult = {
  messageId: string;
  status: MessageStatus;
  provider: ProviderName;
  segments?: number;
};

export type SendMmsParams = SendSmsParams & {
  mediaUrls: string[];
};

export type MessageStatus =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "undelivered"
  | "failed"
  | "unknown";

// -----------------------------------------------------------------------------
// Normalized Inbound Events
// -----------------------------------------------------------------------------

export type InboundSmsEvent = {
  type: "inbound_sms";
  messageId: string;
  from: string;
  to: string;
  body: string;
  timestamp: number;
  mediaUrls?: string[];
  /** Number of SMS segments (for multi-part) */
  numSegments?: number;
};

export type DeliveryStatusEvent = {
  type: "delivery_status";
  messageId: string;
  status: MessageStatus;
  errorCode?: string;
  errorMessage?: string;
  timestamp: number;
};

export type SmsErrorEvent = {
  type: "sms_error";
  messageId?: string;
  errorCode: string;
  errorMessage: string;
  timestamp: number;
};

export type NormalizedSmsEvent = InboundSmsEvent | DeliveryStatusEvent | SmsErrorEvent;

// -----------------------------------------------------------------------------
// Webhook Parse Result
// -----------------------------------------------------------------------------

export type InboundSmsParseResult = {
  events: NormalizedSmsEvent[];
  /** HTTP status code to return to provider */
  statusCode?: number;
  /** Response body to return to provider */
  responseBody?: string;
  /** Response headers to return to provider */
  responseHeaders?: Record<string, string>;
};

// -----------------------------------------------------------------------------
// Voice Call Types (lightweight, for unified channel)
// -----------------------------------------------------------------------------

export type InitiateCallParams = {
  to: string;
  from: string;
  /** URL for the provider to fetch TwiML/instructions */
  webhookUrl?: string;
  /** Timeout in seconds before giving up on ring */
  timeoutSec?: number;
};

export type InitiateCallResult = {
  callId: string;
  status: "initiated" | "queued" | "failed";
  provider: ProviderName;
};

export type CallStatus =
  | "initiated"
  | "ringing"
  | "in-progress"
  | "completed"
  | "failed"
  | "busy"
  | "no-answer"
  | "canceled";
