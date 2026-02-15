import type {
  InboundSmsParseResult,
  InitiateCallParams,
  InitiateCallResult,
  ProviderName,
  SendMmsParams,
  SendSmsParams,
  SendSmsResult,
  WebhookContext,
  WebhookVerificationResult,
} from "../types.js";

/**
 * Abstract base interface for telephony providers.
 *
 * Each provider (Twilio, Telnyx, Plivo) implements this interface to provide
 * a consistent API for sending/receiving SMS and optionally initiating calls.
 *
 * Responsibilities:
 * - Webhook verification and inbound SMS parsing
 * - Outbound SMS/MMS sending
 * - Optional voice call initiation
 */
export interface TelephonyProvider {
  /** Provider identifier */
  readonly name: ProviderName;

  /**
   * Verify webhook signature/HMAC before processing.
   * Must be called before parseInboundSms.
   */
  verifyWebhook(ctx: WebhookContext): WebhookVerificationResult;

  /**
   * Parse provider-specific webhook payload into normalized SMS events.
   * Returns events and optional response to send back to the provider.
   */
  parseInboundSms(ctx: WebhookContext): InboundSmsParseResult;

  /**
   * Send an outbound SMS message.
   */
  sendSms(params: SendSmsParams): Promise<SendSmsResult>;

  /**
   * Send an outbound MMS message with media attachments.
   * Falls back to sendSms with media URL in body if not natively supported.
   */
  sendMms(params: SendMmsParams): Promise<SendSmsResult>;

  /**
   * Initiate an outbound voice call (optional).
   * Only available if the provider supports voice alongside SMS.
   */
  initiateCall?(params: InitiateCallParams): Promise<InitiateCallResult>;
}
