# Twilio Integration Guide

Complete guide to setting up the OpenClaw telephony channel with **Twilio** as the SMS/Voice provider.

## Prerequisites

- A Twilio account ([sign up](https://www.twilio.com/try-twilio))
- A Twilio phone number with SMS capability
- OpenClaw installed and running on a server reachable from the internet

## Step 1: Get Your Twilio Credentials

1. Log in to the [Twilio Console](https://console.twilio.com/)
2. On the dashboard, find your **Account SID** and **Auth Token**
3. Copy both values — you'll need them for configuration

> Your Account SID starts with `AC` and is 34 characters long.
> Your Auth Token is a 32-character hex string. Keep it secret!

## Step 2: Get a Phone Number

If you don't already have a Twilio phone number:

1. Go to **Phone Numbers** → **Manage** → **Buy a number**
2. Search for a number with **SMS** capability (and optionally **Voice**)
3. Purchase the number
4. Note the number in E.164 format (e.g., `+15550001234`)

> For testing, Twilio trial accounts can only send to verified numbers. Upgrade to send to any number.

## Step 3: Configure OpenClaw

Add to your OpenClaw configuration under `channels.telephony`:

```json5
{
  channels: {
    telephony: {
      enabled: true,
      provider: "twilio",
      fromNumber: "+15550001234",   // Your Twilio number
      inboundPolicy: "pairing",     // Recommended starting policy

      twilio: {
        accountSid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        authToken: "your_auth_token_here",
      },

      serve: {
        port: 3335,
        bind: "0.0.0.0",            // Bind to all interfaces
        path: "/telephony/webhook",
      },
    },
  },
}
```

### Using Environment Variables (recommended for production)

Instead of putting secrets in config, use environment variables:

```bash
export TWILIO_ACCOUNT_SID="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export TWILIO_AUTH_TOKEN="your_auth_token_here"
```

Then simplify the config:

```json5
{
  channels: {
    telephony: {
      enabled: true,
      provider: "twilio",
      fromNumber: "+15550001234",
      inboundPolicy: "pairing",
      serve: { port: 3335, bind: "0.0.0.0" },
    },
  },
}
```

### Using a Messaging Service (optional)

If you have a [Twilio Messaging Service](https://www.twilio.com/docs/messaging/services) (for sender ID rotation, A2P 10DLC compliance, etc.):

```json5
twilio: {
  accountSid: "ACxxxx",
  authToken: "xxxx",
  messagingServiceSid: "MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
}
```

When `messagingServiceSid` is set, it takes precedence over `fromNumber` for outbound messages.

## Step 4: Expose Your Webhook

Twilio needs to reach your server to deliver inbound SMS. Choose one approach:

### Option A: ngrok (easiest for development)

```json5
tunnel: {
  provider: "ngrok",
  // Optional: ngrokAuthToken for longer sessions
  // ngrokAuthToken: "your_ngrok_token",
}
```

The plugin will automatically start an ngrok tunnel and log the public URL.

### Option B: Public server with reverse proxy

If your server is publicly accessible (e.g., via nginx or caddy):

```json5
{
  publicUrl: "https://your-domain.com",
  serve: {
    port: 3335,
    bind: "127.0.0.1",    // Bind to loopback; nginx proxies to this
    path: "/telephony/webhook",
  },
}
```

Example nginx config:

```nginx
location /telephony/ {
    proxy_pass http://127.0.0.1:3335;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### Option C: Tailscale Funnel

```json5
tunnel: {
  provider: "tailscale-funnel",
}
```

## Step 5: Configure Twilio Webhooks

1. Go to **Phone Numbers** → **Manage** → **Active numbers**
2. Click your phone number
3. Under **Messaging Configuration**:
   - **A message comes in**: Set to **Webhook**, `POST`, URL: `https://your-public-url/telephony/webhook`
   - **Status callback URL** (optional): `https://your-public-url/telephony/status`
4. Under **Voice Configuration** (if using voice):
   - **A call comes in**: Set to **Webhook**, `POST`, URL: `https://your-public-url/telephony/webhook`
5. Click **Save configuration**

## Step 6: Test It

### Send an outbound SMS

```bash
openclaw telephony send +15550005678 "Hello from OpenClaw!"
```

### Test inbound

Send an SMS from your phone to the Twilio number. If `inboundPolicy` is `"pairing"`, you'll receive a pairing code. Approve it:

```bash
openclaw pairing approve telephony <code>
```

## Webhook Signature Verification

Twilio signs every webhook request with an HMAC-SHA1 signature using your Auth Token. The plugin verifies this automatically.

### How it works

1. Twilio sends `X-Twilio-Signature` header with each request
2. The plugin reconstructs the signing string: `URL + sorted POST parameters`
3. Computes HMAC-SHA1 with your Auth Token
4. Compares signatures using timing-safe comparison

### Important notes

- The signature is computed against the **full public URL** that Twilio sees
- If you're behind a reverse proxy, set `publicUrl` to match what Twilio sends to
- For development only, you can set `skipSignatureVerification: true` (never in production!)
- If using ngrok free tier, the URL changes on restart — re-configure Twilio each time

## Twilio Pricing Notes

- Outbound SMS: ~$0.0079/segment (US) — varies by country
- Inbound SMS: ~$0.0075/segment (US)
- MMS: ~$0.02/message (US)
- Phone number: ~$1.15/month (US local)
- See [Twilio Pricing](https://www.twilio.com/en-us/pricing) for current rates

## Troubleshooting

### "Signature mismatch" errors

- Ensure `publicUrl` matches the exact URL configured in Twilio
- Check that the Auth Token in config matches your Twilio console
- If behind a proxy, ensure the proxy passes the original Host header

### Messages not arriving

- Verify the webhook URL is correct in the Twilio console
- Check that your server is reachable from the internet
- Look at the Twilio [Error Logs](https://console.twilio.com/us1/monitor/logs/errors) for delivery issues
- Ensure the phone number has SMS capability enabled

### Trial account limitations

- Can only send to [verified phone numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/verified)
- Messages are prefixed with "Sent from your Twilio trial account"
- Upgrade your account to remove these restrictions

### Rate limiting

Twilio enforces per-number sending limits:
- Long codes (standard numbers): 1 SMS/second
- Short codes: 100 SMS/second
- Toll-free: 3 SMS/second

Use a Messaging Service with a number pool for higher throughput.

## Full Configuration Example

```json5
{
  channels: {
    telephony: {
      enabled: true,
      provider: "twilio",
      fromNumber: "+15550001234",
      inboundPolicy: "pairing",
      allowFrom: [],

      twilio: {
        accountSid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        authToken: "your_auth_token",
        messagingServiceSid: "MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
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
        ngrokAuthToken: "your_ngrok_token",
      },

      webhookSecurity: {
        allowedHosts: ["your-domain.com"],
        trustForwardingHeaders: false,
      },

      publicUrl: "https://your-domain.com",
      skipSignatureVerification: false,
      maxConcurrentSessions: 50,
    },
  },
}
```
