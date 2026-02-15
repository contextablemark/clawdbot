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

/**
 * Mock provider for development and testing.
 * Logs all operations and returns success responses.
 */
export class MockProvider implements TelephonyProvider {
  readonly name = "mock" as const;

  /** Sent messages log (for testing inspection) */
  readonly sentMessages: Array<SendSmsParams | SendMmsParams> = [];
  readonly initiatedCalls: InitiateCallParams[] = [];

  private messageCounter = 0;
  private callCounter = 0;

  verifyWebhook(_ctx: WebhookContext): WebhookVerificationResult {
    return { ok: true };
  }

  parseInboundSms(ctx: WebhookContext): InboundSmsParseResult {
    // For mock, parse JSON body as a simplified inbound message
    try {
      const body = JSON.parse(ctx.rawBody);
      return {
        events: [
          {
            type: "inbound_sms",
            messageId: body.messageId || `mock-${Date.now()}`,
            from: body.from || "+15550000000",
            to: body.to || "+15550000001",
            body: body.body || body.text || "",
            timestamp: Date.now(),
          },
        ],
        statusCode: 200,
        responseBody: "OK",
      };
    } catch {
      return { events: [], statusCode: 200, responseBody: "OK" };
    }
  }

  async sendSms(params: SendSmsParams): Promise<SendSmsResult> {
    this.sentMessages.push(params);
    this.messageCounter++;
    const messageId = `mock-msg-${this.messageCounter}`;
    console.log(`[telephony:mock] SMS → ${params.to}: ${params.body.slice(0, 80)}${params.body.length > 80 ? "…" : ""}`);
    return {
      messageId,
      status: "sent",
      provider: "mock",
      segments: 1,
    };
  }

  async sendMms(params: SendMmsParams): Promise<SendSmsResult> {
    this.sentMessages.push(params);
    this.messageCounter++;
    const messageId = `mock-mms-${this.messageCounter}`;
    console.log(`[telephony:mock] MMS → ${params.to}: ${params.body.slice(0, 60)} [${params.mediaUrls.length} media]`);
    return {
      messageId,
      status: "sent",
      provider: "mock",
      segments: 1,
    };
  }

  async initiateCall(params: InitiateCallParams): Promise<InitiateCallResult> {
    this.initiatedCalls.push(params);
    this.callCounter++;
    const callId = `mock-call-${this.callCounter}`;
    console.log(`[telephony:mock] Call → ${params.to} from ${params.from}`);
    return {
      callId,
      status: "initiated",
      provider: "mock",
    };
  }
}
