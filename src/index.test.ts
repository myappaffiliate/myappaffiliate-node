import { afterEach, describe, expect, it, vi } from "vitest";
import {
  API_BASE_URL_ENV,
  API_KEY_ENV,
  DEFAULT_API_BASE_URL,
  MyAppAffiliate,
  createClient,
  referralFrom,
} from "./index";

function okFetch(bodies: Array<Record<string, unknown>>) {
  let call = 0;
  return vi.fn(async () => {
    const body = bodies[call] ?? bodies[bodies.length - 1] ?? {};
    call += 1;
    return { ok: true, json: async () => body };
  });
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> {
  const args = fetchMock.mock.calls[call];
  if (!args) throw new Error(`fetch not called ${call + 1} times`);
  return JSON.parse((args[1] as { body: string }).body) as Record<string, unknown>;
}

function sentUrl(fetchMock: ReturnType<typeof vi.fn>, call = 0): string {
  const args = fetchMock.mock.calls[call];
  if (!args) throw new Error(`fetch not called ${call + 1} times`);
  return args[0] as string;
}

const sdk = () => new MyAppAffiliate({ apiKey: "sdk_k", apiBaseUrl: "https://api.test/" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("trackSignup", () => {
  it("installs then identifies with the deterministic srv_ device id", async () => {
    const fetchMock = okFetch([
      { attributionId: "attr_1", affiliateId: "aff_1" },
      { attributionId: "attr_1", customerUserId: "user_1" },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await sdk().trackSignup({ userId: "user_1", code: "alice" });

    expect(result).toEqual({ affiliateId: "aff_1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentUrl(fetchMock, 0)).toBe("https://api.test/sdk/install");
    expect(sentUrl(fetchMock, 1)).toBe("https://api.test/sdk/identify");

    const install = sentBody(fetchMock, 0);
    expect(install.deviceId).toBe("srv_user_1");
    expect(install.affiliateCode).toBe("alice");
    expect(install.claimToken).toBeUndefined();
    expect(typeof install.firstOpenAt).toBe("number");

    const identify = sentBody(fetchMock, 1);
    expect(identify.deviceId).toBe("srv_user_1");
    expect(identify.customerUserId).toBe("user_1");
    expect(typeof identify.identifiedAt).toBe("number");
  });

  it("prefers a claimToken over a code", async () => {
    const fetchMock = okFetch([
      { attributionId: "attr_1", affiliateId: "aff_1" },
      { attributionId: "attr_1", customerUserId: "user_1" },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    await sdk().trackSignup({ userId: "user_1", code: "alice", claimToken: "tok_1" });
    const install = sentBody(fetchMock, 0);
    expect(install.claimToken).toBe("tok_1");
    expect(install.affiliateCode).toBeUndefined();
  });

  it("returns null without any network call when neither code nor claimToken given", async () => {
    const fetchMock = okFetch([{}]);
    vi.stubGlobal("fetch", fetchMock);
    await expect(sdk().trackSignup({ userId: "user_1" })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null and skips identify when install 404s (no attributable click)", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sdk().trackSignup({ userId: "user_1", code: "nope" })).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when identify fails after a successful install", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return { ok: true, json: async () => ({ attributionId: "attr_1", affiliateId: "aff_1" }) };
      }
      return { ok: false, status: 500, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(sdk().trackSignup({ userId: "user_1", code: "alice" })).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("is silent on network failure (never throws)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))),
    );
    await expect(sdk().trackSignup({ userId: "user_1", code: "alice" })).resolves.toBeNull();
  });
});

describe("raw passthroughs", () => {
  it("install() posts the body as-is with a default firstOpenAt", async () => {
    const fetchMock = okFetch([{ attributionId: "attr_1", affiliateId: "aff_1" }]);
    vi.stubGlobal("fetch", fetchMock);
    const res = await sdk().install({ deviceId: "dev_1", claimToken: "tok_1" });
    expect(res).toEqual({ attributionId: "attr_1", affiliateId: "aff_1" });
    const body = sentBody(fetchMock);
    expect(body.deviceId).toBe("dev_1");
    expect(body.claimToken).toBe("tok_1");
    expect(typeof body.firstOpenAt).toBe("number");
  });

  it("install() respects an explicit firstOpenAt", async () => {
    const fetchMock = okFetch([{ attributionId: "attr_1", affiliateId: "aff_1" }]);
    vi.stubGlobal("fetch", fetchMock);
    await sdk().install({ deviceId: "dev_1", affiliateCode: "alice", firstOpenAt: 1234 });
    expect(sentBody(fetchMock).firstOpenAt).toBe(1234);
  });

  it("identify() posts customerUserId with the bearer key", async () => {
    const fetchMock = okFetch([{ attributionId: "attr_1", customerUserId: "user_1" }]);
    vi.stubGlobal("fetch", fetchMock);
    const res = await sdk().identify({ deviceId: "dev_1", customerUserId: "user_1" });
    expect(res).toEqual({ attributionId: "attr_1", customerUserId: "user_1" });
    const args = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((args[1].headers as Record<string, string>).authorization).toBe("Bearer sdk_k");
  });

  it("passthroughs return null on non-2xx and on thrown fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })),
    );
    await expect(sdk().install({ deviceId: "dev_1" })).resolves.toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("offline"))),
    );
    await expect(sdk().identify({ deviceId: "d", customerUserId: "u" })).resolves.toBeNull();
  });
});

describe("zero-config", () => {
  it("createClient() reads the key and host from the environment", async () => {
    vi.stubEnv(API_KEY_ENV, "sdk_from_env");
    vi.stubEnv(API_BASE_URL_ENV, "https://staging.test/");
    const fetchMock = okFetch([{ attributionId: "attr_1", customerUserId: "user_1" }]);
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient();
    expect(client.configured).toBe(true);
    await client.identify({ deviceId: "dev_1", customerUserId: "user_1" });

    expect(sentUrl(fetchMock)).toBe("https://staging.test/sdk/identify");
    const args = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((args[1].headers as Record<string, string>).authorization).toBe("Bearer sdk_from_env");
  });

  it("falls back to the compiled-in production host", async () => {
    vi.stubEnv(API_KEY_ENV, "sdk_k");
    vi.stubEnv(API_BASE_URL_ENV, "");
    const fetchMock = okFetch([{ attributionId: "attr_1", customerUserId: "user_1" }]);
    vi.stubGlobal("fetch", fetchMock);
    await createClient().identify({ deviceId: "dev_1", customerUserId: "user_1" });
    expect(sentUrl(fetchMock)).toBe(`${DEFAULT_API_BASE_URL}/sdk/identify`);
  });

  it("takes a bare key string", () => {
    expect(new MyAppAffiliate("sdk_k").configured).toBe(true);
  });

  it("reports not-configured and makes no call when no key exists anywhere", async () => {
    vi.stubEnv(API_KEY_ENV, "");
    const fetchMock = okFetch([{}]);
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient();
    expect(client.configured).toBe(false);
    await expect(client.identify({ deviceId: "d", customerUserId: "u" })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("referralFrom", () => {
  it.each([
    ["https://app.test/signup?via=alice", { code: "alice" }],
    ["https://app.test/?ref=bob&utm_source=x", { code: "bob" }],
    ["/signup?maa_code=carol", { code: "carol" }],
    ["https://app.test/?ct=tok_1&via=alice", { claimToken: "tok_1" }],
    ["https://app.test/?claim_token=tok_2", { claimToken: "tok_2" }],
    ["https://app.test/pricing?via=dave#anchor", { code: "dave" }],
    ["https://app.test/signup", {}],
    ["", {}],
    [null, {}],
  ])("%s → %o", (input, expected) => {
    expect(referralFrom(input)).toEqual(expected);
  });
});

describe("trackSignup from a request URL", () => {
  it("extracts the referral out of `from` so the caller parses nothing", async () => {
    const fetchMock = okFetch([
      { attributionId: "attr_1", affiliateId: "aff_1" },
      { attributionId: "attr_1", customerUserId: "user_1" },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const result = await sdk().trackSignup({
      userId: "user_1",
      from: "https://app.test/signup?via=alice&utm_source=x",
    });
    expect(result).toEqual({ affiliateId: "aff_1" });
    expect(sentBody(fetchMock, 0).affiliateCode).toBe("alice");
  });

  it("prefers a claim token inside `from` over a code", async () => {
    const fetchMock = okFetch([
      { attributionId: "attr_1", affiliateId: "aff_1" },
      { attributionId: "attr_1", customerUserId: "user_1" },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    await sdk().trackSignup({ userId: "user_1", from: "/signup?ct=tok_1&via=alice" });
    expect(sentBody(fetchMock, 0).claimToken).toBe("tok_1");
  });

  it("an explicit code wins over whatever `from` carries", async () => {
    const fetchMock = okFetch([
      { attributionId: "attr_1", affiliateId: "aff_1" },
      { attributionId: "attr_1", customerUserId: "user_1" },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    await sdk().trackSignup({ userId: "user_1", code: "typed", from: "/signup?via=url" });
    expect(sentBody(fetchMock, 0).affiliateCode).toBe("typed");
  });

  it("returns null without a network call when `from` carries no referral", async () => {
    const fetchMock = okFetch([{}]);
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      sdk().trackSignup({ userId: "user_1", from: "https://app.test/signup" }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
