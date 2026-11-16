import { expect, test } from "bun:test";
import {
  authorizationFromOutput,
  isDingTalkCliAccessDenied,
  promptFromOutput,
  updateStatusFromOutput,
} from "../src/dingtalk";

test("DingTalk setup projects only official browser authorization URLs", () => {
  const device = authorizationFromOutput(
    "授权链接：https://login.dingtalk.com/oauth2/device/verify.htm?caller=dws&user_code=ABCD-1234"
  );
  expect(device).toEqual({
    url: "https://login.dingtalk.com/oauth2/device/verify.htm?caller=dws&user_code=ABCD-1234",
    userCode: "ABCD-1234",
    stage: "device",
  });
  expect(
    authorizationFromOutput("https://evil.example/oauth2/device/verify.htm?user_code=ABCD-1234")
  ).toBeUndefined();
});

test("DingTalk setup parses interactive scope and domain prompts", () => {
  const scope = promptFromOutput("1. 推荐授权\n2. 全部授权\nEnter a number between 1 and 2:");
  expect(scope?.kind).toBe("scope");
  expect(scope?.options.map((option) => option.value)).toEqual(["1", "2"]);

  const domains = promptFromOutput(
    "1. ✓ chat 会话与群聊\n4. ✓ doc 文档\n0. Confirm selection\nEnter a number between 0 and 19:"
  );
  expect(domains?.kind).toBe("domains");
  expect(domains?.options).toEqual([
    { value: "1", label: "chat 会话与群聊", selected: true },
    { value: "4", label: "doc 文档", selected: true },
  ]);
});

test("DingTalk setup parses the explicit online DWS update check", () => {
  expect(updateStatusFromOutput(JSON.stringify({
    current_version: "v1.0.68",
    latest_version: "v1.0.69",
    needs_upgrade: true,
  }))).toEqual({
    latestVersion: "v1.0.69",
    updateAvailable: true,
    updateCheck: "available",
  });
  expect(updateStatusFromOutput(JSON.stringify({
    current_version: "v1.0.68",
    latest_version: "v1.0.68",
    needs_upgrade: false,
  }))).toEqual({
    latestVersion: "v1.0.68",
    updateAvailable: false,
    updateCheck: "current",
  });
  expect(updateStatusFromOutput("network failure")).toBeUndefined();
});

test("DingTalk setup recognizes the enterprise CLI permission denial", () => {
  expect(isDingTalkCliAccessDenied("当前组织未授权您通过 CLI 访问个人数据。")).toBe(true);
  expect(isDingTalkCliAccessDenied("reason=cli_not_enabled")).toBe(true);
  expect(isDingTalkCliAccessDenied("The user is not logged in.")).toBe(false);
});
