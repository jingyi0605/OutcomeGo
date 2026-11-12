/** Exercise the real Settings navigation and server-backed model form. */
import { strict as assert } from "node:assert";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "../../computer/node_modules/playwright-core";
import { ServerSetupFixture } from "../../ios/scripts/server-setup-fixture";

const repo = resolve(import.meta.dir, "../../..");
const output = join(repo, "output/model-settings");
await mkdir(output, { recursive: true });
let setup = new ServerSetupFixture(true);
let failInitial = false;
let failProvider = false;
let failSave = false;
const fixture = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (
      url.pathname === "/api/v0/server-settings" &&
      !url.searchParams.has("provider") &&
      failInitial
    ) {
      failInitial = false;
      return Response.json({ error: { message: "Settings unavailable." } }, { status: 400 });
    }
    if (
      url.pathname === "/api/v0/server-settings" &&
      url.searchParams.get("provider") === "openai" &&
      failProvider
    ) {
      failProvider = false;
      return Response.json(
        { error: { message: "Provider catalog unavailable." } },
        { status: 400 }
      );
    }
    if (
      url.pathname === "/api/v0/server-settings/inference" &&
      request.method === "PATCH" &&
      failSave
    ) {
      failSave = false;
      return Response.json({ error: { message: "Model save refused." } }, { status: 400 });
    }
    // Keep the real async test state visible long enough to check its controls.
    if (url.pathname.endsWith("/inference/test")) await Bun.sleep(350);
    const input = request.method === "GET" ? {} : await request.json().catch(() => ({}));
    return (
      setup.handle(url.pathname, request.method, input, url) ?? Response.json({}, { status: 404 })
    );
  },
});
const vite = await createServer({
  root: join(repo, "apps/desktop"),
  cacheDir: join(await mkdtemp(join(tmpdir(), "outcomego-model-settings-")), "vite"),
  server: { host: "127.0.0.1", port: 0, proxy: { "/api": { target: fixture.url.origin } } },
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await vite.listen();
  const base = vite.resolvedUrls!.local[0];
  browser = await chromium.launch({
    executablePath:
      process.env.ONBOARDING_CHROMIUM ??
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  for (const mode of ["light", "dark", "reduced-motion"]) {
    setup = new ServerSetupFixture(true);
    const page = await browser.newPage({
      viewport: { width: 1320, height: 860 },
      reducedMotion: mode === "reduced-motion" ? "reduce" : "no-preference",
    });
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const button = (name: string) => page.getByRole("button", { name, exact: true });
    const picker = (name: string) => page.getByRole("combobox", { name, exact: true });
    const select = async (name: string, option: string) => {
      await picker(name).click();
      if (name === "Model") {
        await page
          .getByRole("option")
          .filter({ has: page.locator(".setup-picker-name", { hasText: option }) })
          .click();
      } else await page.getByRole("option", { name: option, exact: true }).click();
    };
    failInitial = true;
    await page.goto(`${base}test/browser/model-onboarding.html?view=model-settings&theme=${mode}`);
    await page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("button", { name: "Model", exact: true })
      .click();
    await page.getByRole("alert").filter({ hasText: "Settings unavailable." }).waitFor();
    await button("Try again").click();
    await page.getByText("In use: OpenRouter · Saved QA model", { exact: true }).waitFor();
    assert.equal(await picker("Reasoning effort").isDisabled(), true);
    assert.equal(await button("Apply").isDisabled(), true);

    failProvider = true;
    await select("Provider", "OpenAI");
    await page.getByRole("alert").filter({ hasText: "Provider catalog unavailable." }).waitFor();
    assert.equal(await picker("Provider").innerText(), "OpenRouter");
    assert.equal(
      await picker("Model").locator(".setup-picker-value").innerText(),
      "Saved QA model"
    );
    assert.equal(await button("Apply").isDisabled(), true);
    await select("Provider", "OpenAI");
    await button("Add API key").waitFor();
    assert.equal(await picker("Model").innerText(), "No models available");
    await button("Add API key").click();
    await page.getByRole("textbox", { name: "API key", exact: true }).fill("qa-model-key");
    await button("Continue").click();
    await page.getByText("Connected with an API key.", { exact: true }).waitFor();
    await button("Apply").click();
    await page.getByText(/Working · replied/).waitFor();
    assert.deepEqual(setup.inference, {
      providerId: "openai",
      modelId: "qa-openai-model",
      reasoning: "low",
    });
    assert.deepEqual(setup.tests.at(-1), setup.inference);

    // The list ends with the way to add one, and each row shows a mark.
    await picker("Provider").click();
    const options = page.getByRole("option");
    assert.equal(await options.last().innerText(), "Add provider");
    assert.ok((await page.getByRole("option").first().locator("svg, img, span[style*=mask]").count()) > 0);
    await page.screenshot({ path: join(output, `desktop-provider-list-${mode}.png`) });
    await page.keyboard.press("Escape");
    // The X shows in the provider list on hover; no other provider needs to be picked first.
    const removeFromList = async (providerId: string, name: string) => {
      await picker("Provider").click();
      const row = page.getByTestId(`remove-provider-${providerId}`);
      await row.hover();
      await row.click();
      const confirm = page.getByRole("alertdialog");
      await confirm.getByText(`Remove ${name}?`).waitFor();
      await confirm.getByRole("button", { name: "Remove", exact: true }).click();
      await confirm.waitFor({ state: "detached" });
      // Closing the confirmation must leave the Settings dialog readable by assistive technology.
      assert.equal(
        await page.getByRole("dialog", { name: "Settings", exact: true }).getAttribute("aria-hidden"),
        null,
        "Settings stays exposed after a provider is removed"
      );
    };
    // Add a provider over a standard protocol: a refused key leaves nothing behind.
    await select("Provider", "Add provider");
    const dialog = page.getByRole("dialog", { name: "Add provider" });
    await dialog.waitFor();
    await dialog.getByRole("combobox", { name: "Service", exact: true }).click();
    // Vendor marks: DeepSeek keeps its colours (an image), Ollama follows the text colour (a mask).
    const marked = (name: string) => page.getByRole("option", { name, exact: true });
    assert.equal(await marked("DeepSeek").locator("img").count(), 1);
    assert.equal(await marked("Ollama").locator("span[style*=mask]").count(), 1);
    assert.ok(
      await marked("DeepSeek").locator("img").evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0),
      "DeepSeek's mark loads"
    );
    await page.screenshot({ path: join(output, `desktop-add-service-${mode}.png`) });
    await page.getByRole("option", { name: "DeepSeek", exact: true }).click();
    assert.equal(
      await dialog.getByRole("textbox", { name: "API base URL" }).inputValue(),
      "https://api.deepseek.com/v1"
    );
    await dialog.getByRole("combobox", { name: "Protocol", exact: true }).click();
    await page.getByRole("option", { name: "Anthropic Messages", exact: true }).click();
    assert.equal(
      await dialog.getByRole("textbox", { name: "API base URL" }).inputValue(),
      "https://api.deepseek.com/anthropic"
    );
    await dialog.getByRole("combobox", { name: "Protocol", exact: true }).click();
    await page.getByRole("option", { name: "OpenAI Chat", exact: true }).click();
    assert.equal(await dialog.getByRole("button", { name: "Add", exact: true }).isDisabled(), true);
    await dialog.getByLabel("API key").fill("qa-bad-key");
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await dialog.getByRole("alert").filter({ hasText: "That key was refused." }).waitFor();
    assert.equal(setup.added.size, 0, "A refused key leaves no provider behind");
    await dialog.getByLabel("API key").fill("qa-good-key");
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.deepEqual([...setup.added.keys()], ["deepseek-api"]);
    assert.equal(await picker("Provider").innerText(), "DeepSeek");
    await page.getByText("Connected with an API key.", { exact: true }).waitFor();
    await removeFromList("deepseek-api", "DeepSeek");
    assert.equal(setup.added.size, 0);
    // magpie takes a key for another computer's, and none for the server's own.
    await select("Provider", "Add provider");
    await dialog.waitFor();
    await dialog.getByRole("combobox", { name: "Service", exact: true }).click();
    await page.getByRole("option", { name: "magpie", exact: true }).click();
    assert.equal(await dialog.getByLabel("API key").count(), 1, "magpie shows the key field");
    assert.match(await dialog.innerText(), /optional|可选/i);
    await dialog.getByRole("textbox", { name: "API base URL" }).fill("http://10.0.0.8:3425/v1");
    await dialog.getByLabel("API key").fill("qa-good-key");
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.deepEqual([...setup.added.keys()], ["magpie-local"]);
    assert.equal(setup.added.get("magpie-local")?.key, "qa-good-key", "the key reached the server");
    assert.equal(setup.added.get("magpie-local")?.input.baseUrl, "http://10.0.0.8:3425/v1");
    await removeFromList("magpie-local", "magpie");
    assert.equal(setup.added.size, 0);
    // With the key left empty, magpie is added as a keyless local server.
    await select("Provider", "Add provider");
    await dialog.waitFor();
    await dialog.getByRole("combobox", { name: "Service", exact: true }).click();
    await page.getByRole("option", { name: "magpie", exact: true }).click();
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(setup.added.get("magpie-local")?.input.noAuth, true);
    await removeFromList("magpie-local", "magpie");
    assert.equal(setup.added.size, 0);
    // A local server needs no key.
    await select("Provider", "Add provider");
    await dialog.waitFor();
    await dialog.getByRole("combobox", { name: "Service", exact: true }).click();
    await page.getByRole("option", { name: "Ollama", exact: true }).click();
    assert.equal(await dialog.getByLabel("API key").count(), 0);
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.deepEqual([...setup.added.keys()], ["ollama-local"]);
    // Neither a built-in provider nor the one bots use has an X.
    await picker("Provider").click();
    assert.equal(await page.getByTestId("remove-provider-openrouter").count(), 0);
    await page.keyboard.press("Escape");
    await removeFromList("ollama-local", "Ollama");
    assert.equal(setup.added.size, 0);
    await select("Provider", "OpenAI");

    await select("Provider", "OpenRouter");
    await select("Model", "Reasoning QA model");
    await select("Reasoning effort", "High");
    assert.equal(await button("Test").isDisabled(), true);
    failSave = true;
    await button("Apply").click();
    await page.getByText("Model save refused.", { exact: true }).waitFor();
    assert.equal(setup.inference.providerId, "openai");
    assert.equal(await picker("Model").innerText(), "Reasoning QA model");
    assert.equal(await picker("Reasoning effort").innerText(), "High");
    await button("Apply").click();
    await page.getByText("Testing the model…", { exact: true }).waitFor();
    assert.equal(await picker("Provider").isDisabled(), true);
    assert.equal(await picker("Model").isDisabled(), true);
    assert.equal(await picker("Reasoning effort").isDisabled(), true);
    await page.getByText(/Working · replied/).waitFor();
    assert.deepEqual(setup.inference, {
      providerId: "openrouter",
      modelId: "qa-reasoning-model",
      reasoning: "high",
    });
    assert.deepEqual(setup.tests.at(-1), setup.inference);
    await select("Reasoning effort", "Low");
    assert.equal(await page.getByText(/Working · replied/).count(), 0);
    await select("Reasoning effort", "High");
    assert.equal(await button("Apply").isDisabled(), true);
    await page.screenshot({ path: join(output, `desktop-${mode}.png`) });

    await button("Close").click();
    await button("Open settings").click();
    await page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("button", { name: "Model", exact: true })
      .click();
    await page.getByText("In use: OpenRouter · Reasoning QA model", { exact: true }).waitFor();
    assert.equal(await picker("Reasoning effort").innerText(), "High");
    await select("Model", "Saved QA model");
    assert.equal(await picker("Reasoning effort").isDisabled(), true);
    assert.equal(await picker("Reasoning effort").innerText(), "Off");
    await button("Apply").click();
    await page.getByText(/Working · replied/).waitFor();
    assert.equal(setup.inference.reasoning, "off");
    await page.goto(
      `${base}test/browser/model-onboarding.html?view=model-settings&anchor=1&theme=${mode}`
    );
    await page.getByText("In use: OpenRouter · Saved QA model", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Model", exact: true }).getAttribute("aria-current"),
      "page"
    );
    setup.largeModelCatalog = true;
    await page.reload();
    await page.getByText("In use: OpenRouter · Saved QA model", { exact: true }).waitFor();
    const model = picker("Model");
    await model.focus();
    await model.press("Enter");
    const list = page.getByRole("listbox", { name: "OpenRouter models" });
    const filter = page.getByRole("textbox", { name: "Filter models" });
    await filter.waitFor();
    assert.equal(await list.getByRole("option").count(), 22);
    await list.getByRole("option").filter({ hasText: "Recommended" }).waitFor();
    assert.equal(await list.locator('[aria-selected="true"]').count(), 1);
    await page.screenshot({ path: join(output, `desktop-picker-all-${mode}.png`), animations: "disabled" });
    await filter.fill("no-such-model");
    await page.getByText("No models match “no-such-model”", { exact: true }).waitFor();
    assert.equal(await list.getByRole("option").count(), 0);
    await filter.fill("Anthropic 17");
    assert.equal(await list.getByRole("option").count(), 1);
    await list.getByText("QA model 17", { exact: true }).waitFor();
    await list.getByText("Anthropic", { exact: true }).waitFor();
    await page.screenshot({ path: join(output, `desktop-picker-${mode}.png`), animations: "disabled" });
    await filter.press("Escape");
    assert.equal(
      await page.getByRole("dialog", { name: "Settings", exact: true }).isVisible(),
      true
    );
    assert.equal(await model.locator(".setup-picker-value").innerText(), "Saved QA model");
    await model.press("Enter");
    assert.equal(await filter.inputValue(), "");
    await filter.fill("Anthropic 17");
    await filter.press("Enter");
    assert.equal(await model.locator(".setup-picker-value").innerText(), "QA model 17");
    assert.equal(setup.inference.modelId, "qa-saved-model", "Choosing a model waits for Apply");
    await select("Reasoning effort", "High");
    await button("Apply").click();
    await page.getByText(/Working · replied/).waitFor();
    assert.deepEqual(setup.inference, {
      providerId: "openrouter",
      modelId: "anthropic/qa-model-17",
      reasoning: "high",
    });
    await page.reload();
    await page.getByText("In use: OpenRouter · Anthropic: QA model 17", { exact: true }).waitFor();
    assert.equal(await model.locator(".setup-picker-value").innerText(), "QA model 17");
    assert.equal(await picker("Reasoning effort").innerText(), "High");
    assert.deepEqual(errors, []);
    console.log(
      `${mode}: Model navigation/deep link, provider failure/retry, key connection, model/reasoning save/test, failed save retention and reopen persistence; searchable catalog, maker matching, recommendations, empty state, Escape/Enter and Apply persistence passed`
    );
    await page.close();
  }
} catch (error) {
  await browser
    ?.contexts()[0]
    ?.pages()[0]
    ?.screenshot({ path: join(output, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await vite.close();
  fixture.stop(true);
}
