import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExchangeError, McpExchange } from "../src/mcp-exchange";

const CONNECTION = "11111111-1111-4111-8111-111111111111";
const DELIVERY = "22222222-2222-4222-8222-222222222222";

let root: string;
let state: string;
const exchange = (maxBytes?: number) => new McpExchange(() => state, maxBytes);

const stream = (...chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

const failure = async (action: Promise<unknown>): Promise<ExchangeError> => {
  try {
    await action;
  } catch (error) {
    expect(error).toBeInstanceOf(ExchangeError);
    return error as ExchangeError;
  }
  throw new Error("expected the exchange to refuse the request");
};

const text = async (body: ReadableStream<Uint8Array>) => new Response(body).text();

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "outcomego-exchange-"));
  state = join(root, "state");
  await mkdir(join(state, "exchange", "inbound"), { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("inbound reads", () => {
  test("streams a connector file with its size", async () => {
    await writeFile(join(state, "exchange", "inbound", "7-0"), "plaintext media");
    const file = await exchange().readInbound(CONNECTION, "7-0");
    expect(file.size).toBe(15);
    expect(await text(file.body)).toBe("plaintext media");
  });

  test("an empty file is a valid empty body", async () => {
    await writeFile(join(state, "exchange", "inbound", "empty"), "");
    const file = await exchange().readInbound(CONNECTION, "empty");
    expect(file.size).toBe(0);
    expect(await text(file.body)).toBe("");
  });

  test("a missing file is not found, not an error of the path", async () => {
    expect((await failure(exchange().readInbound(CONNECTION, "absent"))).status).toBe(404);
  });

  test.each(["../secret", "a/b", ".hidden", "-dash", "", "a".repeat(121), "name with space", "tab\tname", "nul\u0000"])(
    "refuses the file name %j",
    async (name) => {
      expect(await failure(exchange().readInbound(CONNECTION, name))).toMatchObject({ status: 400, code: "exchange_invalid_name" });
    }
  );

  test("refuses a symlinked file, even one pointing at a harmless file", async () => {
    await writeFile(join(root, "outside.txt"), "outside the exchange");
    await symlink(join(root, "outside.txt"), join(state, "exchange", "inbound", "link"));
    expect(await failure(exchange().readInbound(CONNECTION, "link"))).toMatchObject({ status: 400, code: "exchange_unsafe_path" });
  });

  test("refuses when the inbound directory itself is a symlink", async () => {
    await rm(join(state, "exchange", "inbound"), { recursive: true });
    await mkdir(join(root, "elsewhere"));
    await writeFile(join(root, "elsewhere", "file"), "x");
    await symlink(join(root, "elsewhere"), join(state, "exchange", "inbound"));
    expect(await failure(exchange().readInbound(CONNECTION, "file"))).toMatchObject({ status: 400, code: "exchange_unsafe_path" });
  });

  test("refuses a directory where a file is expected", async () => {
    await mkdir(join(state, "exchange", "inbound", "folder"));
    expect((await failure(exchange().readInbound(CONNECTION, "folder"))).status).toBe(400);
  });

  test("refuses files above the cap", async () => {
    await writeFile(join(state, "exchange", "inbound", "big"), Buffer.alloc(11));
    expect(await failure(exchange(10).readInbound(CONNECTION, "big"))).toMatchObject({ status: 413, code: "exchange_too_large" });
  });

  test("is unavailable for a connection without a state directory", async () => {
    await rm(state, { recursive: true });
    expect(await failure(exchange().readInbound(CONNECTION, "7-0"))).toMatchObject({ status: 409, code: "exchange_unavailable" });
  });

  test("refuses a state directory that is a symlink", async () => {
    await rm(state, { recursive: true });
    await mkdir(join(root, "real-state", "exchange", "inbound"), { recursive: true });
    await writeFile(join(root, "real-state", "exchange", "inbound", "f"), "x");
    await symlink(join(root, "real-state"), state);
    expect((await failure(exchange().readInbound(CONNECTION, "f"))).code).toBe("exchange_unsafe_path");
  });

  test("refuses a malformed connection id", async () => {
    expect((await failure(exchange().readInbound("../etc", "f"))).code).toBe("exchange_invalid_connection");
  });
});

describe("outbound writes", () => {
  const outbound = (...parts: string[]) => join(state, "exchange", "outbound", DELIVERY, ...parts);

  test("writes atomically with mode 0600 and reports size and digest", async () => {
    const bytes = new TextEncoder().encode("image bytes");
    const result = await exchange().writeOutbound(CONNECTION, DELIVERY, "photo.png", stream(bytes.slice(0, 5), bytes.slice(5)));
    expect(result).toEqual({ bytes: 11, sha256: createHash("sha256").update(bytes).digest("hex") });
    expect(await readFile(outbound("photo.png"), "utf8")).toBe("image bytes");
    expect((await stat(outbound("photo.png"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(state, "exchange", "outbound", DELIVERY))).mode & 0o777).toBe(0o700);
    // No temporary file is left behind.
    expect(await readdir(outbound())).toEqual(["photo.png"]);
  });

  test("creates the outbound tree on first use but never the state directory", async () => {
    await rm(join(state, "exchange"), { recursive: true });
    await exchange().writeOutbound(CONNECTION, DELIVERY, "a.png", stream(new Uint8Array([1])));
    expect((await readFile(outbound("a.png"))).length).toBe(1);
    await rm(state, { recursive: true });
    expect((await failure(exchange().writeOutbound(CONNECTION, DELIVERY, "a.png", stream(new Uint8Array([1]))))).code).toBe(
      "exchange_unavailable"
    );
    await expect(lstat(state)).rejects.toThrow();
  });

  test("replaces an earlier regular file of the same name", async () => {
    await exchange().writeOutbound(CONNECTION, DELIVERY, "a.png", stream(new Uint8Array([1, 2, 3])));
    await exchange().writeOutbound(CONNECTION, DELIVERY, "a.png", stream(new Uint8Array([9])));
    expect([...(await readFile(outbound("a.png")))]).toEqual([9]);
  });

  test("aborts above the cap while streaming and leaves nothing behind", async () => {
    const error = await failure(exchange(8).writeOutbound(CONNECTION, DELIVERY, "big.bin", stream(new Uint8Array(5), new Uint8Array(5))));
    expect(error).toMatchObject({ status: 413, code: "exchange_too_large" });
    expect(await readdir(outbound())).toEqual([]);
  });

  test("a declared size above the cap is refused before anything is written", async () => {
    expect((await failure(exchange(8).writeOutbound(CONNECTION, DELIVERY, "big.bin", stream(new Uint8Array(1)), 9))).status).toBe(413);
    await expect(lstat(join(state, "exchange", "outbound"))).rejects.toThrow();
  });

  test("a failing source stream leaves no partial file", async () => {
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("connection reset"));
      },
    });
    expect((await failure(exchange().writeOutbound(CONNECTION, DELIVERY, "x.png", broken))).code).toBe("exchange_write_failed");
    expect(await readdir(outbound())).toEqual([]);
  });

  test("refuses a name that is already a symlink", async () => {
    await mkdir(outbound(), { recursive: true });
    await writeFile(join(root, "victim"), "keep");
    await symlink(join(root, "victim"), outbound("a.png"));
    expect((await failure(exchange().writeOutbound(CONNECTION, DELIVERY, "a.png", stream(new Uint8Array([1]))))).code).toBe(
      "exchange_unsafe_path"
    );
    expect(await readFile(join(root, "victim"), "utf8")).toBe("keep");
  });

  test("refuses when the delivery directory is a symlink out of the state directory", async () => {
    await mkdir(join(state, "exchange", "outbound"), { recursive: true });
    await mkdir(join(root, "escape"));
    await symlink(join(root, "escape"), join(state, "exchange", "outbound", DELIVERY));
    expect((await failure(exchange().writeOutbound(CONNECTION, DELIVERY, "a.png", stream(new Uint8Array([1]))))).code).toBe(
      "exchange_unsafe_path"
    );
    expect(await readdir(join(root, "escape"))).toEqual([]);
  });

  test("refuses when exchange/outbound is a symlink", async () => {
    await mkdir(join(root, "escape"));
    await symlink(join(root, "escape"), join(state, "exchange", "outbound"));
    expect((await failure(exchange().writeOutbound(CONNECTION, DELIVERY, "a.png", stream(new Uint8Array([1]))))).code).toBe(
      "exchange_unsafe_path"
    );
    expect(await readdir(join(root, "escape"))).toEqual([]);
  });

  test.each([
    ["a name outside the pattern", DELIVERY, "../x", "exchange_invalid_name"],
    ["a delivery id that is not a UUID", "not-a-uuid", "a.png", "exchange_invalid_delivery"],
    ["a delivery id that climbs", "../../etc", "a.png", "exchange_invalid_delivery"],
  ] as const)("refuses %s", async (_label, delivery, name, code) => {
    expect((await failure(exchange().writeOutbound(CONNECTION, delivery, name, stream(new Uint8Array([1]))))).code).toBe(code);
  });

  test("a request without a body is refused", async () => {
    expect((await failure(exchange().writeOutbound(CONNECTION, DELIVERY, "a.png", null))).status).toBe(400);
  });
});

describe("outbound cleanup", () => {
  test("removes the delivery directory with its files", async () => {
    await exchange().writeOutbound(CONNECTION, DELIVERY, "a.png", stream(new Uint8Array([1])));
    await exchange().removeOutbound(CONNECTION, DELIVERY);
    await expect(lstat(join(state, "exchange", "outbound", DELIVERY))).rejects.toThrow();
  });

  test("removing what is already gone succeeds", async () => {
    await exchange().removeOutbound(CONNECTION, DELIVERY);
    await mkdir(join(state, "exchange", "outbound"), { recursive: true });
    await exchange().removeOutbound(CONNECTION, DELIVERY);
  });

  test("never follows a symlinked delivery directory", async () => {
    await mkdir(join(state, "exchange", "outbound"), { recursive: true });
    await mkdir(join(root, "precious"));
    await writeFile(join(root, "precious", "file"), "keep");
    await symlink(join(root, "precious"), join(state, "exchange", "outbound", DELIVERY));
    expect((await failure(exchange().removeOutbound(CONNECTION, DELIVERY))).code).toBe("exchange_unsafe_path");
    expect(await readFile(join(root, "precious", "file"), "utf8")).toBe("keep");
  });

  test("leaves other deliveries alone", async () => {
    const other = "33333333-3333-4333-8333-333333333333";
    await exchange().writeOutbound(CONNECTION, DELIVERY, "a.png", stream(new Uint8Array([1])));
    await exchange().writeOutbound(CONNECTION, other, "b.png", stream(new Uint8Array([2])));
    await exchange().removeOutbound(CONNECTION, DELIVERY);
    expect(await readdir(join(state, "exchange", "outbound", other))).toEqual(["b.png"]);
  });
});
