import { describe, expect, test } from "bun:test";
import { TASK_POLICY_FIELDS } from "@outcomego/contracts/task-policy";
import { sourceTranslations, setCurrentLocale } from "../src/renderer/lib/i18n-catalog";
import { policyCopy, policyOptionLabel } from "../src/renderer/components/outcomego/settings/goal-policy-copy";

// Specs/004.10 task 2.9, requirement E3.5: every policy row has words, in both languages.
describe("policy copy", () => {
  test("every policy key has a title and a description, and they are different sentences", () => {
    for (const entry of TASK_POLICY_FIELDS) {
      const copy = policyCopy(entry.key);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.description.length).toBeGreaterThan(0);
      expect(copy.title).not.toBe(copy.description);
    }
  });

  test("no row shows a bare identifier: a title is never the metadata key", () => {
    for (const entry of TASK_POLICY_FIELDS) {
      const { title, description } = policyCopy(entry.key);
      expect(title).not.toContain(entry.key);
      expect(title).not.toMatch(/^[a-z]+\.[A-Za-z.]+$/);
      expect(description).not.toMatch(/^[a-z]+\.[A-Za-z.]+$/);
    }
  });

  test("every title and description is in the catalog with a translation that differs from the English", () => {
    const missing: string[] = [];
    for (const entry of TASK_POLICY_FIELDS) {
      const { title, description } = policyCopy(entry.key);
      for (const text of [title, description]) if (!sourceTranslations[text] || sourceTranslations[text] === text) missing.push(text);
    }
    expect(missing).toEqual([]);
  });

  test("an option's label exists for every option of every enum field, in the catalog", () => {
    for (const entry of TASK_POLICY_FIELDS.filter((field) => field.type === "enum")) {
      for (const option of entry.options!) {
        const label = policyOptionLabel(entry.key, option);
        expect(label.length).toBeGreaterThan(0);
        expect(sourceTranslations[label]).toBeDefined();
        expect(sourceTranslations[label]).not.toBe(label);
      }
    }
  });

  test("the copy follows the interface language", () => {
    const key = TASK_POLICY_FIELDS[0]!.key;
    setCurrentLocale("en-US");
    const english = policyCopy(key).title;
    setCurrentLocale("zh-CN");
    const chinese = policyCopy(key).title;
    setCurrentLocale("en-US");
    expect(chinese).not.toBe(english);
    expect(/[一-鿿]/.test(chinese)).toBe(true);
  });

  test("copy states no number of its own: a figure here would drift from the metadata", () => {
    for (const entry of TASK_POLICY_FIELDS) {
      setCurrentLocale("en-US");
      const { title, description } = policyCopy(entry.key);
      expect(`${title} ${description}`).not.toMatch(/\d/);
    }
  });
});
