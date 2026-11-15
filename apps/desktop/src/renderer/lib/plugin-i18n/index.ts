import type {
  PluginCatalogConnectionView,
  PluginCatalogItemView,
  PluginCatalogSkillView,
  PluginConnectionView,
} from "@outcomego/contracts";
import type { Locale } from "@outcomego/contracts/localization";
import type { PluginField, PluginSetup } from "@outcomego/plugin-sdk";
import { pluginTranslations } from "@outcomego/plugins/translations";

type Translate = (key: string) => string;

export const translatePluginText = (
  pluginKey: string,
  locale: Locale,
  value: string,
  t: Translate
): string =>
  locale === "zh-CN" ? pluginTranslations[pluginKey]?.[value] ?? t(value) : t(value);

export const localizePluginField = (
  pluginKey: string,
  locale: Locale,
  field: PluginField,
  t: Translate
): PluginField => ({
  ...field,
  label: translatePluginText(pluginKey, locale, field.label, t),
  placeholder: field.placeholder
    ? translatePluginText(pluginKey, locale, field.placeholder, t)
    : field.placeholder,
  helpText: field.helpText
    ? translatePluginText(pluginKey, locale, field.helpText, t)
    : field.helpText,
});

export const localizePluginSetup = (
  pluginKey: string,
  locale: Locale,
  setup: PluginSetup | null | undefined,
  t: Translate
): PluginSetup | null | undefined =>
  setup
    ? {
        ...setup,
        title: translatePluginText(pluginKey, locale, setup.title, t),
        description: translatePluginText(pluginKey, locale, setup.description, t),
        steps: setup.steps.map((step) => translatePluginText(pluginKey, locale, step, t)),
        fields: setup.fields.map((field) => localizePluginField(pluginKey, locale, field, t)),
      }
    : setup;

export const localizePlugin = (
  plugin: PluginCatalogItemView,
  locale: Locale,
  t: Translate
): PluginCatalogItemView => {
  const text = (value: string) => translatePluginText(plugin.key, locale, value, t);
  return {
    ...plugin,
    name: text(plugin.name),
    description: text(plugin.description),
    // Category values are stable filter keys; the marketplace translates their labels
    // at render time so filtering remains locale-independent.
    category: plugin.category,
    installationSteps: plugin.installationSteps?.map(text),
    setupFields: plugin.setupFields.map((field) =>
      localizePluginField(plugin.key, locale, field, t)
    ),
    setup: localizePluginSetup(plugin.key, locale, plugin.setup, t) ?? null,
    connections: plugin.connections.map((connection: PluginCatalogConnectionView) => ({
      ...connection,
      name: text(connection.name),
      tools: connection.tools.map((tool) => ({
        ...tool,
        name: text(tool.name),
        description: text(tool.description),
      })),
    })),
    skills: plugin.skills.map((skill: PluginCatalogSkillView) => ({
      ...skill,
      name: text(skill.name),
      description: text(skill.description),
    })),
  };
};

export const localizePluginConnection = (
  connection: PluginConnectionView,
  locale: Locale,
  t: Translate
): PluginConnectionView => {
  const text = (value: string) => translatePluginText(connection.pluginKey, locale, value, t);
  return {
    ...connection,
    name: text(connection.name),
    tools: connection.tools.map((tool) => ({
      ...tool,
      name: text(tool.name),
      description: text(tool.description),
    })),
    deviceLink: connection.deviceLink
      ? {
          ...connection.deviceLink,
          instructions: text(connection.deviceLink.instructions),
        }
      : connection.deviceLink,
  };
};
