# Plivo Integration Guide

Complete guide to setting up the OpenClaw telephony channel with **Plivo** as the SMS/Voice provider.

## Prerequisites

- A Plivo account ([sign up](https://console.plivo.com/accounts/register/))
- A Plivo phone number with SMS capability
- OpenClaw installed and running on a server reachable from the internet

## Step 1: Get Your Plivo Credentials

1. Log in to the [Plivo Console](https://console.plivo.com/)
2. On the dashboard, find your **Auth ID** and **Auth Token**
3. Copy both values

> Your Auth ID starts with `MA` or `SA` and is 20 characters long.
> Your Auth Token is a 40-character string. Keep it secret!

## Step 2: Get a Phone Number

1. Go to **Phone Numbers** → **Buy Numbers**
2. Search for a number in your desired country with **SMS** capability
3. Purchase the number
4. Note the number in E.164 format (e.g., `+15550001234`)

## Step 3: Create a Messaging Application

1. Go to **Messaging** → **Applications**
2. Click **New Application**
3. Name it (e.g., "OpenClaw SMS")
4. Set **Message URL**: `https://your-public-url/telephony/webhook` (method: `POST`)
5. Save the application
6. Assign your phone number to this application:
   - Go to **Phone Numbers** → **Your Numbers**
   - Click the number
   - Under **Application**, select your messaging application
   - Save

## Step 4: Configure OpenClaw

Add to your OpenClaw configuration under `channels.telephony`:

```json5
{
  channels: {
    telephony: {
      enabled: true,
      provider: "plivo",
      fromNumber: "+15550001234",
      inboundPolicy: "pairing",

      plivo: {
        authId: "MAxxxxxxxxxxxxxxxxxxxxxxxx",
        authToken: "your_auth_token_here",
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
export PLIVO_AUTH_ID="MAxxxxxxxxxxxxxxxxxxxxxxxx"
export PLIVO_AUTH_TOKEN="your_auth_token_here"
```

Then simplify the config:

```json5
{
  channels: {
    telephony: {
      enabled: true,
      provider: "plivo",
      fromNumber: "+15550001234",
      inboundPolicy: "pairing",
      serve: { port: 3335, bind: "0.0.0.0" },
    },
  },
}
```

## Step 5: Expose Your Webhook

Plivo needs to reach your server to deliver inbound SMS.

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
openclaw telephony send +15550005678 "Hello from OpenClaw via Plivo!"
```

### Test inbound

Send an SMS to your Plivo number and approve the pairing:

```bash
openclaw pairing approve telephony <code>
```

## Webhook Signature Verification

Plivo uses **HMAC-SHA256** signature verification (V3 scheme).

### How it works

1. Plivo sends two headers: `X-Plivo-Signature-V3` and `X-Plivo-Signature-V3-Nonce`
2. The signing string is: `{url}{nonce}{raw_body}`
3. The plugin computes HMAC-SHA256 with your Auth Token
4. Signatures are compared using timing-safe comparison

### Important notes

- If behind a reverse proxy, set `publicUrl` to match what Plivo sees
- The V3 scheme uses a nonce for replay protection
- For development, `skipSignatureVerification: true` disables checks (never in production!)

## Plivo Webhook Parameters

When Plivo delivers an inbound SMS, it sends these parameters:

| Parameter | Description |
|-----------|-------------|
| `From` | Sender phone number |
| `To` | Your Plivo number |
| `Text` | Message body |
| `MessageUUID` | Unique message identifier |
| `Type` | Message type (`sms` or `mms`) |
| `MediaUrls` | Comma-separated media URLs (MMS only) |
| `TotalRate` | Message cost |
| `Units` | Number of message units/segments |

## Plivo Pricing Notes

- Outbound SMS: ~$0.005/message (US) — competitive pricing
- Inbound SMS: Free (US)
- MMS: ~$0.015/message (US)
- Phone number: ~$0.80/month (US local)
- Volume discounts available
- See [Plivo Pricing](https://www.plivo.com/pricing/) for current rates

## Plivo MMS Support

Plivo supports MMS for US and Canadian numbers:

- Outbound: Up to 10 media attachments per message
- Inbound: Media URLs delivered as comma-separated list in `MediaUrls`
- Supported formats: JPEG, PNG, GIF, audio, video
- Max media size: 5 MB per attachment

## Troubleshooting

### "Signature mismatch" errors

- Ensure `publicUrl` matches the exact URL Plivo sends webhooks to
- Verify the Auth Token in config matches your Plivo console
- Check that V3 signatures are enabled (Plivo may use V1/V2 for older applications)

### Messages not arriving

- Verify the Message URL is correct in your Plivo application
- Check that your phone number is assigned to the application
- Look at **Messaging** → **Logs** in the Plivo console
- Ensure the number has SMS enabled (some numbers are voice-only)

### "Missing X-Plivo-Signature-V3 header"

- Ensure your Plivo application is using the V3 signature scheme
- Older applications may use V1 or V2 — create a new application if needed
- Check that the correct Auth Token is being used

### Trial account limitations

- Plivo trial accounts can only send to verified numbers
- Messages may be prefixed with a trial notice
- Upgrade for full functionality

## Plivo vs Twilio vs Telnyx

| Feature | Plivo | Twilio | Telnyx |
|---------|-------|--------|--------|
| SMS pricing (US) | ~$0.005 | ~$0.0079 | ~$0.004 |
| Inbound SMS (US) | Free | ~$0.0075 | ~$0.004 |
| Webhook security | HMAC-SHA256 | HMAC-SHA1 | Ed25519 |
| API style | REST (JSON) | REST (form) | REST (JSON) |
| MMS support | Yes (US/CA) | Yes | Yes |
| Global coverage | Good | Excellent | Good |
| Free tier | Trial credits | $15 credit | Limited |
| API response format | XML | XML | JSON |

## Full Configuration Example

```json5
{
  channels: {
    telephony: {
      enabled: true,
      provider: "plivo",
      fromNumber: "+15550001234",
      inboundPolicy: "pairing",
      allowFrom: [],

      plivo: {
        authId: "MAxxxxxxxxxxxxxxxxxxxxxxxx",
        authToken: "your_auth_token",
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
