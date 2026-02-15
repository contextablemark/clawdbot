import { z } from "zod";

// -----------------------------------------------------------------------------
// Phone Number Validation
// -----------------------------------------------------------------------------

/**
 * E.164 phone number format: +[country code][number]
 * Examples: +15550001234, +442071234567
 */
export const E164Schema = z
  .string()
  .regex(/^\+[1-9]\d{1,14}$/, "Expected E.164 format, e.g. +15550001234");

// -----------------------------------------------------------------------------
// Inbound Policy
// -----------------------------------------------------------------------------

/**
 * Controls how inbound SMS messages are handled:
 * - "disabled": Block all inbound (outbound-only)
 * - "allowlist": Only accept from numbers in allowFrom
 * - "pairing": Unknown senders get a pairing code to give to the admin
 * - "open": Accept all inbound messages (dangerous!)
 */
export const InboundPolicySchema = z.enum(["disabled", "allowlist", "pairing", "open"]);
export type InboundPolicy = z.infer<typeof InboundPolicySchema>;

// -----------------------------------------------------------------------------
// Provider-Specific Configuration
// -----------------------------------------------------------------------------

export const TwilioConfigSchema = z
  .object({
    /** Twilio Account SID */
    accountSid: z.string().min(1).optional(),
    /** Twilio Auth Token */
    authToken: z.string().min(1).optional(),
    /** Optional Messaging Service SID (for senderId rotation / A2P compliance) */
    messagingServiceSid: z.string().min(1).optional(),
  })
  .strict();
export type TwilioConfig = z.infer<typeof TwilioConfigSchema>;

export const TelnyxConfigSchema = z
  .object({
    /** Telnyx API v2 key */
    apiKey: z.string().min(1).optional(),
    /** Telnyx Messaging Profile ID */
    messagingProfileId: z.string().min(1).optional(),
    /** Public key for webhook signature verification */
    publicKey: z.string().min(1).optional(),
  })
  .strict();
export type TelnyxConfig = z.infer<typeof TelnyxConfigSchema>;

export const PlivoConfigSchema = z
  .object({
    /** Plivo Auth ID */
    authId: z.string().min(1).optional(),
    /** Plivo Auth Token */
    authToken: z.string().min(1).optional(),
  })
  .strict();
export type PlivoConfig = z.infer<typeof PlivoConfigSchema>;

// -----------------------------------------------------------------------------
// Webhook Server Configuration
// -----------------------------------------------------------------------------

export const TelephonyServeConfigSchema = z
  .object({
    /** Port to listen on */
    port: z.number().int().positive().default(3335),
    /** Bind address */
    bind: z.string().default("127.0.0.1"),
    /** Webhook path for SMS */
    path: z.string().min(1).default("/telephony/webhook"),
    /** Webhook path for delivery status callbacks */
    statusPath: z.string().min(1).default("/telephony/status"),
  })
  .strict()
  .default({ port: 3335, bind: "127.0.0.1", path: "/telephony/webhook", statusPath: "/telephony/status" });
export type TelephonyServeConfig = z.infer<typeof TelephonyServeConfigSchema>;

// -----------------------------------------------------------------------------
// Tunnel Configuration
// -----------------------------------------------------------------------------

export const TelephonyTunnelConfigSchema = z
  .object({
    /**
     * Tunnel provider:
     * - "none": No tunnel (use publicUrl or manual setup)
     * - "ngrok": Use ngrok for public HTTPS tunnel
     * - "tailscale-serve": Tailscale serve (private to tailnet)
     * - "tailscale-funnel": Tailscale funnel (public HTTPS)
     */
    provider: z.enum(["none", "ngrok", "tailscale-serve", "tailscale-funnel"]).default("none"),
    /** ngrok auth token */
    ngrokAuthToken: z.string().min(1).optional(),
    /** ngrok custom domain */
    ngrokDomain: z.string().min(1).optional(),
  })
  .strict()
  .default({ provider: "none" });
export type TelephonyTunnelConfig = z.infer<typeof TelephonyTunnelConfigSchema>;

// -----------------------------------------------------------------------------
// Webhook Security Configuration
// -----------------------------------------------------------------------------

export const TelephonyWebhookSecurityConfigSchema = z
  .object({
    /** Allowed hostnames for webhook URL reconstruction */
    allowedHosts: z.array(z.string().min(1)).default([]),
    /** Trust X-Forwarded-* headers */
    trustForwardingHeaders: z.boolean().default(false),
    /** Trusted proxy IP addresses */
    trustedProxyIPs: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .default({ allowedHosts: [], trustForwardingHeaders: false, trustedProxyIPs: [] });
export type TelephonyWebhookSecurityConfig = z.infer<typeof TelephonyWebhookSecurityConfigSchema>;

// -----------------------------------------------------------------------------
// SMS Configuration
// -----------------------------------------------------------------------------

export const SmsConfigSchema = z
  .object({
    /**
     * Chunking mode for outbound messages:
     * - "auto": Detect encoding and split at appropriate boundaries
     * - "single": Truncate to single SMS (160/70 chars)
     * - "multi": Allow multi-part SMS with segment numbering
     */
    chunkMode: z.enum(["auto", "single", "multi"]).default("auto"),
    /**
     * Maximum total characters before truncation.
     * Default 1600 (~10 SMS segments). Set lower to control costs.
     */
    maxLength: z.number().int().positive().default(1600),
    /** Add segment numbering like "[1/3]" for multi-part messages */
    segmentNumbering: z.boolean().default(true),
  })
  .strict()
  .default({ chunkMode: "auto", maxLength: 1600, segmentNumbering: true });
export type SmsConfig = z.infer<typeof SmsConfigSchema>;

// -----------------------------------------------------------------------------
// Voice Configuration (for unified telephony)
// -----------------------------------------------------------------------------

export const VoiceConfigSchema = z
  .object({
    /** Enable voice call capability alongside SMS */
    enabled: z.boolean().default(false),
    /** Greeting message for inbound calls */
    inboundGreeting: z.string().optional(),
    /** Maximum call duration in seconds */
    maxDurationSeconds: z.number().int().positive().default(300),
  })
  .strict()
  .default({ enabled: false, maxDurationSeconds: 300 });
export type VoiceConfig = z.infer<typeof VoiceConfigSchema>;

// -----------------------------------------------------------------------------
// Main Telephony Configuration
// -----------------------------------------------------------------------------

export const TelephonyConfigSchema = z
  .object({
    /** Enable telephony channel */
    enabled: z.boolean().default(false),

    /** Active provider (twilio, telnyx, plivo, or mock) */
    provider: z.enum(["twilio", "telnyx", "plivo", "mock"]).optional(),

    /** Twilio-specific configuration */
    twilio: TwilioConfigSchema.optional(),

    /** Telnyx-specific configuration */
    telnyx: TelnyxConfigSchema.optional(),

    /** Plivo-specific configuration */
    plivo: PlivoConfigSchema.optional(),

    /** Phone number to send from (E.164) */
    fromNumber: E164Schema.optional(),

    /** Inbound message policy */
    inboundPolicy: InboundPolicySchema.default("pairing"),

    /** Allowlist of phone numbers for inbound messages (E.164) */
    allowFrom: z.array(E164Schema).default([]),

    /** SMS-specific configuration */
    sms: SmsConfigSchema,

    /** Voice call configuration */
    voice: VoiceConfigSchema,

    /** Webhook server configuration */
    serve: TelephonyServeConfigSchema,

    /** Tunnel configuration */
    tunnel: TelephonyTunnelConfigSchema,

    /** Webhook security configuration */
    webhookSecurity: TelephonyWebhookSecurityConfigSchema,

    /** Public webhook URL override */
    publicUrl: z.string().url().optional(),

    /** Skip webhook signature verification (development only) */
    skipSignatureVerification: z.boolean().default(false),

    /** Maximum concurrent sessions */
    maxConcurrentSessions: z.number().int().positive().default(50),
  })
  .strict();

export type TelephonyConfig = z.infer<typeof TelephonyConfigSchema>;

// -----------------------------------------------------------------------------
// Configuration Helpers
// -----------------------------------------------------------------------------

/**
 * Resolves configuration by merging environment variables into missing fields.
 */
export function resolveTelephonyConfig(config: TelephonyConfig): TelephonyConfig {
  const resolved = JSON.parse(JSON.stringify(config)) as TelephonyConfig;

  if (resolved.provider === "twilio") {
    resolved.twilio = resolved.twilio ?? {};
    resolved.twilio.accountSid = resolved.twilio.accountSid ?? process.env.TWILIO_ACCOUNT_SID;
    resolved.twilio.authToken = resolved.twilio.authToken ?? process.env.TWILIO_AUTH_TOKEN;
    resolved.twilio.messagingServiceSid =
      resolved.twilio.messagingServiceSid ?? process.env.TWILIO_MESSAGING_SERVICE_SID;
  }

  if (resolved.provider === "telnyx") {
    resolved.telnyx = resolved.telnyx ?? {};
    resolved.telnyx.apiKey = resolved.telnyx.apiKey ?? process.env.TELNYX_API_KEY;
    resolved.telnyx.messagingProfileId =
      resolved.telnyx.messagingProfileId ?? process.env.TELNYX_MESSAGING_PROFILE_ID;
    resolved.telnyx.publicKey = resolved.telnyx.publicKey ?? process.env.TELNYX_PUBLIC_KEY;
  }

  if (resolved.provider === "plivo") {
    resolved.plivo = resolved.plivo ?? {};
    resolved.plivo.authId = resolved.plivo.authId ?? process.env.PLIVO_AUTH_ID;
    resolved.plivo.authToken = resolved.plivo.authToken ?? process.env.PLIVO_AUTH_TOKEN;
  }

  resolved.tunnel = resolved.tunnel ?? { provider: "none" };
  resolved.tunnel.ngrokAuthToken = resolved.tunnel.ngrokAuthToken ?? process.env.NGROK_AUTHTOKEN;
  resolved.tunnel.ngrokDomain = resolved.tunnel.ngrokDomain ?? process.env.NGROK_DOMAIN;

  return resolved;
}

/**
 * Validate that the configuration has all required fields for the selected provider.
 */
export function validateProviderConfig(config: TelephonyConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!config.enabled) {
    return { valid: true, errors: [] };
  }

  if (!config.provider) {
    errors.push("channels.telephony.provider is required");
  }

  if (!config.fromNumber && config.provider !== "mock") {
    errors.push("channels.telephony.fromNumber is required");
  }

  if (config.provider === "twilio") {
    if (!config.twilio?.accountSid) {
      errors.push(
        "channels.telephony.twilio.accountSid is required (or set TWILIO_ACCOUNT_SID env)",
      );
    }
    if (!config.twilio?.authToken) {
      errors.push(
        "channels.telephony.twilio.authToken is required (or set TWILIO_AUTH_TOKEN env)",
      );
    }
  }

  if (config.provider === "telnyx") {
    if (!config.telnyx?.apiKey) {
      errors.push(
        "channels.telephony.telnyx.apiKey is required (or set TELNYX_API_KEY env)",
      );
    }
    if (!config.skipSignatureVerification && !config.telnyx?.publicKey) {
      errors.push(
        "channels.telephony.telnyx.publicKey is required for webhook verification (or set TELNYX_PUBLIC_KEY env)",
      );
    }
  }

  if (config.provider === "plivo") {
    if (!config.plivo?.authId) {
      errors.push(
        "channels.telephony.plivo.authId is required (or set PLIVO_AUTH_ID env)",
      );
    }
    if (!config.plivo?.authToken) {
      errors.push(
        "channels.telephony.plivo.authToken is required (or set PLIVO_AUTH_TOKEN env)",
      );
    }
  }

  return { valid: errors.length === 0, errors };
}
