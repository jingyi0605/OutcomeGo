import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  downloadRelease,
  releaseComposeUrl,
  validateCompose,
  verifyReleaseSignature,
} from "../src/release";

const compose = `name: aiteamos
services:
  server:
    image: example/aiteamos-server:\${AITEAMOS_VERSION}
volumes:
  aiteamos_workspace:
`;

const servers: Array<{ stop(force?: boolean): void }> = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

describe("release downloads", () => {
  test("builds a version-pinned GitHub release URL", () => {
    expect(releaseComposeUrl("owner/repo", "1.2.3")).toBe(
      "https://github.com/owner/repo/releases/download/v1.2.3/aiteamos-compose.yaml"
    );
  });

  test("verifies the Compose release checksum", async () => {
    const digest = createHash("sha256").update(compose).digest("hex");
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const pathname = new URL(request.url).pathname;
        if (pathname === "/aiteamos-compose.yaml") return new Response(compose);
        if (pathname === "/SHA256SUMS") {
          return new Response(`${digest}  aiteamos-compose.yaml\n`);
        }
        return new Response("not found", { status: 404 });
      },
    });
    servers.push(server);
    const origin = `http://127.0.0.1:${server.port}`;
    const release = await downloadRelease({
      repository: "owner/repo",
      version: "1.2.3",
      composeUrl: `${origin}/aiteamos-compose.yaml`,
      checksumUrl: `${origin}/SHA256SUMS`,
      allowUnsigned: true,
    });
    expect(release.compose).toBe(compose);
    expect(release.version).toBe("1.2.3");
  });

  test("names the file when its download breaks off after the headers", async () => {
    // Promise 4 KB, send a line, then hang up while the body is being read.
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket) {
          socket.write("HTTP/1.1 200 OK\r\nContent-Length: 4096\r\n\r\nname: aiteamos\n");
          setTimeout(() => socket.end(), 100);
        },
      },
    });
    servers.push(server);
    const origin = `http://127.0.0.1:${server.port}`;
    await expect(
      downloadRelease({
        repository: "owner/repo",
        version: "1.2.3",
        composeUrl: `${origin}/aiteamos-compose.yaml`,
        checksumUrl: `${origin}/SHA256SUMS`,
        allowUnsigned: true,
      })
    ).rejects.toThrow(`Could not download ${origin}/aiteamos-compose.yaml: `);
  });

  test("rejects a checksum mismatch", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        return new URL(request.url).pathname === "/aiteamos-compose.yaml"
          ? new Response(compose)
          : new Response(`${"0".repeat(64)}  aiteamos-compose.yaml\n`);
      },
    });
    servers.push(server);
    const origin = `http://127.0.0.1:${server.port}`;
    await expect(
      downloadRelease({
        repository: "owner/repo",
        version: "1.2.3",
        composeUrl: `${origin}/aiteamos-compose.yaml`,
        checksumUrl: `${origin}/SHA256SUMS`,
        allowUnsigned: true,
      })
    ).rejects.toThrow("Checksum verification failed");
  });

  test("rejects unrelated Compose content", () => {
    expect(() => validateCompose("services:\n  app:\n    image: example\n")).toThrow(
      "unexpected size"
    );
  });

  test("fails closed for a malformed or untrusted Sigstore bundle", async () => {
    await expect(
      verifyReleaseSignature({
        repository: "owner/repo",
        version: "1.2.3",
        compose,
        serializedBundle: "{}",
      })
    ).rejects.toThrow("Sigstore verification failed");
  });
});

describe("local release signature trust", () => {
  const artifact = Bun.file(new URL("./fixtures/local-release-artifact.txt", import.meta.url));
  const signature = Bun.file(new URL("./fixtures/local-release-artifact.txt.sigstore.json", import.meta.url));
  const options = async () => ({ repository: "raghavpillai/openteam", version: "0.0.0", compose: await artifact.text(), serializedBundle: await signature.text() });

  test("accepts the pinned local key with a verified transparency-log entry", async () => {
    await verifyReleaseSignature(await options());
  });
  test("rejects modified bytes and cross-version or cross-repository replay", async () => {
    const original = await options();
    for (const changed of [{ compose: original.compose + "tampered" }, { version: "0.0.1" }, { repository: "attacker/repo" }])
      await expect(verifyReleaseSignature({ ...original, ...changed })).rejects.toThrow("Sigstore verification failed");
  });
  test("rejects untrusted keys and missing transparency evidence", async () => {
    const original = await options();
    const unknownKey = JSON.parse(original.serializedBundle);
    unknownKey.verificationMaterial.publicKey.hint = "untrusted-key";
    await expect(verifyReleaseSignature({ ...original, serializedBundle: JSON.stringify(unknownKey) })).rejects.toThrow("Untrusted local release signing key");
    const unsignedLog = JSON.parse(original.serializedBundle);
    unsignedLog.verificationMaterial.tlogEntries = [];
    await expect(verifyReleaseSignature({ ...original, serializedBundle: JSON.stringify(unsignedLog) })).rejects.toThrow("Sigstore verification failed");
  });
});
