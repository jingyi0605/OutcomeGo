import { strict as assert } from "node:assert";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import { chromium } from "../../computer/node_modules/playwright-core";
import { ServerSetupFixture } from "../../ios/scripts/server-setup-fixture";

const root = resolve(import.meta.dir, "..");
const temporary = await mkdtemp(join(tmpdir(), "outcomego-onboarding-"));
const dist = join(temporary, "dist");
const profile = join(temporary, "profile");
const origin = "https://onboarding.outcomego.test";
const entry = "/test/browser/model-onboarding.html";
const headless = process.argv.includes("--check");
const dark = process.argv.includes("--dark");

const buildPage = () =>
  build({
    root,
    cacheDir: join(temporary, "vite"),
    define: { "import.meta.env.VITE_OUTCOMEGO_API_URL": JSON.stringify(origin) },
    logLevel: headless ? "warn" : "error",
    build: { outDir: dist, emptyOutDir: true, rolldownOptions: { input: join(root, entry) } },
  });

// The page is served from a fake origin, so Vite's dev server and HMR can't reach it. Instead
// each reload of the page rebuilds it (a second or so with the warm cache), so a refresh always
// shows the current source. The check run builds once: its source doesn't change.
let building: Promise<unknown> = Promise.resolve();
const rebuild = () => {
  building = building.catch(() => {}).then(buildPage);
  return building;
};
if (headless) await buildPage();

const context = await chromium.launchPersistentContext(profile, {
  ...(process.env.ONBOARDING_CHROMIUM
    ? { executablePath: process.env.ONBOARDING_CHROMIUM }
    : { channel: "msedge" }),
  headless,
  locale: headless ? "en-US" : process.env.ONBOARDING_LOCALE ?? "zh-CN",
  serviceWorkers: "block",
  viewport: headless ? { width: 1320, height: 860 } : null,
});

const freeModels = [
  ["OpenRouter", "openrouter", "openrouter/free"],
  ["Groq", "groq-api", "openai/gpt-oss-20b"],
  ["Google Gemini", "gemini-api", "gemini-3.1-flash-lite"],
  ["SiliconFlow (China)", "siliconflow-cn-api", "Qwen/Qwen3-8B"],
  ["Zhipu GLM", "zhipu-api", "glm-4.7-flash"],
] as const;

const freshSetup = () => {
  const fixture = new ServerSetupFixture(true);
  fixture.inference = { ...fixture.inference, modelId: "" };
  fixture.extraModels = freeModels.map(([, providerId, modelId]) => ({
    providerId,
    modelId,
    name: modelId,
    reasoning: false,
    reasoningLevels: ["off"],
    defaultReasoningLevel: "off",
    contextWindow: 128_000,
    maxTokens: 4096,
  }));
  return fixture;
};

try {
  let setup = freshSetup();
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === entry && request.isNavigationRequest()) {
      setup = freshSetup();
      if (!headless) {
        try {
          await rebuild();
        } catch (error) {
          // A source file saved mid-edit shouldn't kill the preview: show the error and let the
          // next reload try again.
          console.error(error);
          return route.fulfill({
            status: 500,
            contentType: "text/plain; charset=utf-8",
            body: `Build failed. Fix the error and reload.\n\n${error instanceof Error ? error.message : error}`,
          });
        }
      }
    }
    if (url.pathname === entry || url.pathname.startsWith("/assets/")) {
      return route.fulfill({ path: join(dist, url.pathname) }).catch(() => route.fulfill({ status: 404 }));
    }
    const response = url.pathname === "/api/v0/server-settings/web-providers" && request.method() === "GET"
      ? Response.json({ search: { selected: null, providers: {} }, fetch: { selected: "builtin", providers: {} } })
      : setup.handle(url.pathname, request.method(), request.postDataJSON() ?? {}, url);
    return response
      ? route.fulfill({ status: response.status, contentType: "application/json", body: await response.text() })
      : route.fulfill({ status: 404, json: { message: "This endpoint is unavailable in the onboarding preview." } });
  });

  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(`${origin}${entry}${dark ? "?theme=dark" : ""}`);
  console.log(`Temporary browser profile: ${profile}`);
  if (headless) {
    const modelChoice = page.getByRole("heading", { name: "Choose your bots' AI" });
    // The server check waits for Start exploring before it moves on to the AI step.
    const openModelChoice = async () => {
      await page.getByRole("button", { name: /^Start exploring/ }).click();
      await modelChoice.waitFor();
    };
    await openModelChoice();
    assert.deepEqual(await page.locator(".setup-content .setup-option strong").allTextContents(), [
      "ChatGPT", "Claude", "Add a custom provider", "Free and limited-use models",
    ]);
    const openFreeModels = async () => {
      await page.getByRole("button", { name: /^Free and limited-use models/ }).click();
      return page.getByRole("dialog", { name: "Free and limited-use models" });
    };
    const chooser = await openFreeModels();
    assert.deepEqual(await chooser.getByRole("heading", { level: 3 }).allTextContents(), [
      "Zhipu GLM · GLM-4.7-Flash",
      "SiliconFlow (China) · Qwen3-8B",
      "OpenRouter · Free Models Router",
      "Groq · GPT-OSS 20B",
      "Google Gemini · Gemini 3.1 Flash-Lite",
      "OpenCode Zen free models",
    ]);
    await chooser.getByText(/Chinese-first model with tool calling/).waitFor();
    await chooser.getByText(/One API key for multiple models/).waitFor();
    const logos = await chooser.getByTestId("free-provider-logo").evaluateAll(async (tiles) =>
      Promise.all(tiles.map(async (tile) => {
        const image = tile.querySelector("img");
        if (image) {
          await image.decode();
          return image.naturalWidth > 0;
        }
        const mark = tile.firstElementChild;
        const mask = mark && /^url\("(.+)"\)$/.exec(getComputedStyle(mark).maskImage);
        if (!mask?.[1]) return false;
        const maskedImage = new Image();
        maskedImage.src = mask[1];
        await maskedImage.decode();
        return maskedImage.naturalWidth > 0;
      }))
    );
    assert.deepEqual(logos, [true, true, true, true, true, true]);
    await chooser.getByText(/20 requests per minute/).waitFor();
    await chooser.getByText(/daily request and token limits/).waitFor();
    await chooser.getByText(/per-project limits/).waitFor();
    await chooser.getByText(/verified account/).waitFor();
    await chooser.getByText(/Use free models with key public/).waitFor();
    await chooser.getByRole("button", { name: "Connect OpenCode Zen", exact: true }).click();
    const openCodeTerms = page.getByRole("dialog", { name: "OpenCode Zen free-model terms" });
    const agree = openCodeTerms.getByRole("button", { name: "Agree & continue", exact: true });
    assert.equal(await agree.isDisabled(), true);
    await openCodeTerms.getByRole("checkbox").check();
    await agree.click();
    await page.getByRole("heading", { name: "Enter your OpenCode Zen key" }).waitFor();
    const keyField = page.getByLabel("API key", { exact: true });
    assert.equal(await keyField.getAttribute("placeholder"), "public");
    await keyField.fill("public");
    assert.equal(await keyField.getAttribute("type"), "text");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.getByRole("heading", { name: "It works!" }).waitFor();
    assert.deepEqual(setup.saves.map((selection) => [selection.providerId, selection.modelId]), [["opencode", "big-pickle"]]);
    assert.deepEqual(setup.tests.map((selection) => [selection.providerId, selection.modelId]), [["opencode", "big-pickle"]]);
    assert.equal(await page.getByRole("combobox").count(), 1);
    await page.reload();
    await openModelChoice();
    const connect = async (provider: string) => {
      const offers = await openFreeModels();
      await offers.getByRole("button", { name: `Connect ${provider}`, exact: true }).click();
      await page.getByLabel("API key", { exact: true }).fill("qa-good-key");
      await page.getByRole("button", { name: "Connect", exact: true }).click();
    };
    for (const [name, providerId, modelId] of freeModels) {
      await connect(name);
      await page.getByRole("heading", { name: "It works!" }).waitFor();
      assert.deepEqual(setup.saves.map((selection) => selection.modelId), [modelId]);
      assert.deepEqual(setup.tests.map((selection) => [selection.providerId, selection.modelId]), [[providerId, modelId]]);
      assert.equal(await page.getByRole("combobox").count(), 0);
      await page.reload();
      await openModelChoice();
    }
    setup.extraModels = [];
    await connect("OpenRouter");
    await page.getByRole("alert").filter({ hasText: /isn't available on this account/ }).waitFor();
    assert.deepEqual(setup.saves, []);
    assert.deepEqual(setup.tests, []);
    await page.reload();
    await openModelChoice();
    await page.getByRole("button", { name: /^Add a custom provider/ }).click();
    const provider = page.getByRole("dialog", { name: "Add provider" });
    await provider.getByRole("textbox", { name: "Name", exact: true }).fill("QA Gateway");
    await provider.getByRole("textbox", { name: "API base URL" }).fill("https://provider.example/v1");
    await provider.getByLabel("API key", { exact: true }).fill("qa-good-key");
    await provider.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("heading", { name: "It works!" }).waitFor();
    assert.equal(setup.tests.at(-1)?.providerId, "custom-qa-gateway");
    await page.reload();
    await openModelChoice();
    assert.equal(setup.added.size, 0);
    console.log("Passed provider order, free-tier disclosures, five API setup flows, unavailable-model guard, custom-provider setup, and reset on reload.");
  } else {
    console.log("Reload to rebuild and reset onboarding. Close the browser window to exit.");
    await context.waitForEvent("close", { timeout: 0 });
  }
} finally {
  await context.close();
}
