import { beforeEach, expect, test } from "bun:test";
import { SERVER_UPDATE_STEPS, serverUpdateProgress } from "@aiteamos/contracts/server-updates";
import { setCurrentLocale, translate } from "../src/renderer/lib/i18n-catalog";
import {
  localizeDesktopUpdateMessage,
  localizeServerUpdateFailure,
  localizeServerUpdateMessage,
  localizeUpdateStep,
  localizedStillWorking,
} from "../src/renderer/lib/server-update-message";

beforeEach(() => setCurrentLocale("zh-CN"));

const VERSION = "0.1.0-beta.12";
const PREVIOUS = "0.1.0-beta.10";

// Every status line the server, its update agent, and the update worker are known to report.
const serverMessages: ReadonlyArray<readonly [string, string]> = [
  ["Updates this connected server", "用于更新当前连接的服务器"],
  [
    "Run aiteamos start on the server to enable updates from the app.",
    "请在服务器上运行 aiteamos start，以启用从应用内更新。",
  ],
  ["Waiting for the server updater to reconnect…", "正在等待服务器更新器重新连接…"],
  ["Update requested. Waiting for the server updater…", "已请求更新，正在等待服务器更新器…"],
  ["Choose a newer server release.", "请选择更新的服务器版本。"],
  ["Choose a newer stable server release.", "请选择更新的稳定版服务器版本。"],
  ["A server update is already in progress.", "服务器更新已在进行中。"],
  ["Only targetVersion is accepted.", "仅接受 targetVersion。"],
  ["Sign in to update this server.", "请登录后再更新此服务器。"],
  ["Starting the server updater…", "正在启动服务器更新器…"],
  ["The server updater stopped. Retry the update.", "服务器更新器已停止，请重试更新。"],
  ["The server requested an invalid update version.", "服务器请求了无效的更新版本。"],
  [
    "Update accepted; it will continue if this window closes",
    "已接受更新；关闭此窗口后更新仍会继续",
  ],
  ["Checking the latest aiTeamOS release", "正在检查最新的 aiTeamOS 版本"],
  [`Downloading and verifying aiTeamOS ${VERSION}`, `正在下载并校验 aiTeamOS ${VERSION}`],
  [`Pulling aiTeamOS ${VERSION} container images`, `正在拉取 aiTeamOS ${VERSION} 容器镜像`],
  [
    `Backing up the aiTeamOS database before ${VERSION}`,
    `正在备份更新前的 aiTeamOS 数据库（${VERSION}）`,
  ],
  ["Restarting the server, worker, and computer", "正在重启服务器、worker 和电脑"],
  [`aiTeamOS ${VERSION} passed its readiness checks`, `aiTeamOS ${VERSION} 已通过就绪检查`],
  [`Installing aiTeamOS ${VERSION} command-line tools`, `正在安装 aiTeamOS ${VERSION} 命令行工具`],
  [
    `aiTeamOS ${VERSION} and its command-line tools are up to date`,
    `aiTeamOS ${VERSION} 及其命令行工具均为最新版本`,
  ],
  [`aiTeamOS ${VERSION} is already installed`, `aiTeamOS ${VERSION} 已安装`],
  [
    `aiTeamOS and its command-line tools are now running ${VERSION}.`,
    `aiTeamOS 及其命令行工具现在运行 ${VERSION}。`,
  ],
  [`aiTeamOS is now running ${VERSION}.`, `aiTeamOS 现在运行 ${VERSION}。`],
  [`Updating aiTeamOS ${PREVIOUS} → ${VERSION}…`, `正在更新 aiTeamOS ${PREVIOUS} → ${VERSION}…`],
  [
    "The update failed; restoring the previous aiTeamOS configuration",
    "更新失败；正在恢复之前的 aiTeamOS 配置",
  ],
  [
    `Refusing prerelease ${VERSION} on the stable channel. Use --allow-prerelease to opt in.`,
    `稳定通道不接受预发布版本 ${VERSION}。如需使用，请添加 --allow-prerelease。`,
  ],
  [
    `Refusing to downgrade aiTeamOS ${VERSION} to ${PREVIOUS}. Use --allow-downgrade only for an intentional recovery.`,
    `拒绝将 aiTeamOS 从 ${VERSION} 降级到 ${PREVIOUS}。仅在有意恢复时才使用 --allow-downgrade。`,
  ],
  [
    "Update failed and the previous Compose configuration was restored; the running services were never stopped: compose exited 1",
    "更新失败，已恢复之前的 Compose 配置；正在运行的服务从未被停止：compose exited 1",
  ],
  [
    "Update failed and the previous Compose configuration was restored and restarted: compose exited 1",
    "更新失败，已恢复之前的 Compose 配置并重启服务：compose exited 1",
  ],
  [
    "Update failed and the previous Compose configuration was restored, but it could not be restarted: compose exited 1",
    "更新失败，已恢复之前的 Compose 配置，但无法重启服务：compose exited 1",
  ],
  [
    "Orion is still working. Nothing changed; try again when it's done.",
    "Orion 仍在工作，未做任何更改；请等其完成后再试。",
  ],
  [
    "Scout, Orion and Nova are still working. Nothing changed; try again when they're done.",
    "Scout、Orion 和 Nova 仍在工作，未做任何更改；请等它们完成后再试。",
  ],
];

test("translates every status line the update pipeline reports", () => {
  for (const [english, chinese] of serverMessages) {
    expect(localizeServerUpdateMessage(english)).toBe(chinese);
  }
});

test("keeps text it cannot translate instead of hiding the failure detail", () => {
  const unknown = "Container runtime reported an unexpected state";
  expect(localizeServerUpdateMessage(unknown)).toBe(unknown);
  expect(localizeServerUpdateMessage(null)).toBeNull();
  expect(localizeServerUpdateMessage("   ")).toBeNull();
});

test("localizes the failure of a refused request and keeps unknown causes", () => {
  const refused = new Error(
    "Refusing prerelease 0.1.0-beta.12 on the stable channel. Use --allow-prerelease to opt in."
  );
  expect(localizeServerUpdateFailure(refused, "服务器更新失败，请重试。")).toBe(
    "稳定通道不接受预发布版本 0.1.0-beta.12。如需使用，请添加 --allow-prerelease。"
  );
  expect(
    localizeServerUpdateFailure(new Error("compose exited 1"), "服务器更新失败，请重试。")
  ).toBe("compose exited 1");
  expect(localizeServerUpdateFailure(null, "服务器更新失败，请重试。")).toBe(
    "服务器更新失败，请重试。"
  );
  expect(localizeServerUpdateFailure(new Error("   "), "服务器更新失败，请重试。")).toBe(
    "服务器更新失败，请重试。"
  );
});

test("names the bots that keep an update waiting inside the interface language", () => {
  expect(localizedStillWorking(["Scout"])).toBe("Scout 仍在工作");
  expect(localizedStillWorking(["Scout", "Orion"])).toBe("Scout 和 Orion 仍在工作");
  expect(localizedStillWorking(["Scout", "Orion", "Nova"])).toBe("Scout、Orion 和 Nova 仍在工作");
  expect(localizedStillWorking(["", " "])).toBe("智能体 仍在工作");
});

test("translates every update milestone so the progress panel never falls back to English", () => {
  const steps = Object.fromEntries(
    SERVER_UPDATE_STEPS.map((step) => [step, localizeUpdateStep(step)])
  );
  expect(steps).toEqual({
    Prepare: "准备更新",
    Download: "下载更新",
    "Back up": "备份数据",
    Restart: "重启服务",
    Verify: "校验更新",
  });
  const phases = [
    null,
    "queued",
    "checking",
    "downloading",
    "pulling",
    "backing-up",
    "restarting",
    "verifying",
    "updating-cli",
    "complete",
    "rolling-back",
    "future-phase",
  ];
  for (const phase of phases) {
    const title = serverUpdateProgress(phase).title;
    expect(translate("zh-CN", title)).not.toBe(title);
  }
});

test("translates the desktop updater's own status text", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["You’re up to date", "已是最新版本"],
    ["No published desktop release is available yet.", "尚未发布可用的桌面端版本。"],
    ["Restart aiTeamOS to finish installing the update", "重启 aiTeamOS 以完成更新安装"],
    ["Downloading 42%", "正在下载 42%"],
    [
      "Desktop 0.0.12 is available. This copy can’t update itself, so download the new version to replace it.",
      "桌面端 0.0.12 可用。当前版本无法自行更新，请下载新版本进行替换。",
    ],
    ["The desktop update service is unavailable", "桌面端更新服务不可用"],
    ["The desktop update service did not return a result", "桌面端更新服务未返回结果"],
    ["Update service returned 503", "更新服务返回 503"],
    ["Update service returned a malformed release manifest", "更新服务返回了格式错误的发布清单"],
    ["Update service returned an invalid release version", "更新服务返回了无效的发布版本"],
  ];
  for (const [english, chinese] of cases) {
    expect(localizeDesktopUpdateMessage(english)).toBe(chinese);
  }
  expect(localizeDesktopUpdateMessage("Release feed unavailable")).toBe("Release feed unavailable");
  expect(localizeDesktopUpdateMessage(null)).toBeNull();
});

test("keeps the English source for the default locale", () => {
  setCurrentLocale("en-US");
  expect(localizeServerUpdateMessage("Checking the latest aiTeamOS release")).toBe(
    "Checking the latest aiTeamOS release"
  );
  expect(localizeServerUpdateMessage(`Pulling aiTeamOS ${VERSION} container images`)).toBe(
    `Pulling aiTeamOS ${VERSION} container images`
  );
  expect(localizedStillWorking(["Scout", "Orion"])).toBe("Scout and Orion are still working");
  expect(localizeDesktopUpdateMessage("Downloading 42%")).toBe("Downloading 42%");
});
