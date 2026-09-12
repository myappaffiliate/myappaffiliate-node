# @myappaffiliate/sdk-node

Server-side attribution SDK for MyAppAffiliate — for web backends (Node 18+, global
`fetch`, zero dependencies). Silent-safe: methods return `null` on any failure and
never throw, because a flaky attribution call must never fail a signup.

**The whole integration is one call from your signup handler.** Nothing about our
infrastructure enters your code: the key comes from the environment and the production
host is compiled in.

## Install

```bash
npm install @myappaffiliate/sdk-node
```

## 1. Set the key in the environment

```bash
MAA_SDK_KEY=pk_live_…
```

Server env only — never ship this key to the browser; that's what
[`@maa/sdk-web`](../sdk-web) is for.

## 2. Track the signup

```ts
import { myAppAffiliate } from "@myappaffiliate/sdk-node";

const result = await myAppAffiliate.trackSignup({
  userId: user.id,   // the id your billing provider will report back to us
  from: req.url,     // the request URL you already have
});
// → { affiliateId: "aff_…" } when attributed, null otherwise
```

`from` is parsed for you — `?via=`, `?ref=`, `?maa_code=`, `?code=`, `?claim_token=`,
`?ct=` — so you never pick query params apart yourself. Pass a referer or a landing
URL you stashed at signup instead, if that is what you have.

`null` means "organic signup" — it is not an error.

Under the hood this is `POST /sdk/install` + `POST /sdk/identify` in one call, using
the deterministic device id `srv_<userId>`, so it is safe to retry: the API treats
repeats for the same user idempotently per device.

Already parsed the referral yourself? Pass it directly:

```ts
await myAppAffiliate.trackSignup({ userId: user.id, code: form.referralCode });
await myAppAffiliate.trackSignup({ userId: user.id, claimToken: req.cookies.maa_ct });
```

## 3. Make sure your billing provider reports that same id

Attribution joins on the user id and nothing else. Whatever bills your customers, the
id in the revenue event has to be the string you passed to `trackSignup`:

```ts
// Stripe
await stripe.checkout.sessions.create({
  mode: "subscription",
  line_items: [{ price: priceId, quantity: 1 }],
  subscription_data: { metadata: { customer_user_id: user.id } },
  client_reference_id: user.id,
  success_url: "…",
  cancel_url: "…",
});

// Paddle
await paddle.transactions.create({
  items: [{ priceId, quantity: 1 }],
  customData: { customer_user_id: user.id },
});
```

Both providers fall back to their own customer id, so
`trackSignup({ userId: stripeCustomerId, … })` also works and needs no metadata at
all. Every invoice/renewal webhook then flows into commission calculation — no extra
SDK calls needed.

## Optional

**Your own client** — two keys in one process, or a key from a secret manager:

```ts
import { createClient } from "@myappaffiliate/sdk-node";

const maa = createClient({
  apiKey: await secrets.get("maa"),
  apiBaseUrl: "https://staging.example.com",  // or MAA_API_BASE_URL
  debug: true,
});
if (!maa.configured) logger.warn("MyAppAffiliate is inactive — no key");
```

**Stash the referral before signup**, when the landing page and the signup request are
different sessions:

```ts
import { referralFrom } from "@myappaffiliate/sdk-node";

session.referral = referralFrom(req.url);  // { code } | { claimToken } | {}
```

## API

| Method | Returns | Notes |
| --- | --- | --- |
| `trackSignup({ userId, from?, code?, claimToken? })` | `Promise<{ affiliateId } \| null>` | install + identify in one call |
| `install({ deviceId, claimToken?, affiliateCode?, firstOpenAt? })` | `Promise<{ attributionId, affiliateId } \| null>` | raw `POST /sdk/install` |
| `identify({ deviceId, customerUserId, identifiedAt? })` | `Promise<{ attributionId, customerUserId } \| null>` | raw `POST /sdk/identify` |
| `createClient({ apiKey?, apiBaseUrl?, debug? })` | `MyAppAffiliate` | every option defaults; `createClient()` works |
| `referralFrom(url)` | `{ code? , claimToken? }` | extract a referral from a URL or query string |

Timestamps are epoch milliseconds and default to `Date.now()`. Env vars:
`MAA_SDK_KEY` for the key, `MAA_API_BASE_URL` to point at a staging or self-hosted
API — a blank value falls through to the production default rather than breaking every
request.
