import { tailscaleStatus } from "./tailscale-command";
import { existsSync, readFileSync } from "node:fs";
import { installationCommand } from "./command-ui";
import {
  normalizeProjectName,
  parseEnvironment,
  readManifest,
  type InstallationPaths,
} from "./config";
import { PROJECT_NAME } from "./constants";
import {
  ComposeProject,
  dockerDaemon,
  dockerVersion,
  MINIMUM_COMPOSE_VERSION,
  probeCompose,
} from "./docker";
import { commandDiagnostic, dockerFailureCheck } from "./docker-diagnostics";
import { boundedDoctorRunner } from "./doctor-probes";
import { CliError } from "./errors";
import { checkHealth, withExpectedVersion } from "./health";
import { cliTranslate } from "./localization";
import type { CommandRunner } from "./process";
import { ACCESS_MODES, accessLabel, type AccessMode } from "./setup-values";
import { assertOwnServer } from "./stack";
import { expectedServices, readServiceStates } from "./startup";
import { isSetupJob, renderStatus, statusState, type StatusReport } from "./status-ui";

/** A bounded, read-only snapshot. Doctor performs the deeper checks and inference request. */
export const collectStatus = async (
  paths: InstallationPaths,
  suppliedRunner: CommandRunner
): Promise<StatusReport> => {
  const runner = boundedDoctorRunner(suppliedRunner);
  const command = (name: string) => installationCommand(paths, name);
  const report: StatusReport = {
    // Kept as an English sentinel: it is compared against the health payload below.
    version: "Unknown",
    directory: paths.directory,
    connection: cliTranslate("Not checked"),
    server: cliTranslate("Not checked"),
    expected: [],
    services: null,
    health: null,
    next: command("doctor"),
  };
  const blocked = (
    label: string,
    detail: string,
    action: string,
    diagnostic?: string
  ): StatusReport => {
    report.issue = { label, detail, diagnostic };
    report.nextDetail = action;
    report.next = command("status");
    return report;
  };
  const files = [paths.manifest, paths.environment, paths.compose];
  if (!files.some(existsSync)) {
    report.issue = {
      label: "Installation",
      detail: cliTranslate("OutcomeGo has not been installed in this directory."),
      notInstalled: true,
    };
    report.nextDetail = cliTranslate(
      "Install OutcomeGo, or use --dir to select an existing installation."
    );
    report.next = command("install");
    return report;
  }
  if (!files.every(existsSync))
    return blocked(
      "Installation",
      cliTranslate("Some installation files are missing."),
      cliTranslate(
        "Check that --dir selects the right installation. Restore missing files from a known-good backup, then run {command}.",
        { command: command("doctor") }
      ),
      cliTranslate("Missing: {files}", {
        files: files.filter((file) => !existsSync(file)).join(", "),
      })
    );

  let environment: ReadonlyMap<string, string>;
  let owner: string | undefined;
  try {
    const manifest = readManifest(paths);
    if (!manifest) throw new Error("The installation manifest is missing.");
    report.version = manifest.version;
    report.project = normalizeProjectName(manifest.projectName || PROJECT_NAME);
    owner = manifest.ownerUsername;
    report.username = owner?.trim() || undefined;
    environment = parseEnvironment(readFileSync(paths.environment, "utf8"));
    const access = environment.get("OUTCOMEGO_ACCESS_MODE") || "local";
    report.connection = ACCESS_MODES.includes(access as AccessMode)
      ? accessLabel(access as AccessMode)
      : access;
    report.server = environment.get("OUTCOMEGO_PUBLIC_URL") || cliTranslate("Not configured");
    report.expected = expectedServices(environment);
  } catch (error) {
    return blocked(
      "Configuration",
      cliTranslate("OutcomeGo's installation configuration could not be read."),
      cliTranslate(
        "Check file access and restore damaged configuration from a known-good backup. Run {command} for details.",
        { command: command("doctor") }
      ),
      error instanceof Error ? error.message : String(error)
    );
  }

  if (environment.get("OUTCOMEGO_ACCESS_MODE") === "tailscale") {
    const status = await tailscaleStatus(paths, runner);
    if (status.issue)
      return blocked(
        "Tailscale HTTPS",
        status.issue,
        cliTranslate("Run {command} on the server host.", {
          command: command("tailscale status"),
        })
      );
  }

  const cli = dockerVersion(runner);
  if (cli.status !== 0) {
    const check = dockerFailureCheck("cli", cli);
    return blocked(check.label, check.detail, check.action!, check.diagnostic);
  }
  const daemon = dockerDaemon(runner);
  if (daemon.status !== 0) {
    const check = dockerFailureCheck("daemon", daemon);
    return blocked(check.label, check.detail, check.action!, check.diagnostic);
  }
  const compose = probeCompose(runner);
  if (!compose.command?.supported)
    return blocked(
      "Docker Compose",
      compose.command
        ? cliTranslate("Docker Compose is too old or its version is unknown: {version}", {
            version: compose.command.version,
          })
        : cliTranslate("Docker Compose could not run."),
      cliTranslate(
        "Install or update Docker Desktop or the Docker Compose plugin to {version} or newer. Verify with docker compose version, then retry.",
        { version: MINIMUM_COMPOSE_VERSION }
      ),
      compose.failures.map(({ command, result }) => commandDiagnostic(command, result)).join("\n")
    );
  try {
    report.services = readServiceStates(
      new ComposeProject(paths, compose.command, runner, report.project)
    );
  } catch (error) {
    return blocked(
      "Containers",
      cliTranslate("OutcomeGo could not read its container states."),
      cliTranslate(
        "Run docker info to check the engine, then {command} to inspect Compose and configuration errors.",
        { command: command("doctor") }
      ),
      error instanceof Error ? error.message : String(error)
    );
  }
  const probe = await checkHealth(paths);
  report.health = withExpectedVersion(probe, report.version);
  try {
    assertOwnServer(
      runner,
      probe,
      new Set(report.services.filter((s) => s.State === "running").map((s) => s.Service)),
      environment
    );
  } catch (error) {
    report.serverConflict = true;
    report.health = {
      ...report.health,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
    report.nextDetail = cliTranslate(
      "Resolve the server port conflict before starting this installation. Inspect the configuration with:"
    );
    report.next = command("doctor");
    return report;
  }
  const state = statusState(report);
  const failed = report.services.find(
    (s) =>
      (isSetupJob(s) || report.expected.includes(s.Service)) &&
      (s.Health === "unhealthy" ||
        ["restarting", "dead", "paused", "removing"].includes(s.State) ||
        (s.State === "exited" && s.ExitCode !== 0))
  );
  if (failed) {
    report.nextDetail = cliTranslate(
      "Inspect {service} logs to find why it is not ready. For a deeper diagnosis, run {command}.",
      { service: failed.Service, command: command("doctor") }
    );
    report.next = command(
      `logs ${/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(failed.Service) ? failed.Service : ""}`.trim()
    );
  } else if (state === "STARTING") {
    report.nextDetail = cliTranslate(
      "Setup or health checks are still in progress. Wait a moment and check again. If this persists, run {command}.",
      { command: command("doctor") }
    );
    report.next = command("status");
  } else if (!owner?.trim()) {
    report.nextDetail = cliTranslate("Finish account setup before using OutcomeGo:");
    report.next = command("setup");
  } else if (
    state === "STOPPED" ||
    report.expected.some(
      (name) => !report.services!.some((s) => s.Service === name && s.State === "running")
    )
  ) {
    report.nextDetail = cliTranslate(
      "Start the missing or stopped services, then check status again:"
    );
    report.next = command("start");
  } else if (!report.health.ok) {
    const components = report.health.components;
    const unavailable = (name: "database" | "queue" | "computer") =>
      components?.[name] !== undefined && components[name] !== "ready";
    if (unavailable("database") || unavailable("queue")) {
      report.nextDetail = cliTranslate(
        "The server cannot use its database or job queues. Inspect database logs, then run {command} to check schema setup and queue processing.",
        { command: command("doctor") }
      );
      report.next = command("logs postgres");
    } else if (unavailable("computer")) {
      report.nextDetail = cliTranslate(
        "The computer service is not ready or rejected the server's credentials. Inspect its logs, then run {command} to check the connection and workspace.",
        { command: command("doctor") }
      );
      report.next = command("logs computer");
    } else {
      report.nextDetail = cliTranslate(
        "Containers are running, but the server is not ready. Check server logs; run {command} for a deeper diagnosis.",
        { command: command("doctor") }
      );
      report.next = command("logs server");
    }
  } else if (report.health.inference !== "ready") {
    report.nextDetail = cliTranslate(
      "Containers and server are ready. Connect a model in the OutcomeGo app under Settings → Server before starting AI tasks. On a server without the app, run:"
    );
    report.next = command("model");
  } else {
    report.nextDetail = cliTranslate("For deeper database, queue, storage, and model checks:");
  }
  return report;
};

export const statusCommand = async (
  paths: InstallationPaths,
  runner: CommandRunner
): Promise<void> => {
  const report = await collectStatus(paths, runner);
  console.log(renderStatus(report));
  if (statusState(report) !== "RUNNING")
    throw new CliError(
      report.issue?.detail ||
        (report.health && !report.health.ok
          ? cliTranslate("OutcomeGo is not healthy: {detail}", { detail: report.health.detail })
          : cliTranslate("OutcomeGo services need attention.")),
      2,
      true
    );
};
