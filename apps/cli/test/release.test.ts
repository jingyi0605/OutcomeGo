import { afterEach, describe, expect, test } from "bun:test";
import { createHash, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { bundleFromJSON } from "@sigstore/bundle";
import { TrustedRoot } from "@sigstore/protobuf-specs";
import { toSignedEntity, toTrustMaterial, Verifier } from "@sigstore/verify";
import {
  downloadRelease,
  releaseComposeUrl,
  validateCompose,
  verifyReleaseSignature,
} from "../src/release";
import {
  LOCAL_RELEASE_KEY_ID,
  LOCAL_RELEASE_PUBLIC_KEY,
  localReleaseSigningPayload,
} from "../src/release-signing-key";

const compose = `name: outcomego
services:
  server:
    image: example/outcomego-server:\${OUTCOMEGO_VERSION}
volumes:
  outcomego_workspace:
`;

const servers: Array<{ stop(force?: boolean): void }> = [];

const verifyCapturedLocalBundle = (
  serializedBundle: string,
  repository: string,
  version: string,
  artifact: Uint8Array
): void => {
  const trustedRoot = TrustedRoot.fromJSON(
    JSON.parse(
      readFileSync(new URL("./fixtures/sigstore-tuf-cache/targets/trusted_root.json", import.meta.url), "utf8")
    )
  );
  const trustMaterial = toTrustMaterial(trustedRoot, {
    [LOCAL_RELEASE_KEY_ID]: {
      rawBytes: Buffer.from(LOCAL_RELEASE_PUBLIC_KEY
        .replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, ""), "base64"),
      keyDetails: 0,
    },
  });
  const verifier = new Verifier(trustMaterial, { ctlogThreshold: 0, tlogThreshold: 1 });
  const bundle = bundleFromJSON(JSON.parse(serializedBundle));
  verifier.verify(
    toSignedEntity(bundle, localReleaseSigningPayload(repository, version, artifact))
  );
};

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

describe("release downloads", () => {
  test("builds a version-pinned GitHub release URL", () => {
    expect(releaseComposeUrl("owner/repo", "1.2.3")).toBe(
      "https://github.com/owner/repo/releases/download/v1.2.3/outcomego-compose.yaml"
    );
  });

  test("verifies the Compose release checksum", async () => {
    const digest = createHash("sha256").update(compose).digest("hex");
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const pathname = new URL(request.url).pathname;
        if (pathname === "/outcomego-compose.yaml") return new Response(compose);
        if (pathname === "/SHA256SUMS") {
          return new Response(`${digest}  outcomego-compose.yaml\n`);
        }
        return new Response("not found", { status: 404 });
      },
    });
    servers.push(server);
    const origin = `http://127.0.0.1:${server.port}`;
    const release = await downloadRelease({
      repository: "owner/repo",
      version: "1.2.3",
      composeUrl: `${origin}/outcomego-compose.yaml`,
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
          socket.write("HTTP/1.1 200 OK\r\nContent-Length: 4096\r\n\r\nname: outcomego\n");
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
        composeUrl: `${origin}/outcomego-compose.yaml`,
        checksumUrl: `${origin}/SHA256SUMS`,
        allowUnsigned: true,
      })
    ).rejects.toThrow(`Could not download ${origin}/outcomego-compose.yaml: `);
  });

  test("rejects a checksum mismatch", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        return new URL(request.url).pathname === "/outcomego-compose.yaml"
          ? new Response(compose)
          : new Response(`${"0".repeat(64)}  outcomego-compose.yaml\n`);
      },
    });
    servers.push(server);
    const origin = `http://127.0.0.1:${server.port}`;
    await expect(
      downloadRelease({
        repository: "owner/repo",
        version: "1.2.3",
        composeUrl: `${origin}/outcomego-compose.yaml`,
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
    ).rejects.toThrow("no transparency-log entry");
  });
});

describe("local release signature trust", () => {
  const artifact = Bun.file(new URL("./fixtures/local-release-artifact.txt", import.meta.url));
  const signature = Bun.file(new URL("./fixtures/local-release-artifact.txt.sigstore.json", import.meta.url));
  const options = async () => ({ repository: "raghavpillai/openteam", version: "0.0.0", compose: await artifact.text(), serializedBundle: await signature.text() });

  test("accepts the pinned local key with a verified transparency-log entry", async () => {
    const original = await options();
    verifyCapturedLocalBundle(
      original.serializedBundle,
      original.repository,
      original.version,
      Buffer.from(original.compose)
    );
  });
  test("binds a local signature payload to the repository, version, and artifact hash", async () => {
    const original = await options();
    verifyCapturedLocalBundle(
      original.serializedBundle,
      original.repository,
      original.version,
      Buffer.from(original.compose)
    );
    for (const changed of [
      { repository: "attacker/repo", version: original.version, compose: original.compose },
      { repository: original.repository, version: "0.0.1", compose: original.compose },
      { repository: original.repository, version: original.version, compose: `${original.compose}tampered` },
    ]) {
      expect(() => verifyCapturedLocalBundle(
        original.serializedBundle,
        changed.repository,
        changed.version,
        Buffer.from(changed.compose)
      )).toThrow();
    }
  });
  test("does not accept the historical upstream key for the renamed OutcomeGo repository", async () => {
    const original = await options();
    await expect(
      verifyReleaseSignature({ ...original, repository: "jingyi0605/OutcomeGo" })
    ).rejects.toThrow("historical local release signature is bound to raghavpillai/openteam");
  });
  test("rejects untrusted keys and missing transparency evidence", async () => {
    const original = await options();
    const unknownKey = JSON.parse(original.serializedBundle);
    unknownKey.verificationMaterial.publicKey.hint = "untrusted-key";
    await expect(verifyReleaseSignature({ ...original, serializedBundle: JSON.stringify(unknownKey) })).rejects.toThrow("Untrusted local release signing key");
    const unsignedLog = JSON.parse(original.serializedBundle);
    unsignedLog.verificationMaterial.tlogEntries = [];
    await expect(verifyReleaseSignature({ ...original, serializedBundle: JSON.stringify(unsignedLog) })).rejects.toThrow("no transparency-log entry");
  });
});
