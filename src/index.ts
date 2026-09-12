/**
 * @maa/sdk-node — server-side attribution SDK for MyAppAffiliate.
 *
 * The whole integration is one call from your signup handler:
 *
 *     await myAppAffiliate.trackSignup({ userId: user.id, from: req.url });
 *
 * `from` is the request URL (or referer) you already have — the SDK pulls the
 * referral out of it, so you never parse query strings yourself. The API key
 * and host come from the environment; nothing about our infrastructure gets
 * typed into your code.
 *
 * Zero dependencies (global fetch, Node 18+). Every network failure is
 * silent-safe — methods return null and never throw, because a flaky
 * attribution call must never fail a signup.
 */

/**
 * Where the SDK talks to when nothing overrides it. Mirrors `SITE.api` in
 * @maa/brand — inlined rather than imported so this package stays
 * dependency-free for a customer's install.
 */
export const DEFAULT_API_BASE_URL = "https://api.myappaffiliate.com";

/** Env var read when no apiKey is passed. */
export const API_KEY_ENV = "MAA_SDK_KEY";
/** Env var read when no apiBaseUrl is passed — for staging / self-hosted APIs. */
export const API_BASE_URL_ENV = "MAA_API_BASE_URL";

/** Query params a referral can arrive under, in the order we trust them. */
const TOKEN_PARAMS = ["claim_token", "ct"] as const;
const CODE_PARAMS = ["via", "ref", "maa_code", "code"] as const;

export interface ClientOptions {
  /** SDK key from the dashboard. Defaults to `process.env.MAA_SDK_KEY`. */
  apiKey?: string;
  /**
   * Override the API host. You do NOT need this in production — it defaults to
   * `process.env.MAA_API_BASE_URL` and then {@link DEFAULT_API_BASE_URL}. Set
   * it only to point at a staging API or a self-hosted deployment.
   */
  apiBaseUrl?: string;
  /** Log what the SDK decided, to the console. Off by default. */
  debug?: boolean;
}

export interface InstallBody {
  deviceId: string;
  claimToken?: string;
  affiliateCode?: string;
  /** Epoch millis. Defaults to Date.now(). */
  firstOpenAt?: number;
}

export interface IdentifyBody {
  deviceId: string;
  customerUserId: string;
  /** Epoch millis. Defaults to Date.now(). */
  identifiedAt?: number;
}

export interface InstallResponse {
  attributionId: string;
  affiliateId: string;
}

export interface IdentifyResponse {
  attributionId: string;
  customerUserId: string;
}

export interface TrackSignupInput {
  /** Your user id — the same value your billing provider will report back to us. */
  userId: string;
  /**
   * The request URL, referer, or landing URL the signup came from. The SDK
   * extracts `?via=` / `?ref=` / `?code=` / `?claim_token=` / `?ct=` from it,
   * so you don't have to. Ignored when `code` or `claimToken` is given.
   */
  from?: string | null;
  /** Referral code, if you already parsed it out of the form or query. */
  code?: string | null;
  /** Claim token from a tracked link, if you already parsed it out. */
  claimToken?: string | null;
}

/** Pull the first present param out of a URL or raw query string. */
function paramFrom(input: string, names: readonly string[]): string | undefined {
  const query = input.split("#")[0]?.split("?").slice(1).join("?") ?? "";
  if (!query) return undefined;
  const params = new URLSearchParams(query);
  for (const name of names) {
    const value = params.get(name);
    if (value) return value;
  }
  return undefined;
}

/**
 * Split a request URL / referer into whichever referral it carries. Exported
 * because it is occasionally useful on its own (e.g. stashing the referral in a
 * session before the user signs up).
 */
export function referralFrom(input: string | null | undefined): {
  claimToken?: string;
  code?: string;
} {
  if (!input) return {};
  const claimToken = paramFrom(input, TOKEN_PARAMS);
  if (claimToken) return { claimToken };
  const code = paramFrom(input, CODE_PARAMS);
  return code ? { code } : {};
}

/** Trimmed value, or undefined when absent/blank — a blank env var means "unset". */
function present(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export class MyAppAffiliate {
  private readonly apiKey: string;
  private readonly apiBaseUrl: string;
  private readonly debug: boolean;

  constructor(options: ClientOptions | string = {}) {
    const opts: ClientOptions = typeof options === "string" ? { apiKey: options } : options;
    const env = typeof process === "undefined" ? undefined : process.env;
    this.apiKey = present(opts.apiKey) ?? present(env?.[API_KEY_ENV]) ?? "";
    // `.replace` on the resolved value, not on each candidate: an env var set to
    // an empty string ("MAA_API_BASE_URL=" in a .env) must fall through to the
    // default rather than becoming a base URL of "".
    this.apiBaseUrl = (
      present(opts.apiBaseUrl) ??
      present(env?.[API_BASE_URL_ENV]) ??
      DEFAULT_API_BASE_URL
    ).replace(/\/+$/, "");
    this.debug = opts.debug ?? false;
  }

  /**
   * False when no key was found — the one misconfiguration worth checking at
   * boot, because every other failure mode here is silent by design.
   */
  get configured(): boolean {
    return this.apiKey.length > 0;
  }

  private log(message: string, detail?: unknown): void {
    if (!this.debug) return;
    if (detail === undefined) console.info(`[myappaffiliate] ${message}`);
    else console.info(`[myappaffiliate] ${message}`, detail);
  }

  /** POST JSON; returns the parsed body on 2xx, null on any failure. Never throws. */
  private async post<T>(path: string, body: unknown): Promise<T | null> {
    if (!this.configured) {
      this.log(`not configured — set ${API_KEY_ENV} or pass apiKey`);
      return null;
    }
    try {
      const res = await fetch(`${this.apiBaseUrl}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        this.log(`${path} → ${res.status}`);
        return null;
      }
      return (await res.json()) as T;
    } catch (error) {
      this.log(`${path} failed`, error);
      return null;
    }
  }

  /**
   * Attribute a signup in one call: POST /sdk/install with the deterministic
   * device id "srv_" + userId, then POST /sdk/identify to bind the user.
   * Returns { affiliateId } when attribution succeeded, null otherwise
   * (no referral in the request, no attributable click, or network failure) —
   * null means "organic signup", not an error.
   *
   * The userId you pass here is the join key for every revenue event that
   * follows, whoever bills the customer: it must be the same string your
   * billing provider reports back to us (Stripe `metadata.customer_user_id`,
   * Paddle custom data, RevenueCat / Adapty / Superwall app user id).
   */
  async trackSignup(input: TrackSignupInput): Promise<{ affiliateId: string } | null> {
    if (!input.userId) return null;
    const explicit = input.claimToken
      ? { claimToken: input.claimToken }
      : input.code
        ? { code: input.code }
        : null;
    const referral = explicit ?? referralFrom(input.from);
    if (!referral.claimToken && !referral.code) return null;

    const deviceId = `srv_${input.userId}`;
    const installed = await this.install({
      deviceId,
      ...(referral.claimToken
        ? { claimToken: referral.claimToken }
        : { affiliateCode: referral.code }),
    });
    if (!installed) return null;
    const identified = await this.identify({ deviceId, customerUserId: input.userId });
    if (!identified) return null;
    return { affiliateId: installed.affiliateId };
  }

  /** Raw POST /sdk/install passthrough. Returns null on any failure. */
  async install(body: InstallBody): Promise<InstallResponse | null> {
    if (!body.deviceId) return null;
    return this.post<InstallResponse>("/sdk/install", {
      firstOpenAt: Date.now(),
      ...body,
    });
  }

  /** Raw POST /sdk/identify passthrough. Returns null on any failure. */
  async identify(body: IdentifyBody): Promise<IdentifyResponse | null> {
    if (!body.deviceId || !body.customerUserId) return null;
    return this.post<IdentifyResponse>("/sdk/identify", {
      identifiedAt: Date.now(),
      ...body,
    });
  }
}

/** Build a client. Every option has a default, so `createClient()` works. */
export function createClient(options: ClientOptions | string = {}): MyAppAffiliate {
  return new MyAppAffiliate(options);
}

/**
 * The zero-config singleton — reads `MAA_SDK_KEY` on first use, so a server
 * needs no bootstrap code at all:
 *
 *     import { myAppAffiliate } from "@maa/sdk-node";
 *     await myAppAffiliate.trackSignup({ userId, from: req.url });
 *
 * Construct your own client instead when you need two keys in one process, or
 * want to pass the key from a secret manager rather than the environment.
 */
let singleton: MyAppAffiliate | null = null;
export const myAppAffiliate = {
  /** Replace the singleton's configuration (optional — env vars are enough). */
  configure(options: ClientOptions | string): MyAppAffiliate {
    singleton = new MyAppAffiliate(options);
    return singleton;
  },
  get client(): MyAppAffiliate {
    if (!singleton) singleton = new MyAppAffiliate();
    return singleton;
  },
  trackSignup(input: TrackSignupInput) {
    return this.client.trackSignup(input);
  },
  install(body: InstallBody) {
    return this.client.install(body);
  },
  identify(body: IdentifyBody) {
    return this.client.identify(body);
  },
};

export default myAppAffiliate;
