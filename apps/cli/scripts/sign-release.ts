import { chmod, stat } from "node:fs/promises";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { bundleToJSON } from "@sigstore/bundle";
import { MessageSignatureBundleBuilder, RekorWitness } from "@sigstore/sign";
import { sign as keylessSign } from "sigstore";
import { DEFAULT_REPOSITORY } from "../src/constants";
import { LOCAL_RELEASE_KEY_ID, LOCAL_RELEASE_PUBLIC_KEY, localReleaseSigningPayload } from "../src/release-signing-key";
import { verifyArtifactSignature } from "../src/release";

// Two signing modes, both verified by `verifyArtifactSignature` before anything is written:
//   keyless  (OUTCOMEGO_RELEASE_SIGNING_MODE=keyless): GitHub Actions OIDC identity plus Fulcio and
//            Rekor. Only valid from .github/workflows/release.yml on the release tag, which is the
//            identity the CLI verifier pins. No private key exists.
//   local    (default): the protected P-256 key at OUTCOMEGO_RELEASE_SIGNING_KEY_PATH.
const files = process.argv.slice(2);
if (!files.length) throw new Error("Pass at least one release artifact to sign");
const keyless = process.env.OUTCOMEGO_RELEASE_SIGNING_MODE === "keyless";
const version = (await Bun.file(new URL("../package.json", import.meta.url)).json()).version;
const repository = DEFAULT_REPOSITORY;

let createBundle: (artifact: Buffer) => Promise<unknown>;
if (keyless) {
  if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL)
    throw new Error("Keyless signing needs a GitHub Actions job with `id-token: write`");
  createBundle = artifact => keylessSign(artifact);
} else {
  const keyPath = process.env.OUTCOMEGO_RELEASE_SIGNING_KEY_PATH;
  if (!keyPath || ((await stat(keyPath)).mode & 0o077))
    throw new Error("Set OUTCOMEGO_RELEASE_SIGNING_KEY_PATH to a protected local key file");
  const key = createPrivateKey(await Bun.file(keyPath).text());
  const publicKey = createPublicKey(key).export({ type: "spki", format: "pem" }).toString();
  if (publicKey !== LOCAL_RELEASE_PUBLIC_KEY) throw new Error("Signing key does not match the pinned release identity");
  const builder = new MessageSignatureBundleBuilder({
    signer: { sign: async data => ({ signature: sign("sha256", data, key), key: { $case: "publicKey", publicKey, hint: LOCAL_RELEASE_KEY_ID } }) },
    witnesses: [new RekorWitness({ timeout: 30_000, retry: 2, fetchOnConflict: true })],
  });
  createBundle = async artifact => bundleToJSON(await builder.create({ data: localReleaseSigningPayload(repository, version, artifact) }));
}

for (const file of files) {
  const artifact = Buffer.from(await Bun.file(file).arrayBuffer());
  const serializedBundle = JSON.stringify(await createBundle(artifact));
  await verifyArtifactSignature({ repository, version, artifact, serializedBundle });
  const destination = `${file}.sigstore.json`;
  await Bun.write(destination, serializedBundle + "\n");
  await chmod(destination, 0o600);
  console.log(`Signed and verified ${file} → ${destination}`);
}
