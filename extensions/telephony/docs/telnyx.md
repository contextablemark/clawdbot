# Telnyx Integration Guide

Complete guide to setting up the OpenClaw telephony channel with **Telnyx** as the SMS/Voice provider.

## Prerequisites

- A Telnyx account ([sign up](https://telnyx.com/sign-up))
- A Telnyx phone number with messaging capability
- A Telnyx Messaging Profile
- OpenClaw installed and running on a server reachable from the internet

## Step 1: Get Your Telnyx Credentials

### API Key

1. Log in to the [Telnyx Mission Control Portal](https://portal.telnyx.com/)
2. Navigate to **Auth** → **API Keys** (or **Account** → **Keys & Credentials**)
3. Create a new API key or use an existing one
4. Copy the key — it starts with `KEY` and is used for all API calls

### Public Key (for webhook verification)

1. In Mission Control, go to **Auth** → **Public Key**
2. Copy the Base64-encoded public key
3. This is used to verify Ed25519 signatures on incoming webhooks

## Step 2: Create a Messaging Profile

1. Go to **Messaging** → **Messaging Profiles**
2. Click **Add New Profile**
3. Name it (e.g., "OpenClaw SMS")
4. Under **Inbound Settings**:
   - Set **Send a webhook to**: `https://your-public-url/telephony/webhook`
   - Set **HTTP Method**: `POST`
5. Under **Outbound Settings**:
   - Set **Status callback URL** (optional): `https://your-public-url/telephony/status`
6. Save the profile
7. Copy the **Messaging Profile ID** (UUID format)

## Step 3: Get a Phone Number

1. Go to **Numbers** → **Search & Buy**
2. Search for a number with **SMS/MMS** capability
3. Purchase the number
4. Assign it to your Messaging Profile:
   - Go to **Numbers** → **My Numbers**
   - Click the number
   - Set **Messaging Profile** to the one you created
5. Note the number in E.164 format (e.g., `+15550001234`)

## Step 4: Configure OpenClaw

Add to your OpenClaw configuration under `channels.telephony`:

```json5
{
  channels: {
    telephony: {
      enabled: true,
      provider: "telnyx",
      fromNumber: "+15550001234",
      inboundPolicy: "pairing",

      telnyx: {
        apiKey: "KEYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        messagingProfileId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        publicKey: "base64_encoded_ed25519_public_key",
      },

      serve: {
        port: 3335,
        bind: "0.0.0.0",
        path: "/telephony/webhook",
      },
    },
  },
}
```

### Using Environment Variables (recommended for production)

```bash
export TELNYX_API_KEY="KEYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export TELNYX_MESSAGING_PROFILE_ID="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
export TELNYX_PUBLIC_KEY="base64_encoded_public_key"
```

Then simplify the config:

```json5
{
  channels: {
    telephony: {
      enabled: true,
      provider: "telnyx",
      fromNumber: "+15550001234",
      inboundPolicy: "pairing",
      serve: { port: 3335, bind: "0.0.0.0" },
    },
  },
}
```

## Step 5: Expose Your Webhook

Telnyx needs to reach your server to deliver inbound SMS. Choose one approach:

### Option A: ngrok (development)

```json5
tunnel: {
  provider: "ngrok",
}
```

### Option B: Public server

```json5
{
  publicUrl: "https://your-domain.com",
  serve: {
    port: 3335,
    bind: "127.0.0.1",
    path: "/telephony/webhook",
  },
}
```

### Option C: Tailscale Funnel

```json5
tunnel: {
  provider: "tailscale-funnel",
}
```

## Step 6: Test It

### Send an outbound SMS

```bash
openclaw telephony send +15550005678 "Hello from OpenClaw via Telnyx!"
```

### Test inbound

Send an SMS to your Telnyx number and approve the pairing:

```bash
openclaw pairing approve telephony <code>
```

## Webhook Signature Verification

Telnyx uses **Ed25519** signatures for webhook verification — stronger than HMAC-based schemes.

### How it works

1. Telnyx sends two headers: `telnyx-signature-ed25519` and `telnyx-timestamp`
2. The signing payload is: `{timestamp}|{raw_body}`
3. The signature is verified against Telnyx's public key
4. Timestamps older than 5 minutes are rejected (replay protection)

### Important notes

- The public key is available in your Telnyx Mission Control portal under **Auth**
- Ed25519 verification uses the raw request body, so no URL reconstruction is needed
- Unlike HMAC, Ed25519 verification doesn't require sharing the signing secret

## Telnyx Webhook Event Types

The plugin handles these Telnyx webhook events:

| Event Type | Description |
|-----------|-------------|
| `message.received` | Inbound SMS/MMS received |
| `message.sent` | Outbound message sent to carrier |
| `message.delivered` | Outbound message delivered |
| `message.failed` | Message delivery failed |

## Telnyx Pricing Notes

- Outbound SMS: ~$0.004/message (US) — often cheaper than Twilio
- Inbound SMS: ~$0.004/message (US)
- MMS: ~$0.015/message (US)
- Phone number: ~$1.00/month (US local)
- Free inbound minutes on some plans
- See [Telnyx Pricing](https://telnyx.com/pricing) for current rates

## Troubleshooting

### "Missing telnyx-signature-ed25519 header"

- Ensure your Messaging Profile webhook URL is correct
- Verify you're checking the right endpoint path
- Telnyx may not send signatures to non-HTTPS URLs in some cases

### "Webhook timestamp too old"

- The plugin rejects webhooks with timestamps older than 5 minutes
- Check that your server clock is synchronized (use NTP)
- This can also happen if webhooks are being queued/delayed

### Messages not arriving

- Verify the Messaging Profile webhook URL points to your server
- Check that the phone number is assigned to the correct Messaging Profile
- Look at **Messaging** → **Logs** in Mission Control for delivery details
- Ensure the number has SMS capability (some Telnyx numbers are voice-only)

### "Verification error"

- Ensure the public key in config matches the one in Mission Control
- The key must be Base64-encoded (as shown in the portal)
- Try re-copying the key — whitespace or line breaks can cause issues

## Telnyx vs Twilio

| Feature | Telnyx | Twilio |
|---------|--------|--------|
| SMS pricing (US) | ~$0.004 | ~$0.0079 |
| Webhook security | Ed25519 | HMAC-SHA1 |
| API style | REST (JSON) | REST (form-encoded) |
| MMS support | Yes | Yes |
| Global coverage | Good | Excellent |
| Free tier | Limited | Trial with $15 credit |

## Full Configuration Example

```json5
{
  channels: {
    telephony: {
      enabled: true,
      provider: "telnyx",
      fromNumber: "+15550001234",
      inboundPolicy: "pairing",
      allowFrom: [],

      telnyx: {
        apiKey: "KEYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        messagingProfileId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        publicKey: "base64_public_key",
      },

      sms: {
        chunkMode: "auto",
        maxLength: 1600,
        segmentNumbering: true,
      },

      voice: {
        enabled: true,
        maxDurationSeconds: 300,
      },

      serve: {
        port: 3335,
        bind: "0.0.0.0",
        path: "/telephony/webhook",
        statusPath: "/telephony/status",
      },

      tunnel: {
        provider: "ngrok",
      },

      skipSignatureVerification: false,
      maxConcurrentSessions: 50,
    },
  },
}
```
