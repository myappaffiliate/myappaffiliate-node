# @myappaffiliate/sdk-node

Server-side attribution SDK for MyAppAffiliate — for SaaS backends (Node 18+,
uses global `fetch`, zero dependencies). Silent-safe: methods return `null` on
any failure and never throw.

## Install

```bash
npm install @myappaffiliate/sdk-node
```

## Usage

```ts
import { createClient } from "@myappaffiliate/sdk-node";

const maa = createClient({
  apiKey: process.env.MAA_SDK_KEY!, // SDK-scoped API key from your dashboard
  baseUrl: "https://api.myappaffiliate.com",
});

// In your signup handler — one call does install + identify:
const attribution = await maa.trackSignup({
  userId: user.id,
  code: signupForm.referralCode, // from ?via= or a "referral code" field
  // claimToken: req.cookies.maa_ct, // or a claim token from a tracked link
});
// → { affiliateId: "aff_..." } when attributed, null otherwise
```

`trackSignup` uses the deterministic device id `srv_<userId>`, so it is safe
to retry — the API treats repeats for the same user idempotently per device.

## Pair with Stripe

Set your user id on the Stripe subscription/customer so revenue webhooks
attribute automatically:

```ts
await stripe.subscriptions.create({
  customer: stripeCustomerId,
  items: [{ price: priceId }],
  metadata: { customer_user_id: user.id }, // ← same userId as trackSignup
});
```

Every invoice/renewal webhook then flows into commission calculation for the
attributed affiliate — no extra SDK calls needed.

## API

| Method | Returns | Notes |
| --- | --- | --- |
| `createClient({ apiKey, baseUrl })` | `MyAppAffiliateNode` | build a client (safe to share app-wide) |
| `trackSignup({ userId, code?, claimToken? })` | `Promise<{ affiliateId } \| null>` | install + identify in one call |
| `install({ deviceId, claimToken?, affiliateCode?, firstOpenAt? })` | `Promise<{ attributionId, affiliateId } \| null>` | raw POST /sdk/install |
| `identify({ deviceId, customerUserId, identifiedAt? })` | `Promise<{ attributionId, customerUserId } \| null>` | raw POST /sdk/identify |

Timestamps are epoch milliseconds and default to `Date.now()`.
