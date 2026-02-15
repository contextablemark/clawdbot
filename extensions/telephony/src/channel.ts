import {
  applyAccountNameToChannelSection,
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  formatPairingApproveHint,
  migrateBaseNameToDefaultAccount,
  normalizeAccountId,
  normalizeE164,
  type ChannelPlugin,
} from "openclaw/plugin-sdk";
import { TelephonyConfigSchema, type TelephonyConfig } from "./config.js";
import { chunkSmsForOutbound } from "./sms-chunker.js";
import type { TelephonyProvider } from "./providers/base.js";

// -----------------------------------------------------------------------------
// Resolved Account Type
// -----------------------------------------------------------------------------

export type ResolvedTelephonyAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  provider?: string;
  fromNumber?: string;
  dmPolicy?: string;
  allowFrom?: string[];
  inboundPolicy?: string;
};

// -----------------------------------------------------------------------------
// Account Resolution
// -----------------------------------------------------------------------------

function listTelephonyAccountIds(cfg: Record<string, unknown>): string[] {
  const channels = cfg.channels as Record<string, unknown> | undefined;
  const telephony = channels?.telephony as Record<string, unknown> | undefined;
  if (!telephony) return [];

  const accounts = telephony.accounts as Record<string, unknown> | undefined;
  if (accounts && Object.keys(accounts).length > 0) {
    return Object.keys(accounts);
  }

  // Single-account mode (no accounts sub-key)
  if (telephony.provider || telephony.fromNumber) {
    return [DEFAULT_ACCOUNT_ID];
  }

  return [];
}

function resolveDefaultAccountId(cfg: Record<string, unknown>): string {
  const ids = listTelephonyAccountIds(cfg);
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

function resolveTelephonyAccount(params: {
  cfg: Record<string, unknown>;
  accountId?: string | null;
}): ResolvedTelephonyAccount {
  const { cfg, accountId } = params;
  const channels = cfg.channels as Record<string, unknown> | undefined;
  const telephony = channels?.telephony as Record<string, unknown> | undefined;

  if (!telephony) {
    return {
      accountId: accountId ?? DEFAULT_ACCOUNT_ID,
      enabled: false,
    };
  }

  const resolvedAccountId = accountId ?? resolveDefaultAccountId(cfg);

  // Multi-account mode
  const accounts = telephony.accounts as Record<string, Record<string, unknown>> | undefined;
  if (accounts?.[resolvedAccountId]) {
    const acct = accounts[resolvedAccountId];
    return {
      accountId: resolvedAccountId,
      name: acct.name as string | undefined,
      enabled: acct.enabled !== false,
      provider: (acct.provider as string) ?? (telephony.provider as string),
      fromNumber: (acct.fromNumber as string) ?? (telephony.fromNumber as string),
      dmPolicy: (acct.dmPolicy as string) ?? (telephony.dmPolicy as string) ?? "pairing",
      allowFrom: (acct.allowFrom as string[]) ?? (telephony.allowFrom as string[]) ?? [],
      inboundPolicy: (acct.inboundPolicy as string) ?? (telephony.inboundPolicy as string) ?? "pairing",
    };
  }

  // Single-account mode
  return {
    accountId: resolvedAccountId,
    enabled: telephony.enabled !== false,
    provider: telephony.provider as string | undefined,
    fromNumber: telephony.fromNumber as string | undefined,
    dmPolicy: (telephony.dmPolicy as string) ?? "pairing",
    allowFrom: (telephony.allowFrom as string[]) ?? [],
    inboundPolicy: (telephony.inboundPolicy as string) ?? "pairing",
  };
}

// -----------------------------------------------------------------------------
// Provider Reference (set by index.ts during registration)
// -----------------------------------------------------------------------------

let _provider: TelephonyProvider | null = null;

export function setTelephonyProvider(provider: TelephonyProvider): void {
  _provider = provider;
}

function getProvider(): TelephonyProvider {
  if (!_provider) {
    throw new Error("Telephony provider not initialized");
  }
  return _provider;
}

// -----------------------------------------------------------------------------
// Channel Plugin Definition
// -----------------------------------------------------------------------------

export const telephonyPlugin: ChannelPlugin<ResolvedTelephonyAccount> = {
  id: "telephony",

  meta: {
    id: "telephony",
    label: "Telephony (SMS/Voice)",
    selectionLabel: "Telephony",
    docsPath: "telephony",
    blurb: "Send and receive SMS/MMS via Twilio, Telnyx, or Plivo. Unified telephony channel with optional voice support.",
    order: 20,
    aliases: ["sms", "phone"],
    quickstartAllowFrom: true,
    forceAccountBinding: true,
  },

  pairing: {
    idLabel: "phoneNumber",
    normalizeAllowEntry: (entry) => normalizeE164(entry),
    notifyApproval: async ({ id }) => {
      try {
        const provider = getProvider();
        const config = _resolvedConfig;
        if (!config?.fromNumber) return;
        await provider.sendSms({
          to: id,
          from: config.fromNumber,
          body: "Your phone number has been approved. You can now send messages to this bot.",
        });
      } catch {
        // Best-effort notification; don't fail the approval
      }
    },
  },

  capabilities: {
    chatTypes: ["direct"],
    media: true,
    reactions: false,
    polls: false,
    edit: false,
    unsend: false,
    reply: false,
    threads: false,
  },

  configSchema: buildChannelConfigSchema(TelephonyConfigSchema),

  config: {
    listAccountIds: (cfg) => listTelephonyAccountIds(cfg as Record<string, unknown>),
    resolveAccount: (cfg, accountId) =>
      resolveTelephonyAccount({ cfg: cfg as Record<string, unknown>, accountId }),
    defaultAccountId: (cfg) => resolveDefaultAccountId(cfg as Record<string, unknown>),

    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      const accountKey = accountId || DEFAULT_ACCOUNT_ID;
      const raw = cfg as Record<string, unknown>;
      const channels = (raw.channels ?? {}) as Record<string, unknown>;
      const telephony = (channels.telephony ?? {}) as Record<string, unknown>;
      const accounts = (telephony.accounts ?? {}) as Record<string, unknown>;
      const existing = (accounts[accountKey] ?? {}) as Record<string, unknown>;
      return {
        ...raw,
        channels: {
          ...channels,
          telephony: {
            ...telephony,
            accounts: {
              ...accounts,
              [accountKey]: { ...existing, enabled },
            },
          },
        },
      } as typeof cfg;
    },

    deleteAccount: ({ cfg, accountId }) => {
      const accountKey = accountId || DEFAULT_ACCOUNT_ID;
      const raw = cfg as Record<string, unknown>;
      const channels = (raw.channels ?? {}) as Record<string, unknown>;
      const telephony = (channels.telephony ?? {}) as Record<string, unknown>;
      const accounts = { ...(telephony.accounts as Record<string, unknown>) };
      delete accounts[accountKey];
      return {
        ...raw,
        channels: {
          ...channels,
          telephony: {
            ...telephony,
            accounts: Object.keys(accounts).length ? accounts : undefined,
          },
        },
      } as typeof cfg;
    },

    isEnabled: (account) => account.enabled,
    disabledReason: () => "disabled",
    isConfigured: (account) => Boolean(account.provider && account.fromNumber),
    unconfiguredReason: () => "no provider or phone number configured",

    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.provider && account.fromNumber),
      provider: account.provider,
      fromNumber: account.fromNumber,
      dmPolicy: account.dmPolicy,
      allowFrom: account.allowFrom,
    }),

    resolveAllowFrom: ({ cfg, accountId }) =>
      resolveTelephonyAccount({ cfg: cfg as Record<string, unknown>, accountId }).allowFrom ?? [],

    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => (entry === "*" ? entry : normalizeE164(entry)))
        .filter(Boolean),
  },

  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const raw = cfg as Record<string, unknown>;
      const telephony = (raw.channels as Record<string, unknown>)?.telephony as Record<string, unknown> | undefined;
      const useAccountPath = Boolean(
        (telephony?.accounts as Record<string, unknown>)?.[resolvedAccountId],
      );
      const basePath = useAccountPath
        ? `channels.telephony.accounts.${resolvedAccountId}.`
        : "channels.telephony.";
      return {
        policy: account.dmPolicy ?? "pairing",
        allowFrom: account.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: basePath,
        approveHint: formatPairingApproveHint("telephony"),
        normalizeEntry: (raw: string) => normalizeE164(raw),
      };
    },
  },

  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({
        cfg,
        channelKey: "telephony",
        accountId,
        name,
        alwaysUseAccounts: false,
      }),
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const namedConfig = applyAccountNameToChannelSection({
        cfg,
        channelKey: "telephony",
        accountId,
        name: input.name,
        alwaysUseAccounts: false,
      });
      const next = migrateBaseNameToDefaultAccount({
        cfg: namedConfig,
        channelKey: "telephony",
        alwaysUseAccounts: false,
      });
      const raw = next as Record<string, unknown>;
      const channels = (raw.channels ?? {}) as Record<string, unknown>;
      const telephony = (channels.telephony ?? {}) as Record<string, unknown>;
      const accounts = (telephony.accounts ?? {}) as Record<string, unknown>;
      const entry = {
        ...(accounts[accountId] as Record<string, unknown>),
        enabled: true,
      };
      return {
        ...raw,
        channels: {
          ...channels,
          telephony: {
            ...telephony,
            accounts: {
              ...accounts,
              [accountId]: entry,
            },
          },
        },
      } as typeof cfg;
    },
  },

  messaging: {
    normalizeTarget: (target) => normalizeE164(target),
    targetResolver: {
      looksLikeId: (target) => /^\+[1-9]\d{1,14}$/.test(target),
      hint: "<E.164 phone number>",
    },
  },

  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => chunkSmsForOutbound(text, limit),
    chunkerMode: "text",
    textChunkLimit: 1600,

    resolveTarget: ({ to, allowFrom }) => {
      if (!to) {
        if (allowFrom?.length === 1 && allowFrom[0] !== "*") {
          return { ok: true, to: allowFrom[0] };
        }
        return { ok: false, error: new Error("'to' phone number required (E.164 format)") };
      }
      const normalized = normalizeE164(to);
      if (!normalized) {
        return { ok: false, error: new Error(`Invalid phone number: ${to}`) };
      }
      return { ok: true, to: normalized };
    },

    sendText: async ({ to, text, accountId }) => {
      const provider = getProvider();
      const config = _resolvedConfig;
      if (!config?.fromNumber) {
        throw new Error("Telephony fromNumber not configured");
      }

      const result = await provider.sendSms({
        to,
        from: config.fromNumber,
        body: text,
      });

      return {
        channel: "telephony",
        ok: true,
        messageId: result.messageId,
        accountId: accountId ?? DEFAULT_ACCOUNT_ID,
      };
    },

    sendMedia: async ({ to, text, mediaUrl, accountId }) => {
      const provider = getProvider();
      const config = _resolvedConfig;
      if (!config?.fromNumber) {
        throw new Error("Telephony fromNumber not configured");
      }

      if (mediaUrl) {
        const result = await provider.sendMms({
          to,
          from: config.fromNumber,
          body: text || "",
          mediaUrls: [mediaUrl],
        });
        return {
          channel: "telephony",
          ok: true,
          messageId: result.messageId,
          accountId: accountId ?? DEFAULT_ACCOUNT_ID,
        };
      }

      // No media URL, fall back to text
      const result = await provider.sendSms({
        to,
        from: config.fromNumber,
        body: text || "",
      });
      return {
        channel: "telephony",
        ok: true,
        messageId: result.messageId,
        accountId: accountId ?? DEFAULT_ACCOUNT_ID,
      };
    },
  },

  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      connected: false,
    },
    buildAccountSnapshot: async ({ account }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.provider && account.fromNumber),
      provider: account.provider,
      fromNumber: account.fromNumber,
      dmPolicy: account.dmPolicy,
      allowFrom: account.allowFrom,
    }),
    resolveAccountState: ({ configured, enabled }) => {
      if (!configured) return "not configured";
      if (!enabled) return "disabled";
      return "ready";
    },
  },

  gateway: {
    startAccount: async (ctx) => {
      ctx.log?.info(
        `[telephony:${ctx.account.accountId}] starting (provider=${ctx.account.provider}, from=${ctx.account.fromNumber})`,
      );
      ctx.setStatus?.({
        accountId: ctx.accountId,
        running: true,
        connected: true,
      });
    },
    stopAccount: async (ctx) => {
      ctx.log?.info(`[telephony:${ctx.account.accountId}] stopping`);
    },
  },
};

// Internal reference to resolved config (set by index.ts)
let _resolvedConfig: TelephonyConfig | null = null;

export function setTelephonyConfig(config: TelephonyConfig): void {
  _resolvedConfig = config;
}
