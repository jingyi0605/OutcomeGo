import { resolve } from "node:path";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { createServer } from "vite";

// A disposable stand-in server stays alive across renderer reloads. No production API is used.
let fixtureId = 0;
const original = (kind: string) => ({
  id: `delivery-${kind}-${fixtureId}`, channelId: "fixture", sender: "agent", senderBotId: "bot",
  sourceRunId: null, createdAt: "2026-11-17T00:00:00Z", content: "Review",
  metadata: {
    type: kind === "email" ? "external-draft" : "imessage-send", cardState: "pending",
    draft: { platform: "email", providerIdentifier: "gmail", from: "me@example.com",
      to: ["you@example.com"], subject: "Fixture", body: "Original body", replyToMessageId: "original",
      verification: { thread: "Original thread", identity: "me@example.com" } },
    imessage: { text: "Original text", to: "+15555550100", machineLabel: "Fixture Mac",
      attachments: [{ fileName: "report.pdf" }] },
  },
});
let truth = original("email");
let writes = 0;
let offline = false;
let loseReply = false;
let failSend = false;
let latency = 200;
const server = await createServer({
  root: resolve(import.meta.dir, ".."),
  configFile: resolve(import.meta.dir, "../vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false },
  logLevel: "error",
  plugins: [{
    name: "desktop-delivery-fixture",
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/__delivery-fixture/")) return next();
        const url = new URL(req.url, "http://fixture");
        const action = url.pathname.split("/").at(-1);
        res.setHeader("content-type", "application/json");
        if (action === "bootstrap") return res.end(JSON.stringify(original(url.searchParams.get("kind") ?? "email")));
        if (action === "status") return res.end(JSON.stringify({ writes, truth }));
        if (action === "control") {
          let input = "";
          for await (const bytes of req) input += bytes;
          const value = JSON.parse(input);
          if (value.reset) {
            fixtureId++; truth = original(value.kind); writes = 0; offline = false;
            loseReply = false; failSend = false; latency = 200;
          }
          offline = value.offline ?? offline;
          loseReply = value.loseReply ?? loseReply;
          failSend = value.failSend ?? failSend;
          latency = value.latency ?? latency;
          return res.end("{}");
        }
        if (action === "refresh") {
          if (offline) { res.statusCode = 503; return res.end("offline"); }
          return res.end(JSON.stringify({ message: truth }));
        }
        let input = "";
        for await (const bytes of req) input += bytes;
        writes++;
        if (action !== "cancel") {
          truth.metadata.cardState = "sending";
          truth.metadata.draft = { ...truth.metadata.draft, ...JSON.parse(input) };
        }
        await new Promise((done) => setTimeout(done, latency));
        truth.metadata.cardState = failSend ? "pending" : action === "cancel" ? "dismissed" : "sent";
        if (loseReply || failSend) { res.statusCode = 503; return res.end("lost reply"); }
        res.end(JSON.stringify({ message: truth }));
      });
    },
  }],
});
await server.listen();
const profile = await mkdtemp(resolve(tmpdir(), "outcomego-delivery-regression-"));
try {
  const build = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "../src/main/durable-send-journal-store.ts")],
    outdir: profile, naming: "journal.cjs", format: "cjs", target: "node",
  });
  if (!build.success) throw new AggregateError(build.logs, "Journal fixture build failed");
  const child = Bun.spawn([
    createRequire(import.meta.url)("electron") as string,
    resolve(import.meta.dir, "../test/browser/desktop-delivery-runner.cjs"), profile,
    `${server.resolvedUrls!.local[0]}test/browser/desktop-delivery.html`,
  ], { env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, stdout: "inherit", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), 120_000);
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  clearTimeout(timer);
  const result = await readFile(resolve(profile, "result.json"), "utf8").catch(() => "{}");
  console.log(result);
  if (code || JSON.parse(result).error) throw new Error(`Desktop delivery regression failed: ${result}\n${stderr}`);
} finally {
  await rm(profile, { recursive: true, force: true });
  await server.close();
}
