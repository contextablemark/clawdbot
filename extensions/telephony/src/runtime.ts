import type { TelephonyConfig } from "./config.js";
import type { TelephonyProvider } from "./providers/base.js";
import {
  MockProvider,
  PlivoProvider,
  TelnyxProvider,
  TwilioProvider,
} from "./providers/index.js";
import { TelephonyWebhookServer, type WebhookEventHandler } from "./webhook.js";

export type TelephonyRuntime = {
  config: TelephonyConfig;
  provider: TelephonyProvider;
  webhookServer: TelephonyWebhookServer;
  stop: () => Promise<void>;
};

/**
 * Create a provider instance from configuration.
 */
export function createProvider(config: TelephonyConfig): TelephonyProvider {
  switch (config.provider) {
    case "twilio": {
      if (!config.twilio?.accountSid || !config.twilio?.authToken) {
        throw new Error("Twilio accountSid and authToken are required");
      }
      return new TwilioProvider({
        accountSid: config.twilio.accountSid,
        authToken: config.twilio.authToken,
        messagingServiceSid: config.twilio.messagingServiceSid,
        publicUrl: config.publicUrl,
        skipSignatureVerification: config.skipSignatureVerification,
      });
    }
    case "telnyx": {
      if (!config.telnyx?.apiKey) {
        throw new Error("Telnyx apiKey is required");
      }
      return new TelnyxProvider({
        apiKey: config.telnyx.apiKey,
        messagingProfileId: config.telnyx.messagingProfileId,
        publicKey: config.telnyx.publicKey,
        skipSignatureVerification: config.skipSignatureVerification,
      });
    }
    case "plivo": {
      if (!config.plivo?.authId || !config.plivo?.authToken) {
        throw new Error("Plivo authId and authToken are required");
      }
      return new PlivoProvider({
        authId: config.plivo.authId,
        authToken: config.plivo.authToken,
        publicUrl: config.publicUrl,
        skipSignatureVerification: config.skipSignatureVerification,
      });
    }
    case "mock":
      return new MockProvider();
    default:
      throw new Error(`Unknown telephony provider: ${config.provider}`);
  }
}

/**
 * Create the telephony runtime (provider + webhook server).
 */
export async function createTelephonyRuntime(params: {
  config: TelephonyConfig;
  onEvent: WebhookEventHandler;
}): Promise<TelephonyRuntime> {
  const { config, onEvent } = params;
  const provider = createProvider(config);
  const webhookServer = new TelephonyWebhookServer(config, provider, onEvent);

  await webhookServer.start();

  return {
    config,
    provider,
    webhookServer,
    stop: async () => {
      await webhookServer.stop();
    },
  };
}
