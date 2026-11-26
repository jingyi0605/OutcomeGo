import { CliError } from "./errors";
import { normalizeLocale, type Locale } from "@outcomego/contracts/localization";
import { cliTranslate } from "./localization";

export type CommandName =
  | "tailscale-enable"
  | "tailscale-status"
  | "tailscale-disable"
  | "install"
  | "bootstrap"
  | "setup"
  | "doctor"
  | "status"
  | "engine-status"
  | "engine-start"
  | "engine-stop"
  | "engine-upgrade"
  | "engine-rollback"
  | "engine-remove"
  | "engine-docker"
  | "engine-enable-wsl"
  | "resources-status"
  | "resources-set"
  | "containers"
  | "restart"
  | "autostart-status"
  | "autostart-set"
  | "proxy-status"
  | "proxy-set"
  | "proxy-test"
  | "update"
  | "stop"
  | "start"
  | "logs"
  | "provider-list"
  | "provider-login"
  | "provider-logout"
  | "provider-add"
  | "provider-remove"
  | "model"
  | "model-list"
  | "model-use"
  | "account-update"
  | "notifications-configure"
  | "notifications-status"
  | "uninstall";

export type HelpTopic =
  | "global"
  | CommandName
  | "autostart"
  | "proxy"
  | "provider"
  | "model"
  | "account"
  | "notifications"
  | "tailscale";

export interface CliOptions {
  command: CommandName | "help" | "version";
  helpTopic?: HelpTopic;
  directory?: string;
  language?: Locale;
  version?: string;
  repository?: string;
  composeUrl?: string;
  checksumUrl?: string;
  signatureUrl?: string;
  projectName?: string;
  imagePrefix?: string;
  yes: boolean;
  purge: boolean;
  force: boolean;
  allowDowngrade: boolean;
  allowPrerelease: boolean;
  allowUnsigned: boolean;
  advanced: boolean;
  noSetup: boolean;
  follow: boolean;
  tail?: string;
  service?: string;
  jsonProgress: boolean;
  whenIdle: boolean;
  username?: string;
  password: boolean;
  providerId?: string;
  modelId?: string;
  authType?: string;
  providerName?: string;
  baseUrl?: string;
  apiProtocol?: string;
  thinking?: string;
  contextWindow?: string;
  maxTokens?: string;
  reasoning?: boolean;
  noAuth?: boolean;
  json?: boolean;
  stats?: boolean;
  enabled?: boolean;
  configStdin?: boolean;
  httpsPort?: string;
  apnsConfig?: string;
  apnsKeyFile?: string;
  apnsKeyId?: string;
  apnsTeamId?: string;
  apnsTopic?: string;
  computerMemory?: string;
  desktopMemory?: string;
  computerCpu?: string;
  workerConcurrency?: string;
  engineMemory?: string;
  engineCpu?: string;
  applyWslconfig?: boolean;
  restartWsl?: boolean;
  engine?: string;
  apiPort?: string;
  acceptLowMemory?: boolean;
  dockerArgs?: string[];
}

const engineActions = ["status", "start", "stop", "upgrade", "rollback", "remove", "docker", "enable-wsl"] as const;

const commands = new Set<CommandName>([
  "tailscale-enable",
  "tailscale-status",
  "tailscale-disable",
  "install",
  "bootstrap",
  "setup",
  "doctor",
  "status",
  "engine-status",
  "engine-start", "engine-stop", "engine-remove", "engine-docker", "engine-enable-wsl",
  "engine-upgrade", "engine-rollback",
  "resources-status",
  "resources-set",
  "containers",
  "restart",
  "autostart-status",
  "autostart-set",
  "proxy-status",
  "proxy-set",
  "proxy-test",
  "update",
  "stop",
  "start",
  "logs",
  "provider-list",
  "provider-login",
  "provider-logout",
  "provider-add",
  "provider-remove",
  "model",
  "model-list",
  "model-use",
  "account-update",
  "notifications-configure",
  "notifications-status",
  "uninstall",
]);

const commandFlags: Record<CommandName, ReadonlySet<string>> = {
  "tailscale-enable": new Set(["--https-port", "--json"]),
  "tailscale-status": new Set(["--json"]),
  "tailscale-disable": new Set(["--json"]),
  install: new Set([
    "--version",
    "--repository",
    "--compose-url",
    "--checksum-url",
    "--signature-url",
    "--project-name",
    "--image-prefix",
    "--allow-prerelease",
    "--allow-unsigned",
    "--advanced",
    "--no-setup",
  ]),
  setup: new Set(["--advanced"]),
  bootstrap: new Set(["--json-progress", "--engine", "--api-port", "--version", "--accept-low-memory"]),
  doctor: new Set(["--project-name"]),
  status: new Set(["--json-progress", "--json"]),
  "engine-status": new Set(["--json", "--engine"]),
  "engine-start": new Set(),
  "engine-stop": new Set(),
  "engine-upgrade": new Set(["--version", "--yes"]),
  "engine-rollback": new Set(["--yes"]),
  "engine-remove": new Set(["--purge-data"]),
  "engine-docker": new Set(),
  "engine-enable-wsl": new Set(["--yes"]),
  "resources-status": new Set(["--json"]),
  "resources-set": new Set([
    "--computer-memory",
    "--desktop-memory",
    "--computer-cpu",
    "--worker-concurrency",
    "--engine-memory",
    "--engine-cpu",
    "--apply-wslconfig",
    "--restart-wsl",
    "--json",
    "--yes",
    "-y",
  ]),
  containers: new Set(["--json", "--stats"]),
  restart: new Set(["--json", "--yes", "-y"]),
  "autostart-status": new Set(["--json"]),
  "autostart-set": new Set(["--enabled", "--json"]),
  "proxy-status": new Set(["--json"]),
  "proxy-set": new Set(["--config-stdin", "--yes", "-y", "--json"]),
  "proxy-test": new Set(["--config-stdin", "--json"]),
  update: new Set([
    "--version",
    "--repository",
    "--compose-url",
    "--checksum-url",
    "--signature-url",
    "--force",
    "--allow-downgrade",
    "--allow-prerelease",
    "--allow-unsigned",
    "--json-progress",
    "--when-idle",
  ]),
  stop: new Set(),
  start: new Set(),
  logs: new Set(["--follow", "-f", "--tail", "--service", "--json"]),
  "provider-list": new Set(),
  "provider-login": new Set(["--auth"]),
  "provider-logout": new Set(),
  "provider-add": new Set([
    "--name",
    "--base-url",
    "--api",
    "--model",
    "--context-window",
    "--max-tokens",
    "--reasoning",
    "--no-auth",
  ]),
  "provider-remove": new Set(),
  model: new Set(),
  "model-list": new Set(),
  "model-use": new Set(["--thinking"]),
  "account-update": new Set(["--username", "--password"]),
  "notifications-configure": new Set([
    "--config",
    "--key-file",
    "--key-id",
    "--team-id",
    "--topic",
  ]),
  "notifications-status": new Set(),
  uninstall: new Set(["--yes", "-y", "--purge"]),
};

const commonFlags = new Set(["--dir", "--language"]);

const commandLabel = (command: CommandName): string => command.replace("-", " ");

const closest = (value: string, choices: readonly string[]): string | null => {
  const distance = (left: string, right: string): number => {
    const row = Array.from({ length: right.length + 1 }, (_item, index) => index);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
      let diagonal = row[0] ?? 0;
      row[0] = leftIndex;
      for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
        const above = row[rightIndex] ?? 0;
        row[rightIndex] = Math.min(
          above + 1,
          (row[rightIndex - 1] ?? 0) + 1,
          diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
        );
        diagonal = above;
      }
    }
    return row[right.length] ?? Number.POSITIVE_INFINITY;
  };
  const ranked = choices
    .map((choice) => ({ choice, distance: distance(value, choice) }))
    .sort((left, right) => left.distance - right.distance);
  const match = ranked[0];
  return match && match.distance <= Math.max(2, Math.floor(value.length / 3)) ? match.choice : null;
};

const emptyOptions = (command: CliOptions["command"], helpTopic?: HelpTopic): CliOptions => ({
  command,
  ...(helpTopic ? { helpTopic } : {}),
  yes: false,
  purge: false,
  force: false,
  allowDowngrade: false,
  allowPrerelease: false,
  allowUnsigned: false,
  advanced: false,
  noSetup: false,
  follow: false,
  jsonProgress: false,
  whenIdle: false,
  password: false,
});

const helpTopicFromArguments = (parts: readonly string[]): HelpTopic => {
  const [rawTopic, action, ...extra] = parts;
  const topic = rawTopic === "health" ? "status" : rawTopic;
  if (!topic || topic === "--help" || topic === "-h") return "global";
  if (extra.length > 0) throw new CliError(`Unknown help topic: ${parts.join(" ")}`);
  if (topic === "engine" && (!action || engineActions.some(value => value === action))) return `engine-${action ?? "status"}` as HelpTopic;
  if (topic === "resources" && (!action || action === "set" || action === "status")) {
    return `resources-${action ?? "set"}` as HelpTopic;
  }
  if (topic === "autostart") {
    if (!action) return "autostart";
    if (["status", "set"].includes(action)) return `autostart-${action}` as HelpTopic;
  }
  if (topic === "proxy") {
    if (!action) return "proxy";
    if (["status", "set", "test"].includes(action)) return `proxy-${action}` as HelpTopic;
  }
  if (topic === "tailscale") {
    if (!action) return "tailscale";
    if (["enable", "status", "disable"].includes(action)) return `tailscale-${action}` as HelpTopic;
  } else if (topic === "notifications") {
    if (!action) return "notifications";
    if (["configure", "status"].includes(action)) return `notifications-${action}` as HelpTopic;
  } else if (topic === "provider") {
    if (!action) return "provider";
    if (["list", "login", "logout", "add", "remove"].includes(action)) {
      return `provider-${action}` as HelpTopic;
    }
  } else if (topic === "model") {
    if (!action) return "model";
    if (["list", "use"].includes(action)) return `model-${action}` as HelpTopic;
  } else if (topic === "account") {
    if (!action) return "account";
    if (action === "update") return "account-update";
  } else if (!action && commands.has(topic as CommandName) && !topic.includes("-")) {
    return topic as CommandName;
  }
  throw new CliError(`Unknown help topic: ${parts.join(" ")}`);
};

const valueFlags = new Map<
  string,
  | "directory"
  | "language"
  | "version"
  | "repository"
  | "composeUrl"
  | "checksumUrl"
  | "signatureUrl"
  | "projectName"
  | "imagePrefix"
  | "username"
  | "tail"
  | "service"
  | "authType"
  | "providerName"
  | "baseUrl"
  | "apiProtocol"
  | "modelId"
  | "thinking"
  | "contextWindow"
  | "maxTokens"
  | "httpsPort"
  | "apnsConfig"
  | "apnsKeyFile"
  | "apnsKeyId"
  | "apnsTeamId"
  | "apnsTopic"
  | "computerMemory"
  | "desktopMemory"
  | "computerCpu"
  | "workerConcurrency"
  | "engineMemory"
  | "engineCpu"
  | "engine"
  | "apiPort"
>([
  ["--engine", "engine"],
  ["--api-port", "apiPort"],
  ["--computer-memory", "computerMemory"],
  ["--desktop-memory", "desktopMemory"],
  ["--computer-cpu", "computerCpu"],
  ["--worker-concurrency", "workerConcurrency"],
  ["--engine-memory", "engineMemory"],
  ["--engine-cpu", "engineCpu"],
  ["--https-port", "httpsPort"],
  ["--config", "apnsConfig"],
  ["--key-file", "apnsKeyFile"],
  ["--key-id", "apnsKeyId"],
  ["--team-id", "apnsTeamId"],
  ["--topic", "apnsTopic"],
  ["--dir", "directory"],
  ["--language", "language"],
  ["--version", "version"],
  ["--repository", "repository"],
  ["--compose-url", "composeUrl"],
  ["--checksum-url", "checksumUrl"],
  ["--signature-url", "signatureUrl"],
  ["--project-name", "projectName"],
  ["--image-prefix", "imagePrefix"],
  ["--username", "username"],
  ["--tail", "tail"],
  ["--service", "service"],
  ["--auth", "authType"],
  ["--name", "providerName"],
  ["--base-url", "baseUrl"],
  ["--api", "apiProtocol"],
  ["--model", "modelId"],
  ["--thinking", "thinking"],
  ["--context-window", "contextWindow"],
  ["--max-tokens", "maxTokens"],
] as const);

export const parseArguments = (argv: readonly string[]): CliOptions => {
  const [rawCommand, ...rawRest] = argv;
  if (!rawCommand || ["--help", "-h"].includes(rawCommand)) return emptyOptions("help", "global");
  if (rawCommand === "help") return emptyOptions("help", helpTopicFromArguments(rawRest));
  if (["version", "--version", "-v"].includes(rawCommand)) {
    return emptyOptions("version");
  }
  const nestedEngine = rawCommand === "engine";
  const nestedResources = rawCommand === "resources";
  const autostartAction = rawCommand === "autostart" ? rawRest[0] : undefined;
  if (rawCommand === "autostart" && (!autostartAction || autostartAction.startsWith("-")))
    return emptyOptions("help", "autostart");
  if (rawCommand === "autostart" && !["status", "set"].includes(autostartAction!))
    throw new CliError(cliTranslate("Unknown autostart command; use status or set."), 2);
  const nestedAutostart = rawCommand === "autostart";
  const proxyAction = rawCommand === "proxy" ? rawRest[0] : undefined;
  if (rawCommand === "proxy" && (!proxyAction || proxyAction.startsWith("-")))
    return emptyOptions("help", "proxy");
  if (rawCommand === "proxy" && !["status", "set", "test"].includes(proxyAction!))
    throw new CliError(cliTranslate("Unknown proxy command; use status, set, or test."), 2);
  const nestedProxy = rawCommand === "proxy";
  if (nestedResources && (!rawRest[0] || ["--help", "-h"].includes(rawRest[0])))
    return emptyOptions("help", "resources-set");
  if (nestedResources && rawRest[0] !== "set" && rawRest[0] !== "status")
    throw new CliError(cliTranslate("Unknown resources command; use status or set."), 2);
  if (nestedEngine && (!rawRest[0] || ["--help", "-h"].includes(rawRest[0])))
    return emptyOptions("help", "engine-status");
  if (nestedEngine && !engineActions.some(action => action === rawRest[0]))
    throw new CliError(cliTranslate("Unknown engine command; use status, start, stop, remove, or docker."));
  const tailscaleAction = rawCommand === "tailscale" ? rawRest[0] : undefined;
  if (rawCommand === "tailscale" && (!tailscaleAction || tailscaleAction.startsWith("-")))
    return emptyOptions("help", "tailscale");
  if (rawCommand === "tailscale" && !["enable", "status", "disable"].includes(tailscaleAction!))
    throw new CliError("Unknown tailscale command; use enable, status, or disable.");
  const nestedTailscale = rawCommand === "tailscale";
  const notificationAction = rawCommand === "notifications" ? rawRest[0] : undefined;
  if (rawCommand === "notifications" && (!notificationAction || notificationAction.startsWith("-")))
    return emptyOptions("help", "notifications");
  if (rawCommand === "notifications" && !["configure", "status"].includes(notificationAction!))
    throw new CliError("Unknown notifications command; use configure or status.");
  const nestedNotifications = rawCommand === "notifications";
  const nestedAccountUpdate = rawCommand === "account" && rawRest[0] === "update";
  const providerAction = rawCommand === "provider" ? rawRest[0] : undefined;
  const modelAction = rawCommand === "model" ? rawRest[0] : undefined;
  if (rawCommand === "provider" && !providerAction) return emptyOptions("help", "provider");
  if (rawCommand === "account" && rawRest.length === 0) return emptyOptions("help", "account");
  const nestedProviderList = rawCommand === "provider" && providerAction === "list";
  const nestedProviderLogin = rawCommand === "provider" && providerAction === "login";
  const nestedProviderLogout = rawCommand === "provider" && providerAction === "logout";
  const nestedProviderAdd = rawCommand === "provider" && providerAction === "add";
  const nestedProviderRemove = rawCommand === "provider" && providerAction === "remove";
  const nestedModelList = rawCommand === "model" && modelAction === "list";
  const nestedModelUse = rawCommand === "model" && modelAction === "use";
  if (
    rawCommand === "model" &&
    modelAction &&
    !modelAction.startsWith("-") &&
    !["list", "use"].includes(modelAction)
  ) {
    const suggestion = closest(modelAction, ["list", "use"]);
    throw new CliError(
      `Unknown model command: ${modelAction}.${suggestion ? ` Did you mean "${suggestion}"?` : ""}`
    );
  }
  const command = nestedResources
    ? `resources-${rawRest[0]}`
    : nestedAutostart
      ? `autostart-${autostartAction}`
      : nestedProxy
        ? `proxy-${proxyAction}`
        : nestedTailscale
    ? `tailscale-${tailscaleAction}`
    : nestedNotifications
      ? `notifications-${notificationAction}`
      : nestedAccountUpdate
        ? "account-update"
        : nestedProviderList
          ? "provider-list"
          : nestedProviderLogin
            ? "provider-login"
            : nestedProviderLogout
              ? "provider-logout"
              : nestedProviderAdd
                ? "provider-add"
                : nestedProviderRemove
                  ? "provider-remove"
                  : nestedModelList
                    ? "model-list"
                    : nestedModelUse
                      ? "model-use"
                      : nestedEngine
                        ? `engine-${rawRest[0]}`
                        : rawCommand === "health"
                          ? "status"
                          : rawCommand;
  let rest =
    nestedResources ||
    nestedAutostart ||
    nestedProxy ||
    nestedEngine ||
    nestedTailscale ||
    nestedNotifications ||
    nestedAccountUpdate ||
    nestedProviderList ||
    nestedProviderLogin ||
    nestedProviderLogout ||
    nestedProviderAdd ||
    nestedProviderRemove ||
    nestedModelList ||
    nestedModelUse
      ? rawRest.slice(1)
      : rawRest;
  const separator = nestedEngine && command === "engine-docker" ? rest.indexOf("--") : -1;
  const dockerArgs = separator === -1 ? undefined : rest.slice(separator + 1);
  if (separator !== -1) rest = rest.slice(0, separator);
  if (rest.includes("--help") || rest.includes("-h")) {
    if (commands.has(command as CommandName)) {
      return emptyOptions("help", command as CommandName);
    }
    if (
      ["provider", "model", "account", "notifications"].includes(rawCommand) &&
      (!rawRest[0] || rawRest[0].startsWith("-"))
    ) {
      return emptyOptions("help", rawCommand as HelpTopic);
    }
  }
  if (!commands.has(command as CommandName)) {
    if (rawCommand === "password") {
      throw new CliError(
        "outcomego password reset was removed; use outcomego account update --password"
      );
    }
    if (rawCommand === "account") {
      const suggestion = closest(rawRest[0] ?? "", ["update"]);
      throw new CliError(
        `Unknown account command: ${rawRest[0]}.${suggestion ? ` Did you mean "${suggestion}"?` : ""}`
      );
    }
    if (rawCommand === "provider") {
      const suggestion = closest(rawRest[0] ?? "", ["list", "login", "logout", "add", "remove"]);
      throw new CliError(
        `Unknown provider command: ${rawRest[0]}.${suggestion ? ` Did you mean "${suggestion}"?` : ""}`
      );
    }
    if (rawCommand === "model") {
      const suggestion = closest(rawRest[0] ?? "", ["list", "use"]);
      throw new CliError(
        `Unknown model command: ${rawRest[0]}.${suggestion ? ` Did you mean "${suggestion}"?` : ""}`
      );
    }
    const suggestion = closest(rawCommand, [
      "install",
      "setup",
      "status",
      "health",
      "doctor",
      "update",
      "start",
      "stop",
      "logs",
      "provider",
      "model",
      "account",
      "uninstall",
    ]);
    throw new CliError(
      `Unknown command: ${rawCommand}.${suggestion ? ` Did you mean "${suggestion}"?` : " Run outcomego --help to see available commands."}`
    );
  }

  const options = emptyOptions(command as CommandName);
  if (command === "engine-docker") {
    if (!dockerArgs?.length) throw new CliError(cliTranslate("Supply container CLI arguments after --."), 2);
    options.dockerArgs = dockerArgs;
  }
  const positional: string[] = [];
  while (rest[0] && !rest[0].startsWith("-")) {
    positional.push(rest[0]);
    rest = rest.slice(1);
  }
  if (command === "provider-login" || command === "provider-logout") {
    if (positional.length > 1)
      throw new CliError(`outcomego provider ${providerAction} accepts one provider`);
    options.providerId = positional[0];
  } else if (command === "provider-add" || command === "provider-remove") {
    if (positional.length !== 1)
      throw new CliError(`outcomego provider ${providerAction} requires a provider id`);
    options.providerId = positional[0];
  } else if (command === "model-list") {
    if (positional.length > 1) throw new CliError("outcomego model list accepts one provider");
    options.providerId = positional[0];
  } else if (command === "model-use") {
    if (positional.length !== 2)
      throw new CliError("outcomego model use requires a provider and model");
    [options.providerId, options.modelId] = positional;
  } else if (command === "logs") {
    if (positional.length > 1) throw new CliError("outcomego logs accepts one service name");
    options.service = positional[0];
  } else if (command === "restart") {
    if (positional.length > 1) throw new CliError("outcomego restart accepts at most one service name");
    options.service = positional[0];
  } else if (positional.length > 0) {
    throw new CliError(`Unexpected argument for ${rawCommand}: ${positional[0]}`);
  }
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (!flag) continue;
    if (!commonFlags.has(flag) && !commandFlags[options.command as CommandName].has(flag)) {
      throw new CliError(
        `Unknown option for ${commandLabel(options.command as CommandName)}: ${flag}`
      );
    }
    if (flag === "--yes" || flag === "-y") {
      options.yes = true;
      continue;
    }
    if (flag === "--purge" || flag === "--purge-data") {
      options.purge = true;
      continue;
    }
    if (flag === "--force") {
      options.force = true;
      continue;
    }
    if (flag === "--allow-downgrade") {
      options.allowDowngrade = true;
      continue;
    }
    if (flag === "--allow-prerelease") {
      options.allowPrerelease = true;
      continue;
    }
    if (flag === "--allow-unsigned") {
      options.allowUnsigned = true;
      continue;
    }
    if (flag === "--advanced") {
      options.advanced = true;
      continue;
    }
    if (flag === "--no-setup") {
      options.noSetup = true;
      continue;
    }
    if (flag === "--follow" || flag === "-f") {
      options.follow = true;
      continue;
    }
    if (flag === "--json") {
      options.json = true;
      continue;
    }
    if (flag === "--stats") {
      options.stats = true;
      continue;
    }
    if (flag === "--enabled") {
      const value = rest[index + 1];
      if (value !== "true" && value !== "false") {
        throw new CliError("INVALID_INPUT: --enabled must be true or false", 2);
      }
      options.enabled = value === "true";
      index += 1;
      continue;
    }
    if (flag === "--config-stdin") {
      options.configStdin = true;
      continue;
    }
    if (flag === "--json-progress") {
      options.jsonProgress = true;
      continue;
    }
    if (flag === "--when-idle") {
      options.whenIdle = true;
      continue;
    }
    if (flag === "--accept-low-memory") {
      options.acceptLowMemory = true;
      continue;
    }
    if (flag === "--apply-wslconfig") {
      options.applyWslconfig = true;
      continue;
    }
    if (flag === "--restart-wsl") {
      options.restartWsl = true;
      continue;
    }
    if (flag === "--password") {
      const next = rest[index + 1];
      if (next && !next.startsWith("--")) {
        throw new CliError(
          "--password does not accept a value; OutcomeGo prompts securely so the password is not saved in shell history"
        );
      }
      options.password = true;
      continue;
    }
    if (flag === "--no-auth") {
      options.noAuth = true;
      continue;
    }
    if (flag === "--reasoning") {
      options.reasoning = true;
      continue;
    }
    const property = valueFlags.get(flag);
    if (property) {
      const value = rest[index + 1];
      if (!value || value.startsWith("--")) throw new CliError(`${flag} requires a value`);
      if (property === "service" && options.service) {
        throw new CliError("Choose a log service either by name or with --service, not both");
      }
      if (property === "language") options.language = normalizeLocale(value);
      else options[property] = value;
      index += 1;
      continue;
    }
    throw new CliError(
      `Unknown option for ${commandLabel(options.command as CommandName)}: ${flag}`
    );
  }
  if (
    options.httpsPort !== undefined &&
    (!/^\d+$/.test(options.httpsPort) ||
      Number(options.httpsPort) < 1 ||
      Number(options.httpsPort) > 65535)
  )
    throw new CliError("--https-port must be a whole number from 1 to 65535");
  if (options.authType !== undefined) {
    const normalized = options.authType.replace("-", "_");
    if (normalized !== "oauth" && normalized !== "api_key") {
      throw new CliError("--auth must be oauth or api-key");
    }
    options.authType = normalized;
  }
  if (options.command === "provider-add") {
    if (!options.providerName || !options.baseUrl || !options.apiProtocol) {
      throw new CliError("provider add requires --name, --base-url, and --api");
    }
    if (
      ![
        "openai-completions",
        "openai-responses",
        "anthropic-messages",
        "google-generative-ai",
      ].includes(options.apiProtocol)
    ) {
      throw new CliError(
        "--api must be openai-completions, openai-responses, anthropic-messages, or google-generative-ai"
      );
    }
    for (const [flag, value] of [
      ["--context-window", options.contextWindow],
      ["--max-tokens", options.maxTokens],
    ] as const) {
      if (value !== undefined && (!/^\d+$/.test(value) || Number(value) <= 0)) {
        throw new CliError(`${flag} must be a positive whole number`);
      }
    }
  }
  if (options.providerId !== undefined) {
    options.providerId = options.providerId.toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(options.providerId)) {
      throw new CliError(
        "Provider ids may contain lowercase letters, numbers, dots, underscores, or hyphens"
      );
    }
  }
  if (options.modelId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(options.modelId)) {
    throw new CliError("Invalid model id");
  }
  if (
    options.thinking !== undefined &&
    !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(options.thinking)
  ) {
    throw new CliError("--thinking must be off, minimal, low, medium, high, xhigh, or max");
  }
  if (options.tail !== undefined && !/^\d+$/.test(options.tail)) {
    throw new CliError("--tail must be a whole number");
  }
  if (
    options.service !== undefined &&
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(options.service)
  ) {
    throw new CliError("--service must be a Compose service name");
  }
  return options;
};
