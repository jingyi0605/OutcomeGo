export const COMPUTER_NETWORK_POLICY_MODES = ["lan", "allowlist"] as const;
export type ComputerNetworkPolicyMode = (typeof COMPUTER_NETWORK_POLICY_MODES)[number];

export interface ComputerNetworkPolicyRule {
  id: string;
  address: string;
  port: number;
  label: string | null;
}

export type ComputerNetworkPolicyRuntimeState =
  | "unknown"
  | "pending"
  | "applying"
  | "applied"
  | "error";

export interface ComputerNetworkPolicyRuntime {
  state: ComputerNetworkPolicyRuntimeState;
  appliedRevision: number | null;
  modelEndpointCount: number;
  error: string | null;
}

export interface ComputerNetworkPolicyView {
  policy: {
    mode: ComputerNetworkPolicyMode;
    rules: ComputerNetworkPolicyRule[];
    revision: number;
    updatedAt: string;
  };
  runtime: ComputerNetworkPolicyRuntime;
}

export interface ComputerNetworkPolicyUpdate {
  expectedRevision: number;
  mode: ComputerNetworkPolicyMode;
  rules: ComputerNetworkPolicyRule[];
}

export interface ComputerNetworkPolicySnapshot {
  mode: ComputerNetworkPolicyMode;
  rules: ComputerNetworkPolicyRule[];
  revision: number;
}

export interface ComputerNetworkPolicyStatus {
  state: Exclude<ComputerNetworkPolicyRuntimeState, "unknown">;
  appliedRevision: number | null;
  modelEndpointCount: number;
  error: string | null;
}
