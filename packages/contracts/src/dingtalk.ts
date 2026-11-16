/** DWS credentials and subprocesses belong to the Bot Computer, never the web client. */
export type DingTalkAction = "install" | "upgrade" | "authenticate" | "cancel" | "respond";
export interface DingTalkOrganizationAccessIssue {
  code: "cli_access_required";
  documentationUrl: string;
}
export interface DingTalkOperation {
  id: string;
  kind: "install" | "upgrade" | "authenticate";
  status: "running" | "succeeded" | "failed" | "cancelled";
  authorization?: { url: string; userCode?: string; stage: "device" | "pat" };
  prompt?: {
    id: string;
    kind: "scope" | "domains";
    options: Array<{ value: string; label: string; selected?: boolean }>;
  };
  error?: string;
  organizationAccess?: DingTalkOrganizationAccessIssue;
}
export interface DingTalkStatus {
  computer: "bot";
  installed: boolean;
  version: string | null;
  connection: "connected" | "disconnected" | "unknown";
  latestVersion: string | null;
  updateAvailable: boolean;
  updateCheck: "current" | "available" | "unavailable";
  account?: { userName: string; corpName: string };
  operation?: DingTalkOperation;
  error?: string;
  updateError?: string;
}
export interface DingTalkActionInput {
  action: DingTalkAction;
  operationId?: string;
  promptId?: string;
  values?: string[];
}
