# @openclaw/telephony

Official unified Telephony channel plugin for **OpenClaw**.

Provides bi-directional SMS/MMS messaging and voice call capabilities through a single, first-class channel interface with multi-provider support.

## Providers

| Provider | SMS/MMS | Voice | Webhook Verification |
|----------|---------|-------|---------------------|
| **Twilio** | Programmable Messaging | Programmable Voice | HMAC-SHA1 |
| **Telnyx** | Messaging API v2 | Call Control v2 | Ed25519 |
| **Plivo** | Message API | Voice API | HMAC-SHA256 (V3) |
| **Mock** | Console logging | Console logging | None (dev only) |

Docs: `https://docs.openclaw.ai/channels/telephony`
Plugin system: `https://docs.openclaw.ai/plugin`

## Install

### Option A: Install via OpenClaw (recommended)

```bash
openclaw plugins install @openclaw/telephony
```

Restart the Gateway afterwards.

### Option B: Copy into your global extensions folder (dev)

```bash
mkdir -p ~/.openclaw/extensions
cp -R extensions/telephony ~/.openclaw/extensions/telephony
cd ~/.openclaw/extensions/telephony && pnpm install
```

## Quick Start

1. **Choose a provider** (Twilio, Telnyx, or Plivo)
2. **Get a phone number** from your provider
3. **Add credentials** to your OpenClaw config
4. **Point the provider's webhook** at your OpenClaw instance
5. **Start sending and receiving SMS**

### Minimal Configuration (Twilio example)

Add to your OpenClaw config under `channels.telephony`:

```json5
{
  channels: {
    telephony: {
      enabled: true,
      provider: "twilio",
      fromNumber: "+15550001234",
      inboundPolicy: "pairing",

      twilio: {
        accountSid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        authToken: "your_auth_token",
      },

      serve: {
        port: 3335,
        path: "/telephony/webhook",
      },
    },
  },
}
```

Or use environment variables:

```bash
export TWILIO_ACCOUNT_SID="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export TWILIO_AUTH_TOKEN="your_auth_token"
```

## Configuration Reference

### Top-Level Options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `false` | Enable the telephony channel |
| `provider` | string | — | `"twilio"`, `"telnyx"`, `"plivo"`, or `"mock"` |
| `fromNumber` | string | — | Phone number to send from (E.164, e.g. `+15550001234`) |
| `inboundPolicy` | string | `"pairing"` | How to handle inbound from unknown senders |
| `allowFrom` | string[] | `[]` | Phone numbers allowed for inbound (E.164) |
| `publicUrl` | string | — | Override public webhook URL |
| `skipSignatureVerification` | boolean | `false` | Skip webhook signature checks (dev only!) |
| `maxConcurrentSessions` | number | `50` | Max concurrent SMS sessions |

### Inbound Policies

| Policy | Behavior |
|--------|----------|
| `"disabled"` | Block all inbound messages (outbound only) |
| `"allowlist"` | Only accept from numbers in `allowFrom` |
| `"pairing"` | Unknown senders get a pairing code; admin approves |
| `"open"` | Accept all inbound messages (use with caution!) |

### Provider Configuration

#### Twilio

```json5
twilio: {
  accountSid: "ACxxxx",     // or TWILIO_ACCOUNT_SID env
  authToken: "xxxx",        // or TWILIO_AUTH_TOKEN env
  messagingServiceSid: "",  // optional, for A2P / sender rotation
}
```

#### Telnyx

```json5
telnyx: {
  apiKey: "KEYxxxx",              // or TELNYX_API_KEY env
  messagingProfileId: "xxxx",    // or TELNYX_MESSAGING_PROFILE_ID env
  publicKey: "base64...",         // or TELNYX_PUBLIC_KEY env (for webhook verification)
}
```

#### Plivo

```json5
plivo: {
  authId: "MAxxxx",     // or PLIVO_AUTH_ID env
  authToken: "xxxx",    // or PLIVO_AUTH_TOKEN env
}
```

### SMS Configuration

```json5
sms: {
  chunkMode: "auto",         // "auto" | "single" | "multi"
  maxLength: 1600,           // Max total chars before truncation
  segmentNumbering: true,    // Add "[1/3]" numbering to multi-part SMS
}
```

SMS encoding is auto-detected:
- **GSM-7**: 160 chars/segment (153 in multi-part) — standard ASCII + common symbols
- **UCS-2**: 70 chars/segment (67 in multi-part) — Unicode/emoji content

### Voice Configuration

```json5
voice: {
  enabled: false,            // Enable voice call capability
  maxDurationSeconds: 300,   // Max call duration
}
```

### Webhook Server

```json5
serve: {
  port: 3335,                     // Webhook server port
  bind: "127.0.0.1",             // Bind address
  path: "/telephony/webhook",     // Inbound SMS webhook path
  statusPath: "/telephony/status", // Delivery status callback path
}
```

### Tunnel Configuration

```json5
tunnel: {
  provider: "none",     // "none" | "ngrok" | "tailscale-serve" | "tailscale-funnel"
  ngrokAuthToken: "",   // or NGROK_AUTHTOKEN env
  ngrokDomain: "",      // or NGROK_DOMAIN env
}
```

### Webhook Security

```json5
webhookSecurity: {
  allowedHosts: [],              // Allowed hostnames for URL reconstruction
  trustForwardingHeaders: false, // Trust X-Forwarded-* headers
  trustedProxyIPs: [],           // Trusted proxy IPs
}
```

## Pairing Flow

When `inboundPolicy` is set to `"pairing"` (the default), unknown senders go through a pairing flow:

1. User sends any SMS to your bot's phone number
2. Bot responds with a pairing message containing an 8-character code
3. User gives the code to the bot administrator
4. Admin approves via CLI:

```bash
openclaw pairing approve telephony <code>
```

5. The phone number is added to the allow list
6. Bot sends a confirmation SMS to the now-approved number
7. Future messages from that number are routed to the agent

Pairing codes expire after **60 minutes** and at most **3** pending requests are kept per channel.

## Agent Tools

The plugin registers a `telephony` tool that agents can use:

### send_sms
```json
{ "action": "send_sms", "to": "+15550001234", "message": "Hello from OpenClaw!" }
```

### send_mms
```json
{ "action": "send_mms", "to": "+15550001234", "message": "Check this out", "mediaUrl": "https://example.com/photo.jpg" }
```

### initiate_call
```json
{ "action": "initiate_call", "to": "+15550001234" }
```

### get_status
```json
{ "action": "get_status", "messageId": "SMxxxxxxx" }
```

## CLI Commands

```bash
# Send an SMS
openclaw telephony send +15550001234 "Hello from the CLI!"

# Initiate a voice call
openclaw telephony call +15550001234

# Show channel status
openclaw telephony status
```

## Gateway Methods (RPC)

| Method | Params | Description |
|--------|--------|-------------|
| `telephony.send` | `{ to, message }` | Send SMS |
| `telephony.send_mms` | `{ to, message, mediaUrl }` | Send MMS |
| `telephony.call` | `{ to, webhookUrl? }` | Initiate voice call |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   OpenClaw Gateway                   │
│                                                     │
│  ┌──────────────┐  ┌────────────────────────────┐  │
│  │ Channel       │  │ Plugin Registration         │  │
│  │ (telephony)  │  │ - Tool: telephony           │  │
│  │ ┌──────────┐ │  │ - Gateway: telephony.*      │  │
│  │ │ Outbound │ │  │ - CLI: openclaw telephony   │  │
│  │ │ sendText │ │  │ - Service: webhook server   │  │
│  │ │ sendMedia│ │  └────────────────────────────┘  │
│  │ └──────────┘ │                                   │
│  │ ┌──────────┐ │  ┌────────────────────────────┐  │
│  │ │ Pairing  │ │  │ Provider Abstraction        │  │
│  │ │ (shared) │ │  │ ┌────────┐ ┌──────┐        │  │
│  │ └──────────┘ │  │ │ Twilio │ │Telnyx│ ...    │  │
│  └──────────────┘  │ └────────┘ └──────┘        │  │
│                     └────────────────────────────┘  │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │ Webhook Server (HTTP)                         │  │
│  │ POST /telephony/webhook   → inbound SMS       │  │
│  │ POST /telephony/status    → delivery reports  │  │
│  │ GET  /health              → health check      │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
         ▲                              │
         │ Inbound webhooks             │ Outbound API calls
         │                              ▼
  ┌──────────────────────────────────────────┐
  │   Provider (Twilio / Telnyx / Plivo)     │
  │   Phone Number: +15550001234             │
  └──────────────────────────────────────────┘
```

## Webhook Setup

Each provider needs to be configured to send webhooks to your OpenClaw instance.

### Public URL

Your webhook server must be reachable from the internet. Options:

1. **Direct**: Server on a public IP, `publicUrl` set to `https://your-domain.com`
2. **ngrok**: Set `tunnel.provider: "ngrok"` for automatic tunneling
3. **Tailscale Funnel**: Set `tunnel.provider: "tailscale-funnel"` for Tailscale-based exposure
4. **Reverse proxy**: Put nginx/caddy in front, set `publicUrl` accordingly

### Provider Webhook Configuration

- **Twilio**: Messaging → Phone Number → Messaging Configuration → "A message comes in" → `https://your-host/telephony/webhook`
- **Telnyx**: Messaging → Messaging Profile → Inbound Settings → Webhook URL → `https://your-host/telephony/webhook`
- **Plivo**: Messaging → Applications → Message URL → `https://your-host/telephony/webhook`

See the provider-specific guides in `docs/` for detailed setup instructions.

## Relationship to voice-call Plugin

This telephony channel is a **separate, coexisting** plugin alongside the existing `voice-call` plugin:

| Feature | `telephony` (this plugin) | `voice-call` |
|---------|--------------------------|--------------|
| **Type** | Channel + Plugin hybrid | Plugin only |
| **Primary use** | SMS/MMS messaging as a chat channel | Voice calls with TTS/STT |
| **Channel registration** | Yes (`api.registerChannel`) | No |
| **Pairing** | Yes (shared pairing store) | No |
| **Voice** | Basic call initiation | Full TTS/STT/streaming |
| **Session model** | Phone number → chat session | Call ID → call session |

Use `telephony` when you want SMS as a first-class messaging channel. Use `voice-call` when you need rich voice interaction with TTS/STT.

## Provider Guides

Detailed integration guides for each provider:

- [Twilio Setup Guide](docs/twilio.md)
- [Telnyx Setup Guide](docs/telnyx.md)
- [Plivo Setup Guide](docs/plivo.md)

## Development

```bash
# Run tests
pnpm vitest run --config vitest.extensions.config.ts extensions/telephony

# Run tests in watch mode
pnpm vitest --config vitest.extensions.config.ts extensions/telephony
```

## License

See the root LICENSE file.
