# Changelog

## 0.2.0

**One call, and no configuration.**

Breaking:

- `new MyAppAffiliateNode({ apiKey, baseUrl })` → `new MyAppAffiliate(options)` /
  `createClient(options)`, where every option has a default: the key falls back to
  `process.env.MAA_SDK_KEY` and the host to `MAA_API_BASE_URL`, then the compiled-in
  production API. `createClient()` with no arguments works. A blank env var falls
  through to the default rather than becoming a base URL of `""`.

Added:

- `myAppAffiliate` zero-config singleton, so a server needs no bootstrap code:
  `await myAppAffiliate.trackSignup({ userId, from: req.url })`.
- `trackSignup({ from })` — pass the request URL / referer and the SDK extracts the
  referral (`?via=`, `?ref=`, `?maa_code=`, `?code=`, `?claim_token=`, `?ct=`), so the
  caller parses no query strings.
- `referralFrom(url)` exported for stashing a referral before signup.
- `client.configured` — false when no key was found anywhere, the one misconfiguration
  worth checking at boot. `debug` option.

## 0.1.0

- Initial release: `trackSignup`, `install`, `identify`.
- Silent-safe — methods return `null` on any failure and never throw into a signup
  path.
