import { expect, test } from "bun:test";
import type { RichMessageWidget } from "@outcomego/contracts";
import { resolvedWidgetAnswers } from "@outcomego/product-core/rich-messages";
import { localizeComputerNetworkPolicyCard } from "../src/renderer/lib/computer-network-policy-card";

const rules = "- 10.255.0.75:80 (Unraid 管理界面 HTTP)\n- [fd75::2]:443 (Verify policy)";
const card = (verification: boolean, mode = "allowlist"): RichMessageWidget => ({
  prompt: verification
    ? `Verify this exact cloud computer firewall policy in ${mode} mode.`
    : `Approve this cloud computer firewall change to ${mode} mode?`,
  helpText: `${mode === "lan" ? "LAN access permits all private TCP destinations." : "Only the listed private TCP destinations, model endpoints, and system management exceptions remain reachable."} Public traffic continues through the managed exit. Revision 3; expires at 2026-11-16T08:37:10.297Z. ${verification ? "Verification does not apply the policy; a separate approval card follows." : "Approval authorizes only this exact policy. Existing connections may be interrupted."} Rules:\n${rules}`,
  options: verification
    ? [{ label: "Verify policy", value: "verify" }, { label: "Cancel", value: "deny" }]
    : [{ label: "Approve firewall change", value: "approve", style: "danger" }, { label: "Deny", value: "deny" }],
});

test("the existing verification card displays Chinese while preserving its rules and answers", () => {
  const original = card(true);
  const localized = localizeComputerNetworkPolicyCard(original, "zh-CN");
  expect(localized.prompt).toBe("请核验此云端电脑防火墙策略，模式为“允许列表”。");
  expect(localized.helpText).toContain("公网流量继续通过托管出口。");
  expect(localized.helpText).toContain("策略修订版本：3；有效期至");
  expect(localized.helpText).toContain("核验不会应用策略；核验后还需通过单独的授权卡片批准。");
  expect(localized.helpText).toEndWith(rules);
  expect(localized.options).toEqual([{ label: "核验策略", value: "verify" }, { label: "取消", value: "deny" }]);
  expect(original.options[0]!.label).toBe("Verify policy");
  expect(resolvedWidgetAnswers(localized, "verify")[0]!.label).toBe("核验策略");
});

test("the final LAN approval card translates the impact, warning, and buttons", () => {
  const localized = localizeComputerNetworkPolicyCard(card(false, "lan"), "zh-CN");
  expect(localized.prompt).toBe("是否批准将云端电脑防火墙策略更改为“局域网访问”模式？");
  expect(localized.helpText).toContain("局域网访问模式允许访问所有私有网络 TCP 目标。");
  expect(localized.helpText).toContain("此次批准仅授权应用当前展示的策略，已有连接可能会中断。");
  expect(localized.options).toEqual([
    { label: "批准防火墙变更", value: "approve", style: "danger" },
    { label: "拒绝", value: "deny" },
  ]);
});

test("English cards and unrelated bot questions retain their original text", () => {
  const original = card(true);
  expect(localizeComputerNetworkPolicyCard(original, "en-US")).toBe(original);
  const question = { prompt: "Verify policy", helpText: "Some user text", options: [{ label: "Cancel" }] };
  expect(localizeComputerNetworkPolicyCard(question, "zh-CN")).toBe(question);
  const unknownDetails = { ...original, helpText: "Unexpected server detail" };
  expect(localizeComputerNetworkPolicyCard(unknownDetails, "zh-CN").helpText).toBe("Unexpected server detail");
});

test("an empty rule list is translated without changing implicit answer values", () => {
  const original = card(false);
  original.helpText = original.helpText!.replace(rules, "- none");
  original.options = [{ label: "Deny" }];
  const localized = localizeComputerNetworkPolicyCard(original, "zh-CN");
  expect(localized.helpText).toEndWith("TCP 规则：\n无手动 TCP 规则。");
  expect(localized.options).toEqual([{ label: "拒绝", value: "Deny" }]);
});
