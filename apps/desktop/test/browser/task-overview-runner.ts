import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TASK_POLICY_FIELDS } from "@outcomego/contracts/task-policy";
import { build } from "vite";
import { translate } from "../../src/renderer/lib/i18n-catalog";

const { chromium } = createRequire(resolve(import.meta.dir, "../../../computer/package.json"))("playwright-core") as typeof import("../../../computer/node_modules/playwright-core");
const output = await mkdtemp(join(tmpdir(), "outcomego-task-overview-"));
const base = "https://task-overview.fixture.invalid";
const entry = "test/browser/task-overview.html";
const root = resolve(import.meta.dir, "../..");
const buildDir = join(output, "build");
await build({
  root, configFile: join(root, "vite.config.ts"),
  build: { outDir: buildDir, manifest: false, rolldownOptions: { input: { index: join(root, entry) } } },
  define: { "import.meta.env.VITE_OUTCOMEGO_API_URL": JSON.stringify(base) },
  logLevel: "error",
});
console.log(`Evidence ${output}`);
const browser = await chromium.launch({ executablePath: process.env.TOV_CHROMIUM_PATH });
const policy = TASK_POLICY_FIELDS.find((field) => field.key === "schedule.graceMinutes")!;
const startSettings = {
  outcomesEnabled: true, streamBotReplies: false, taskPolicy: {} as Record<string, number>, plannerBotId: null, reviewerBotId: null,
  plannerModel: null, reviewerModel: null,
};
const provider = { id: "fixture-provider", name: "Fixture Provider", connected: true };
const model = { modelId: "fixture-model", name: "Fixture Model", recommended: true, defaultReasoningLevel: "medium" };

try {
  for (const [theme, lang] of [["light", "en"], ["dark", "en"], ["light", "zh"], ["dark", "zh"]]) {
    const context = await browser.newContext({ viewport: { width: 1150, height: 810 }, locale: lang === "zh" ? "zh-CN" : "en-US", reducedMotion: "reduce", timezoneId: "Asia/Singapore" });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const errors: Error[] = [];
    const patches: Array<Record<string, unknown>> = [];
    const settings = structuredClone(startSettings);
    page.on("pageerror", (failure) => errors.push(failure));
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== base) return route.abort();
      if (url.pathname === "/api/v0/client-bootstrap") return route.fulfill({ json: { bots: [{ id: "bot-a", name: "Alpha", status: "active" }] } });
      if (url.pathname === "/api/v0/server-settings") return route.fulfill({
        json: { providers: [provider], models: [model], inference: { providerId: provider.id, reasoning: "medium" } },
      });
      if (url.pathname.endsWith("/brief")) return route.fulfill({ status: 404, json: { error: "No fixture brief" } });
      if (url.pathname === "/api/v0/feature-settings") {
        if (request.method() === "PATCH") {
          const patch = request.postDataJSON();
          patches.push(patch);
          if (patch.taskPolicy) Object.assign(settings.taskPolicy, patch.taskPolicy);
          const { taskPolicy: _taskPolicy, ...featurePatch } = patch;
          Object.assign(settings, featurePatch);
        }
        return route.fulfill({ json: settings });
      }
      if (url.pathname.startsWith("/api/")) throw new Error(`Unexpected fixture endpoint ${request.method()} ${url.pathname}`);
      return route.fulfill({ path: join(buildDir, url.pathname) });
    });
    const visit = async (view: string, options = "") => {
      await page.goto(`${base}/${entry}?theme=${theme}&lang=${lang}&page=${view}${options}`);
      await page.waitForFunction(({ lang, theme }) => document.documentElement.lang === lang && document.documentElement.dataset.theme === theme, { lang: lang === "zh" ? "zh-CN" : "en-US", theme });
    };
    const shot = (view: string) => page.screenshot({ path: join(output, `${view}-${theme}-${lang}.png`), animations: "disabled" });
    const copy = (key: string) => translate(lang === "zh" ? "zh-CN" : "en-US", key);
    const moreDetails = page.getByRole("button", { name: copy("More details"), exact: true });
    try {
      await visit("timeline");
      await moreDetails.click();
      const chart = page.locator(".outcome-timeline-chart-scroll");
      const today = page.getByRole("button", { name: lang === "zh" ? "回到今天" : "Back to today" });
      await today.waitFor();
      assert.equal(await page.locator(".outcome-timeline-axis").getAttribute("data-unit"), "day");
      assert.equal(await page.locator(".outcome-timeline-link").count(), 1);
      assert.equal(await page.locator(".outcome-timeline-gap").count(), 1);
      assert.ok(await page.locator('.outcome-timeline-status[data-tone="pass"]').evaluate((badge) => getComputedStyle(badge).color !== getComputedStyle(badge.closest(".outcome-timeline")!).color));
      assert.ok(await page.locator(".outcome-timeline-estimate-label").first().evaluate((label) => {
        const estimate = label.parentElement!;
        const chart = label.closest(".outcome-timeline-chart")!;
        return getComputedStyle(estimate).overflow === "visible" && label.getBoundingClientRect().right <= chart.getBoundingClientRect().right;
      }));
      assert.ok(await page.locator(".outcome-timeline-defer").evaluate((note) => note.closest(".outcome-timeline-label") !== null));
      assert.ok(await page.locator(".outcome-timeline [data-animated] .outcome-timeline-icon").evaluate((icon) => getComputedStyle(icon).animationName === "none"));
      assert.equal(await page.getByRole("table", { name: lang === "zh" ? "任务时间线（列表形式）" : "Task timeline as a list" }).count(), 1);
      await shot("timeline");
      await page.setViewportSize({ width: 430, height: 760 });
      const before = await chart.evaluate((area) => area.scrollLeft);
      await today.focus();
      await page.keyboard.press("Enter");
      assert.ok(await chart.evaluate((area) => area.scrollLeft) > before);
      assert.ok(await today.evaluate((button) => button === document.activeElement));
      const geometry = await chart.evaluate((area) => {
        const track = area.querySelector(".outcome-timeline-rows .outcome-timeline-track")!.getBoundingClientRect();
        const points = area.querySelector("polyline")!;
        const start = points.points.getItem(0).matrixTransform(points.getScreenCTM()!);
        const end = points.points.getItem(3).matrixTransform(points.getScreenCTM()!);
        const successor = area.querySelector(".outcome-timeline-row[data-state='running'] .outcome-timeline-track")!.getBoundingClientRect();
        const body = area.querySelector(".outcome-timeline-chart-body")!.getBoundingClientRect();
        const marker = area.querySelector(".outcome-timeline-today")!.getBoundingClientRect();
        return {
          centered: Math.abs(marker.x - area.getBoundingClientRect().x - area.clientWidth / 2) < 2,
          aligned: Math.abs(start.y - track.y - track.height / 2) < 1 && Math.abs(end.y - successor.y - successor.height / 2) < 1 && marker.top === body.top,
        };
      });
      assert.deepEqual(geometry, { centered: true, aligned: true });
      const edit = page.getByRole("button", { name: /Task 3$/ });
      await edit.focus();
      await page.keyboard.press("Enter");
      const editor = page.locator(".outcome-timeline-editor-row form");
      const scheduled = editor.locator('input[type="datetime-local"]').first();
      await page.keyboard.press("Tab");
      assert.ok(await scheduled.evaluate((field) => field === document.activeElement));
      const timeFields = await editor.locator('input[type="datetime-local"]').evaluateAll((fields) => fields.map((field) => field.getBoundingClientRect().y));
      assert.ok(timeFields[1]! > timeFields[0]!);
      await editor.locator('button[type="submit"]').scrollIntoViewIfNeeded();
      await shot("schedule-narrow");
      await scheduled.fill("2026-12-13T14:00");
      await editor.locator('button[type="submit"]').click();
      await page.waitForFunction(() => document.querySelector("main")?.dataset.writes === "1");
      await editor.waitFor({ state: "detached" });
      await page.getByRole("button", { name: copy("Change due date"), exact: true }).click();
      const dueForm = page.locator(".outcome-schedule-editor");
      await dueForm.locator('input[type="datetime-local"]').fill("2026-12-14T14:00");
      await dueForm.locator('button[type="submit"]').click();
      await page.waitForFunction(() => document.querySelector("main")?.dataset.writes === "2");
      await visit("timeline", "&refuse=1");
      await moreDetails.click();
      await edit.click();
      await scheduled.fill("2026-12-13T14:00");
      await editor.locator('button[type="submit"]').click();
      await editor.getByRole("alert").getByText("Fixture refused the date").waitFor();

      await visit("human");
      await page.getByText("Fixture Beta", { exact: true }).first().waitFor();
      assert.equal(await page.locator("time[datetime]").count(), 2);
      await page.getByText(lang === "zh" ? "已逾期" : "Overdue", { exact: false }).first().waitFor();
      await shot("human");

      await page.setViewportSize({ width: 1150, height: 810 });
      await visit("dashboard");
      await page.locator(".outcome-activity-cards").first().waitFor();
      assert.equal(await page.locator(".outcome-activity-card").count(), 2);
      assert.ok(await page.locator('.outcome-activity-status[data-tone="review"]').first().evaluate((badge) => getComputedStyle(badge).color !== getComputedStyle(badge.closest(".outcome-activity")!).color));
      assert.equal(await page.locator("[data-needs-me-request]").count(), 2);
      assert.equal(await page.locator("[data-needs-me-request]").first().getAttribute("data-zone"), "exception");
      assert.match(await page.locator('[data-needs-me-request="request:owner-a"]').innerText(), /<b>Fixture A<\/b>/);
      await page.locator('[data-needs-me-request="request:owner-a"] button').click();
      assert.equal(await page.locator("main").getAttribute("data-channel"), "channel-a");
      await shot("dashboard-cards");
      await page.setViewportSize({ width: 430, height: 760 });
      await page.locator('.outcome-activity button[aria-pressed]').click();
      await page.locator(".outcome-activity-table").waitFor();
      assert.equal(await page.locator(".outcome-activity-grouprow").count(), 2);
      await page.locator(".outcome-activity-table th").first().scrollIntoViewIfNeeded();
      await shot("dashboard-table-narrow");

      await page.setViewportSize({ width: 1150, height: 810 });
      await visit("settings");
      const schedule = page.locator('[data-settings-anchor="goal-schedule"]');
      await schedule.waitFor();
      await page.waitForFunction(() => document.querySelector('[data-settings-anchor="goal-schedule"]')?.classList.contains("settings-anchor-target"));
      const settingsNav = page.getByRole("navigation", { name: copy("Settings sections") });
      const sections = await settingsNav.getByRole("button").allTextContents();
      assert.deepEqual(sections.slice(sections.indexOf(copy("Model")), sections.indexOf(copy("Model")) + 3), [copy("Model"), copy("Goal management"), copy("Voice notes")]);
      await shot("settings");
      const field = page.locator(`[data-policy-input="${policy.key}"]`);
      await field.fill(String(policy.max));
      await Promise.all([page.waitForResponse((response) => response.request().method() === "PATCH"), field.press("Enter")]);
      assert.deepEqual(patches.at(-1), { taskPolicy: { [policy.key]: policy.max } });
      await field.fill(String(policy.min));
      await Promise.all([page.waitForResponse((response) => response.request().method() === "PATCH"), page.keyboard.press("Tab")]);
      assert.deepEqual(patches.at(-1), { taskPolicy: { [policy.key]: policy.min } });
      for (const [label, key] of [["Planner bot", "plannerBotId"], ["Reviewer bot", "reviewerBotId"]] as const) {
        await page.getByRole("combobox", { name: copy(label), exact: true }).click();
        await Promise.all([page.waitForResponse((response) => response.request().method() === "PATCH"), page.getByRole("option", { name: "Alpha" }).click()]);
        assert.deepEqual(patches.at(-1), { [key]: "bot-a" });
      }
      for (const [label, key] of [["Planner independent model", "plannerModel"], ["Reviewer independent model", "reviewerModel"]] as const) {
        await page.getByRole("combobox", { name: copy(label), exact: true }).click();
        await Promise.all([page.waitForResponse((response) => response.request().method() === "PATCH"), page.getByRole("option", { name: provider.name }).click()]);
        assert.deepEqual(patches.at(-1), { [key]: { providerId: provider.id, modelId: model.modelId, reasoning: "medium" } });
      }
      const master = page.locator('[data-settings-anchor="goal-management"] button[role="switch"]');
      await master.click();
      await page.locator("fieldset[disabled]").first().waitFor();
      await field.evaluate((input: HTMLInputElement) => input.focus());
      assert.ok(await field.evaluate((input) => input !== document.activeElement));
      await master.focus();
      for (let index = 0; index < 4; index++) {
        await page.keyboard.press("Tab");
        assert.ok(await page.evaluate(() => !document.activeElement?.closest("fieldset[disabled]")));
      }
      await shot("settings-disabled");
      assert.deepEqual(errors, []);
      console.log(`PASS ${theme}/${lang} timeline, schedule, human card, dashboard and settings`);
    } catch (failure) {
      await shot("failure");
      throw failure;
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
