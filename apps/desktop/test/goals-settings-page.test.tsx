import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TASK_POLICY_FIELDS } from "@outcomego/contracts/task-policy";
import type { OutcomeAutoAcceptRulesClient } from "../src/renderer/client/outcome-api";

// Specs/004.10 task 2.9, requirements E1-E3. The api module is replaced so no request leaves the test.
mock.module("../src/renderer/client/outcomego-api", () => ({
  api: { bootstrap: async () => ({ bots: [] }), featureSettings: async () => ({}), updateFeatureSettings: async () => ({}) },
}));
const { I18nProvider } = await import("../src/renderer/lib/i18n");
const { GoalsSettingsView } = await import("../src/renderer/components/outcomego/settings/goals-view");

type Features = Parameters<typeof GoalsSettingsView>[0]["features"];
const features = (overrides: Partial<Features> = {}): Features => ({
  outcomesEnabled: true, streamBotReplies: false, plannerBotId: null, reviewerBotId: null, plannerModel: null, reviewerModel: null,
  environmentNote: null, taskPolicy: {}, updatedAt: null, loaded: true, failed: false, update: async () => undefined as never, retry: () => undefined,
  ...overrides,
});
const render = (value: Features, autoAcceptRules?: OutcomeAutoAcceptRulesClient) => renderToStaticMarkup(createElement(I18nProvider, { children: createElement(GoalsSettingsView, { features: value, autoAcceptRules }) }));
const schedule = TASK_POLICY_FIELDS.filter((entry) => entry.group === "schedule");
const activityFields = TASK_POLICY_FIELDS.filter((entry) => entry.group === "activity");

describe("goal management page", () => {
  test("shows the master switch, planning and review, and scheduling groups, each with its deep-link anchor", () => {
    const html = render(features());
    for (const anchor of ["goal-management", "goal-roles", "goal-schedule", "goal-activity", "goal-todo"]) expect(html).toContain(`data-settings-anchor="${anchor}"`);
  });

  test("does not show groups whose feature does not exist yet: no empty shells", () => {
    const html = render(features());
    expect(html).not.toContain('data-settings-anchor="goal-auto-accept"');
  });

  test("the auto-accept rules group follows its settings anchor and the goal management switch", () => {
    const rules: OutcomeAutoAcceptRulesClient = {
      list: async () => ({ rules: [] }),
      create: async () => { throw new Error("unexpected write"); },
      update: async () => { throw new Error("unexpected write"); },
      remove: async () => { throw new Error("unexpected write"); },
    };
    expect(render(features(), rules)).toContain('data-settings-anchor="goal-auto-accept"');
    expect(render(features({ outcomesEnabled: false }), rules)).toContain('data-settings-anchor="goal-auto-accept" data-goals-disabled="true"');
    for (const field of TASK_POLICY_FIELDS.filter((entry) => entry.group === "todo")) {
      expect(render(features(), rules)).toContain(`data-policy-key="${field.key}"`);
    }
  });

  test("with goal management on, every other group is usable", () => {
    const html = render(features({ outcomesEnabled: true }));
    expect(html).not.toContain('data-goals-disabled="true"');
    expect(html).not.toMatch(/fieldset[^>]*disabled/);
  });

  test("with goal management off, the other groups stay visible but disabled, and the page says why", () => {
    const html = render(features({ outcomesEnabled: false }));
    expect(html).toContain('data-settings-anchor="goal-roles"');
    expect(html).toContain('data-settings-anchor="goal-schedule"');
    expect(html).toContain('data-goals-disabled="true"');
    expect(html).toMatch(/fieldset[^>]*disabled/);
    expect(html).toContain("Turn on goal management to change these settings.");
  });

  test("every scheduling policy field is listed with its unit, allowed range and initial value", () => {
    const html = render(features());
    for (const entry of schedule) {
      expect(html).toContain(`data-policy-key="${entry.key}"`);
      expect(html).toContain(`${entry.min}`);
      expect(html).toContain(`${entry.max}`);
      expect(html).toContain(`${entry.initial}`);
    }
  });

  // Specs/004.10 task 4.3 (requirement E2.4): the activity group appears by itself, drawn from the same metadata.
  test("the activity view group lists every activity policy field, each from the metadata", () => {
    const html = render(features());
    expect(activityFields.map((entry) => entry.key).sort()).toEqual([
      "activity.cardMaxItems", "activity.checkOverdueMinutes", "activity.recentCompletedHours",
    ]);
    for (const entry of activityFields) expect(html).toContain(`data-policy-key="${entry.key}"`);
    for (const entry of activityFields.filter((field) => field.type === "integer")) {
      expect(html).toContain(`${entry.min}`);
      expect(html).toContain(`${entry.max}`);
    }
  });

  test("a field with nothing stored offers no restore; a field with a stored value does", () => {
    const key = schedule[0]!.key;
    const plain = render(features());
    expect(plain).toMatch(new RegExp(`data-policy-key="${key}"[\\s\\S]*?data-can-restore="false"`));
    const custom = render(features({ taskPolicy: { [key]: schedule[0]!.max! } }));
    expect(custom).toMatch(new RegExp(`data-policy-key="${key}"[\\s\\S]*?data-can-restore="true"`));
  });

  test("the restore button is disabled until the owner has stored a value, and enabled after", () => {
    const key = schedule[0]!.key;
    const restoreButton = (html: string) => {
      const row = html.split('data-policy-key="').find((chunk) => chunk.startsWith(`${key}"`))!;
      return /<button[^>]*>Restore initial value<\/button>/.exec(row)![0];
    };
    expect(restoreButton(render(features()))).toMatch(/ disabled=""/);
    expect(restoreButton(render(features({ taskPolicy: { [key]: schedule[0]!.max! } })))).not.toMatch(/ disabled=""/);
  });

  test("every policy input is labelled for a screen reader and states its limits in words", () => {
    const html = render(features());
    for (const entry of schedule) expect(html).toMatch(new RegExp(`aria-label="[^"]+"[^>]*data-policy-input="${entry.key}"|data-policy-input="${entry.key}"[^>]*aria-label="[^"]+"`));
    expect(html).toMatch(/Allowed: /);
  });

  test("the page and its logic hold no policy number: units, ranges and initial values come from the metadata", () => {
    const root = resolve(import.meta.dir, "../src/renderer/components/outcomego/settings");
    const sources = ["goals-view.tsx", "goal-policy-fields.ts", "goal-policy-copy.ts"].map((file) => readFileSync(resolve(root, file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""));
    for (const entry of TASK_POLICY_FIELDS) {
      for (const number of [entry.min, entry.max, typeof entry.initial === "number" ? entry.initial : undefined]) {
        if (number === undefined || number < 100) continue; // small numbers such as 0 and 1 are not distinctive
        for (const source of sources) expect(source).not.toMatch(new RegExp(`(?<![\\w.])${number}(?![\\w])`));
      }
    }
  });
});
