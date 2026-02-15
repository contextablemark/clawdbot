import type { GatewayRequestHandlerOptions, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import {
  TelephonyConfigSchema,
  resolveTelephonyConfig,
  validateProviderConfig,
  type TelephonyConfig,
} from "./src/config.js";
import { telephonyPlugin, setTelephonyProvider, setTelephonyConfig } from "./src/channel.js";
import { createTelephonyRuntime, createProvider, type TelephonyRuntime } from "./src/runtime.js";
import type { InboundSmsEvent, NormalizedSmsEvent } from "./src/types.js";

// -----------------------------------------------------------------------------
// Config Schema Parser
// -----------------------------------------------------------------------------

const telephonyConfigSchema = {
  parse(value: unknown): TelephonyConfig {
    const raw =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

    const enabled = typeof raw.enabled === "boolean" ? raw.enabled : true;
    const provider = raw.provider ?? (enabled ? "mock" : undefined);

    return TelephonyConfigSchema.parse({
      ...raw,
      enabled,
      provider,
    });
  },
  uiHints: {
    provider: {
      label: "Provider",
      help: "Use twilio, telnyx, plivo, or mock for dev.",
    },
    fromNumber: { label: "From Number", placeholder: "+15550001234" },
    inboundPolicy: { label: "Inbound Policy" },
    allowFrom: { label: "Inbound Allowlist" },
    "twilio.accountSid": { label: "Twilio Account SID" },
    "twilio.authToken": { label: "Twilio Auth Token", sensitive: true },
    "twilio.messagingServiceSid": {
      label: "Twilio Messaging Service SID",
      advanced: true,
    },
    "telnyx.apiKey": { label: "Telnyx API Key", sensitive: true },
    "telnyx.messagingProfileId": {
      label: "Telnyx Messaging Profile ID",
      advanced: true,
    },
    "telnyx.publicKey": { label: "Telnyx Public Key", sensitive: true },
    "plivo.authId": { label: "Plivo Auth ID" },
    "plivo.authToken": { label: "Plivo Auth Token", sensitive: true },
    "sms.chunkMode": { label: "SMS Chunk Mode", advanced: true },
    "sms.maxLength": { label: "SMS Max Length", advanced: true },
    "sms.segmentNumbering": {
      label: "SMS Segment Numbering",
      advanced: true,
    },
    "voice.enabled": { label: "Enable Voice Calls", advanced: true },
    "serve.port": { label: "Webhook Port" },
    "serve.bind": { label: "Webhook Bind" },
    "serve.path": { label: "Webhook Path" },
    "serve.statusPath": { label: "Status Callback Path", advanced: true },
    "tunnel.provider": { label: "Tunnel Provider", advanced: true },
    "tunnel.ngrokAuthToken": {
      label: "ngrok Auth Token",
      sensitive: true,
      advanced: true,
    },
    "tunnel.ngrokDomain": { label: "ngrok Domain", advanced: true },
    publicUrl: { label: "Public Webhook URL", advanced: true },
    skipSignatureVerification: {
      label: "Skip Signature Verification",
      advanced: true,
    },
  },
};

// -----------------------------------------------------------------------------
// Tool Schemas
// -----------------------------------------------------------------------------

const SendSmsToolSchema = Type.Object({
  action: Type.Literal("send_sms"),
  to: Type.String({ description: "Destination phone number (E.164)" }),
  message: Type.String({ description: "SMS message text" }),
});

const SendMmsToolSchema = Type.Object({
  action: Type.Literal("send_mms"),
  to: Type.String({ description: "Destination phone number (E.164)" }),
  message: Type.String({ description: "MMS message text" }),
  mediaUrl: Type.String({ description: "URL of media to attach" }),
});

const GetStatusToolSchema = Type.Object({
  action: Type.Literal("get_status"),
  messageId: Type.String({ description: "Message ID to check" }),
});

const InitiateCallToolSchema = Type.Object({
  action: Type.Literal("initiate_call"),
  to: Type.String({ description: "Phone number to call (E.164)" }),
  webhookUrl: Type.Optional(Type.String({ description: "Webhook URL for call events" })),
});

const TelephonyToolSchema = Type.Union([
  SendSmsToolSchema,
  SendMmsToolSchema,
  GetStatusToolSchema,
  InitiateCallToolSchema,
]);

// -----------------------------------------------------------------------------
// Plugin Definition
// -----------------------------------------------------------------------------

const plugin = {
  id: "telephony",
  name: "Telephony",
  description: "Unified SMS/Voice channel with Twilio/Telnyx/Plivo providers",
  configSchema: telephonyConfigSchema,

  register(api: OpenClawPluginApi) {
    const config = resolveTelephonyConfig(telephonyConfigSchema.parse(api.pluginConfig));
    const validation = validateProviderConfig(config);

    // Set config reference for channel outbound
    setTelephonyConfig(config);

    // Create provider (even if not yet started, so tools can use it)
    if (config.enabled && validation.valid) {
      const provider = createProvider(config);
      setTelephonyProvider(provider);
    }

    // Register channel
    api.registerChannel({ plugin: telephonyPlugin });

    // -------------------------------------------------------------------------
    // Runtime Management
    // -------------------------------------------------------------------------

    let runtimePromise: Promise<TelephonyRuntime> | null = null;
    let runtime: TelephonyRuntime | null = null;

    const ensureRuntime = async () => {
      if (!config.enabled) {
        throw new Error("Telephony channel disabled in config");
      }
      if (!validation.valid) {
        throw new Error(validation.errors.join("; "));
      }
      if (runtime) return runtime;
      if (!runtimePromise) {
        runtimePromise = createTelephonyRuntime({
          config,
          onEvent: (event: NormalizedSmsEvent) => {
            handleEvent(event);
          },
        });
      }
      runtime = await runtimePromise;
      return runtime;
    };

    // -------------------------------------------------------------------------
    // Inbound Event Handler
    // -------------------------------------------------------------------------

    const handleEvent = (event: NormalizedSmsEvent) => {
      if (event.type === "inbound_sms") {
        handleInboundSms(event);
      } else if (event.type === "delivery_status") {
        api.logger.info(
          `[telephony] Delivery status for ${event.messageId}: ${event.status}`,
        );
      } else if (event.type === "sms_error") {
        api.logger.error(
          `[telephony] SMS error: ${event.errorCode} - ${event.errorMessage}`,
        );
      }
    };

    const handleInboundSms = (event: InboundSmsEvent) => {
      api.logger.info(
        `[telephony] Inbound SMS from ${event.from}: ${event.body.slice(0, 80)}${event.body.length > 80 ? "…" : ""}`,
      );

      // Forward to the gateway hooks system as a channel message
      api.emitEvent?.("channel.message", {
        channel: "telephony",
        from: event.from,
        to: event.to,
        body: event.body,
        messageId: event.messageId,
        mediaUrls: event.mediaUrls,
        timestamp: event.timestamp,
      });
    };

    // -------------------------------------------------------------------------
    // Gateway Methods
    // -------------------------------------------------------------------------

    const sendError = (respond: (ok: boolean, payload?: unknown) => void, err: unknown) => {
      respond(false, { error: err instanceof Error ? err.message : String(err) });
    };

    api.registerGatewayMethod(
      "telephony.send",
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        try {
          const to = typeof params?.to === "string" ? params.to.trim() : "";
          const message = typeof params?.message === "string" ? params.message.trim() : "";
          if (!to || !message) {
            respond(false, { error: "to and message required" });
            return;
          }
          const rt = await ensureRuntime();
          const result = await rt.provider.sendSms({
            to,
            from: rt.config.fromNumber || "",
            body: message,
          });
          respond(true, { messageId: result.messageId, status: result.status });
        } catch (err) {
          sendError(respond, err);
        }
      },
    );

    api.registerGatewayMethod(
      "telephony.send_mms",
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        try {
          const to = typeof params?.to === "string" ? params.to.trim() : "";
          const message = typeof params?.message === "string" ? params.message.trim() : "";
          const mediaUrl = typeof params?.mediaUrl === "string" ? params.mediaUrl.trim() : "";
          if (!to) {
            respond(false, { error: "to required" });
            return;
          }
          const rt = await ensureRuntime();
          const result = await rt.provider.sendMms({
            to,
            from: rt.config.fromNumber || "",
            body: message,
            mediaUrls: mediaUrl ? [mediaUrl] : [],
          });
          respond(true, { messageId: result.messageId, status: result.status });
        } catch (err) {
          sendError(respond, err);
        }
      },
    );

    api.registerGatewayMethod(
      "telephony.call",
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        try {
          const to = typeof params?.to === "string" ? params.to.trim() : "";
          if (!to) {
            respond(false, { error: "to required" });
            return;
          }
          const rt = await ensureRuntime();
          if (!rt.provider.initiateCall) {
            respond(false, { error: "Voice calls not supported by current provider" });
            return;
          }
          const result = await rt.provider.initiateCall({
            to,
            from: rt.config.fromNumber || "",
            webhookUrl: typeof params?.webhookUrl === "string" ? params.webhookUrl : undefined,
          });
          respond(true, { callId: result.callId, status: result.status });
        } catch (err) {
          sendError(respond, err);
        }
      },
    );

    // -------------------------------------------------------------------------
    // Agent Tool
    // -------------------------------------------------------------------------

    api.registerTool({
      name: "telephony",
      label: "Telephony (SMS/Voice)",
      description:
        "Send SMS/MMS messages and initiate voice calls via the unified telephony channel. " +
        "Supports Twilio, Telnyx, and Plivo providers.",
      parameters: TelephonyToolSchema,
      async execute(_toolCallId, params) {
        const json = (payload: unknown) => ({
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
          details: payload,
        });

        try {
          const rt = await ensureRuntime();

          switch (params.action) {
            case "send_sms": {
              const to = String(params.to).trim();
              const message = String(params.message).trim();
              if (!to || !message) throw new Error("to and message required");

              const result = await rt.provider.sendSms({
                to,
                from: rt.config.fromNumber || "",
                body: message,
              });
              return json({
                sent: true,
                messageId: result.messageId,
                status: result.status,
                segments: result.segments,
                provider: result.provider,
              });
            }

            case "send_mms": {
              const to = String(params.to).trim();
              const message = String(params.message).trim();
              const mediaUrl = String(params.mediaUrl).trim();
              if (!to) throw new Error("to required");

              const result = await rt.provider.sendMms({
                to,
                from: rt.config.fromNumber || "",
                body: message,
                mediaUrls: [mediaUrl],
              });
              return json({
                sent: true,
                messageId: result.messageId,
                status: result.status,
                provider: result.provider,
              });
            }

            case "get_status": {
              // Status check is provider-specific; return a placeholder
              return json({
                messageId: params.messageId,
                note: "Use the provider dashboard for detailed delivery status",
              });
            }

            case "initiate_call": {
              const to = String(params.to).trim();
              if (!to) throw new Error("to required");
              if (!rt.provider.initiateCall) {
                throw new Error("Voice calls not supported by current provider");
              }
              const result = await rt.provider.initiateCall({
                to,
                from: rt.config.fromNumber || "",
                webhookUrl: params.webhookUrl,
              });
              return json({
                initiated: true,
                callId: result.callId,
                status: result.status,
                provider: result.provider,
              });
            }

            default:
              throw new Error(`Unknown action: ${(params as Record<string, unknown>).action}`);
          }
        } catch (err) {
          return json({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    });

    // -------------------------------------------------------------------------
    // CLI Commands
    // -------------------------------------------------------------------------

    api.registerCli(
      ({ program }) => {
        const cmd = program
          .command("telephony")
          .description("Telephony channel commands (SMS/Voice)");

        cmd
          .command("send <to> <message>")
          .description("Send an SMS message")
          .action(async (to: string, message: string) => {
            try {
              const rt = await ensureRuntime();
              const result = await rt.provider.sendSms({
                to,
                from: rt.config.fromNumber || "",
                body: message,
              });
              console.log(
                `Sent: ${result.messageId} (${result.status}, ${result.segments ?? 1} segment(s))`,
              );
            } catch (err) {
              console.error(`Failed: ${err instanceof Error ? err.message : err}`);
              process.exitCode = 1;
            }
          });

        cmd
          .command("call <to>")
          .description("Initiate a voice call")
          .action(async (to: string) => {
            try {
              const rt = await ensureRuntime();
              if (!rt.provider.initiateCall) {
                console.error("Voice calls not supported by current provider");
                process.exitCode = 1;
                return;
              }
              const result = await rt.provider.initiateCall({
                to,
                from: rt.config.fromNumber || "",
              });
              console.log(`Call initiated: ${result.callId} (${result.status})`);
            } catch (err) {
              console.error(`Failed: ${err instanceof Error ? err.message : err}`);
              process.exitCode = 1;
            }
          });

        cmd
          .command("status")
          .description("Show telephony channel status")
          .action(async () => {
            console.log(`Provider: ${config.provider || "(not set)"}`);
            console.log(`From:     ${config.fromNumber || "(not set)"}`);
            console.log(`Enabled:  ${config.enabled}`);
            console.log(`Inbound:  ${config.inboundPolicy}`);
            if (config.allowFrom.length > 0) {
              console.log(`Allow:    ${config.allowFrom.join(", ")}`);
            }
            if (validation.errors.length > 0) {
              console.log(`Errors:   ${validation.errors.join("; ")}`);
            }
          });
      },
      { commands: ["telephony"] },
    );

    // -------------------------------------------------------------------------
    // Service Lifecycle
    // -------------------------------------------------------------------------

    api.registerService({
      id: "telephony",
      start: async () => {
        if (!config.enabled) return;
        try {
          await ensureRuntime();
          api.logger.info("[telephony] Service started");
        } catch (err) {
          api.logger.error(
            `[telephony] Failed to start: ${err instanceof Error ? err.message : err}`,
          );
        }
      },
      stop: async () => {
        if (!runtimePromise) return;
        try {
          const rt = await runtimePromise;
          await rt.stop();
          api.logger.info("[telephony] Service stopped");
        } finally {
          runtimePromise = null;
          runtime = null;
        }
      },
    });
  },
};

export default plugin;
