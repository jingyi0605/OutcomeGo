import { describe, expect, test } from "bun:test";
import { ExternalExchangeError, ExternalMediaExchange } from "../../src/services/external-messaging/media-exchange";

const CONNECTION = "11111111-1111-4111-8111-111111111111";
const DELIVERY = "22222222-2222-4222-8222-222222222222";
const SHA = "a".repeat(64);

type Call = { path: string; init: RequestInit };
const exchangeWith = (respond: (call: Call) => Response | Promise<Response>) => {
  const calls: Call[] = [];
  const exchange = new ExternalMediaExchange(async (path, init = {}) => {
    const call = { path, init };
    calls.push(call);
    return respond(call);
  });
  return { exchange, calls };
};

const failure = async (action: Promise<unknown>): Promise<ExternalExchangeError> => {
  try {
    await action;
  } catch (error) {
    expect(error).toBeInstanceOf(ExternalExchangeError);
    return error as ExternalExchangeError;
  }
  throw new Error("expected an exchange failure");
};

describe("inbound", () => {
  test("opens a file as a stream with its size", async () => {
    const { exchange, calls } = exchangeWith(() => new Response("bytes", { headers: { "content-length": "5" } }));
    const file = await exchange.openInbound(CONNECTION, "7-0");
    expect(file.size).toBe(5);
    expect(await new Response(file.body).text()).toBe("bytes");
    expect(calls[0]!.path).toBe(`/v1/mcp/connections/${CONNECTION}/exchange/inbound/7-0`);
    expect(calls[0]!.init.method).toBe("GET");
  });

  test.each([
    [404, "external_media_missing", false],
    [400, "external_media_missing", false],
    [413, "external_media_too_large", false],
    [409, "external_exchange_unavailable", true],
    [500, "external_exchange_unavailable", true],
    [503, "external_exchange_unavailable", true],
  ] as const)("status %d is %s (retryable: %s)", async (status, code, retryable) => {
    const { exchange } = exchangeWith(() => new Response(JSON.stringify({ error: "x" }), { status }));
    expect(await failure(exchange.openInbound(CONNECTION, "7-0"))).toMatchObject({ code, retryable });
  });

  test("an unreachable computer is retryable, never a lost attachment", async () => {
    const exchange = new ExternalMediaExchange(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await failure(exchange.openInbound(CONNECTION, "7-0"))).toMatchObject({
      code: "external_exchange_unavailable",
      retryable: true,
    });
  });

  test("a name outside the pattern never reaches the computer", async () => {
    const { exchange, calls } = exchangeWith(() => new Response("x"));
    expect(await failure(exchange.openInbound(CONNECTION, "../etc/passwd"))).toMatchObject({ code: "external_media_missing", retryable: false });
    expect(calls).toHaveLength(0);
  });
});

describe("outbound", () => {
  const stage = (exchange: ExternalMediaExchange, overrides: Partial<Parameters<ExternalMediaExchange["stageOutbound"]>[0]> = {}) =>
    exchange.stageOutbound({
      connectionId: CONNECTION,
      deliveryId: DELIVERY,
      exchangeName: "photo.png",
      body: new Uint8Array([1, 2, 3]),
      byteSize: 3,
      sha256: SHA,
      ...overrides,
    });

  test("stages a file and checks what the computer stored", async () => {
    const { exchange, calls } = exchangeWith(() => Response.json({ bytes: 3, sha256: SHA }));
    await stage(exchange);
    expect(calls[0]!.path).toBe(`/v1/mcp/connections/${CONNECTION}/exchange/outbound/${DELIVERY}/photo.png`);
    expect(calls[0]!.init.method).toBe("PUT");
    expect((calls[0]!.init.headers as Record<string, string>)["content-length"]).toBe("3");
  });

  test.each([
    ["a size mismatch", { bytes: 4, sha256: SHA }, 200],
    ["a digest mismatch", { bytes: 3, sha256: "b".repeat(64) }, 200],
    ["a refusal", { error: "exchange_too_large" }, 413],
    ["a server error", { error: "exchange_write_failed" }, 500],
  ])("%s is a definite staging failure, so nothing was sent to the provider", async (_label, body, status) => {
    const { exchange } = exchangeWith(() => Response.json(body, { status }));
    expect(await failure(stage(exchange))).toMatchObject({ code: "external_media_staging_failed", retryable: false });
  });

  test("a transport error while staging is also a definite failure", async () => {
    const exchange = new ExternalMediaExchange(async () => {
      throw new Error("ECONNRESET");
    });
    expect((await failure(stage(exchange))).code).toBe("external_media_staging_failed");
  });

  test("malformed delivery ids or names are refused locally", async () => {
    const { exchange, calls } = exchangeWith(() => Response.json({ bytes: 3, sha256: SHA }));
    expect((await failure(stage(exchange, { deliveryId: "../x" }))).code).toBe("external_media_staging_failed");
    expect((await failure(stage(exchange, { exchangeName: "a/b" }))).code).toBe("external_media_staging_failed");
    expect(calls).toHaveLength(0);
  });

  test("cleanup reports success and never throws", async () => {
    const ok = exchangeWith(() => Response.json({ ok: true }));
    expect(await ok.exchange.cleanupOutbound(CONNECTION, DELIVERY)).toBe(true);
    expect(ok.calls[0]!.init.method).toBe("DELETE");
    const bad = exchangeWith(() => new Response("{}", { status: 500 }));
    expect(await bad.exchange.cleanupOutbound(CONNECTION, DELIVERY)).toBe(false);
    const down = new ExternalMediaExchange(async () => {
      throw new Error("down");
    });
    expect(await down.cleanupOutbound(CONNECTION, DELIVERY)).toBe(false);
    expect(await down.cleanupOutbound(CONNECTION, "not-a-uuid")).toBe(false);
  });
});
