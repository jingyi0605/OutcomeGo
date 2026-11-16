import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { PluginCatalogItemView, PluginConnectionView, PluginSettingsView } from "@outcomego/contracts";
import { pluginCatalog } from "@outcomego/plugins";

const mockStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
(globalThis as any).localStorage ??= mockStorage;
(globalThis as any).window ??= {
  location: { href: "http://127.0.0.1/" },
  localStorage: mockStorage,
  navigator: { language: "zh-CN" },
};
(globalThis as any).window.localStorage ??= mockStorage;
(globalThis as any).window.navigator ??= { language: "zh-CN" };

const { PluginDetail } = await import("../src/renderer/components/outcomego/plugin-detail-view");
const { InstalledPluginsView } = await import("../src/renderer/components/outcomego/plugins/marketplace-browse");
const { I18nProvider } = await import("../src/renderer/lib/i18n");

const bitwardenCatalog = pluginCatalog.find((entry) => entry.key === "bitwarden")!;

const bitwardenPlugin: PluginCatalogItemView = {
  key: bitwardenCatalog.key,
  version: bitwardenCatalog.version,
  name: bitwardenCatalog.name,
  description: bitwardenCatalog.description,
  publisher: bitwardenCatalog.publisher,
  category: bitwardenCatalog.category,
  featured: bitwardenCatalog.featured,
  installed: true,
  components: bitwardenCatalog.components,
  connections: bitwardenCatalog.connections.map((c) => ({
    key: c.key,
    name: c.name,
    transport: c.transport,
    auth: c.auth,
    tools: [],
  })),
  skills: bitwardenCatalog.skills.map(({ name, description }) => ({ name, description })),
  homepageUrl: bitwardenCatalog.homepageUrl ?? null,
  sourceUrl: null,
  sourceRevision: null,
  logoUrl: null,
  installationSteps: bitwardenCatalog.installationSteps,
  setupFields: bitwardenCatalog.setupFields ?? [],
  setup: bitwardenCatalog.setup ?? null,
};

const makeConnection = (
  id: string,
  alias: string,
  status: PluginConnectionView["status"] = "ready"
): PluginConnectionView => ({
  id,
  revision: "rev-1",
  pluginKey: "bitwarden",
  connectorKey: "bitwarden",
  name: "Bitwarden / Vaultwarden",
  alias,
  transport: "builtin",
  auth: "none",
  status,
  statusMessage: null,
  instructions: "",
  authorizationUrl: null,
  oauthRedirectUrl: null,
  setupPhase: status === "ready" ? "connected" : "provider_setup_required",
  canAuthenticate: false,
  configured: status === "ready",
  command: null,
  tools: [],
});

test("Bitwarden detail renders multiple instances, Chinese skill count, and Connected status", () => {
  const connections = [
    makeConnection("conn-1", "alice@example.com", "ready"),
    makeConnection("conn-2", "bob@vault.test", "disconnected"),
  ];
  const data: PluginSettingsView = {
    catalog: [bitwardenPlugin],
    installs: [
      {
        id: "inst-1",
        pluginKey: "bitwarden",
        version: bitwardenPlugin.version,
        name: bitwardenPlugin.name,
        description: bitwardenPlugin.description,
        publisher: bitwardenPlugin.publisher,
        status: "installed",
        installedAt: "2026-11-16T12:00:00.000Z",
        hasSkills: true,
        configuredEnvironment: [],
        connections,
      },
    ],
    botCount: 1,
    activity: [],
  };

  const detailMarkup = renderToStaticMarkup(
    <I18nProvider locale="zh-CN" setLocale={() => {}}>
      <PluginDetail
        busy={null}
        data={data}
        plugin={bitwardenPlugin}
        onAddAccount={async () => true}
        onAuthenticate={() => {}}
        onCancelAuthentication={() => {}}
        onConfigureToken={() => {}}
        onConfigureOAuth={() => {}}
        onConfigureValues={() => {}}
        onInstructions={() => {}}
        onInstall={() => {}}
        onRemoveAccount={() => {}}
        onRename={async () => true}
        onRemove={() => {}}
        onRestart={() => {}}
        onToggle={() => {}}
      />
    </I18nProvider>
  );

  expect(detailMarkup).toContain("alice@example.com");
  expect(detailMarkup).toContain("bob@vault.test");
  expect(detailMarkup).toContain("已连接。");
  expect(detailMarkup).toContain("1 个技能");
  expect(detailMarkup).not.toContain("1 个事件");
  expect(detailMarkup).toContain("服务器地址");
  expect(detailMarkup).toContain("账户邮箱");
  expect(detailMarkup).toContain("个人 API 客户端 ID");
  expect(detailMarkup).toContain("个人 API 客户端密钥");
  expect(detailMarkup).toContain("主密码");

  const readyData: PluginSettingsView = {
    ...data,
    installs: [
      {
        ...data.installs[0]!,
        connections: [makeConnection("conn-1", "alice@example.com", "ready")],
      },
    ],
  };

  const listMarkup = renderToStaticMarkup(
    <I18nProvider locale="zh-CN" setLocale={() => {}}>
      <InstalledPluginsView
        query=""
        onQueryChange={() => {}}
        data={readyData}
        busy={null}
        onOpen={() => {}}
        onManage={() => {}}
        onRetry={() => {}}
        catalogFallback={() => bitwardenPlugin}
      />
    </I18nProvider>
  );
  expect(listMarkup).toContain("Bitwarden / Vaultwarden");
  expect(listMarkup).toContain("已连接。");
});
