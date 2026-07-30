/**
 * @maa/sdk-node — server-side attribution SDK for MyAppAffiliate.
 *
 * For SaaS backends: call trackSignup() from your signup handler and the user
 * is attributed in one shot (install + identify) using a deterministic
 * server-side device id ("srv_" + userId). Zero dependencies (global fetch,
 * Node 18+). Every network failure is silent-safe — methods return null and
 * never throw.
 */

export interface NodeSdkOptions {
  /** SDK API key ("Bearer <sdkKey>"). */
  apiKey: string;
  /** e.g. "https://api.myappaffiliate.com". */
  baseUrl: string;
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
  /** Your user id — the same value you put in Stripe metadata.customer_user_id. */
  userId: string;
  /** Referral code the user signed up with (?via= / a "referral code" field). */
  code?: string;
  /** Claim token from a tracked link (?claim_token= / ?ct=), if you captured it. */
  claimToken?: string;
}

export class MyAppAffiliateNode {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: NodeSdkOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
  }

  /** POST JSON; returns the parsed body on 2xx, null on any failure. Never throws. */
  private async post<T>(path: string, body: unknown): Promise<T | null> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  /**
   * Attribute a signup in one call: POST /sdk/install with the deterministic
   * device id "srv_" + userId, then POST /sdk/identify to bind the user.
   * Returns { affiliateId } when attribution succeeded, null otherwise
   * (no code/token, no attributable click, or network failure).
   *
   * Pair with Stripe by setting metadata.customer_user_id = userId on the
   * subscription/customer — revenue webhooks then attribute automatically.
   */
  async trackSignup(input: TrackSignupInput): Promise<{ affiliateId: string } | null> {
    if (!input.userId || (!input.code && !input.claimToken)) return null;
    const deviceId = `srv_${input.userId}`;
    const installed = await this.install({
      deviceId,
      ...(input.claimToken ? { claimToken: input.claimToken } : { affiliateCode: input.code }),
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
