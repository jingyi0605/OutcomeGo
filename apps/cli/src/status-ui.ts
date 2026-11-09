import type { HealthResult } from "./health";
import { cliTranslate } from "./localization";
import type { ServiceState } from "./startup";
import { TerminalReport, type TerminalOptions, type TerminalTone } from "./terminal";

export interface StatusReport {
  version: string;
  directory: string;
  connection: string;
  server: string;
  /** The owner account the apps sign in with; absent until setup creates it. */
  username?: string;
  project?: string;
  // null means inspection was blocked; [] means Docker confirmed no containers.
  services: readonly ServiceState[] | null;
  expected: readonly string[];
  health:
    | (Pick<HealthResult, "ok" | "detail" | "inference" | "connectionFailed" | "components"> & {
        url?: string;
      })
    | null;
  issue?: { label: string; detail: string; diagnostic?: string; notInstalled?: boolean };
  serverConflict?: boolean;
  next: string;
  nextDetail?: string;
}

export const isSetupJob = (service: ServiceState): boolean =>
  service.Service === "migrate" || service.Service.endsWith("-init");

const failed = (service: ServiceState): boolean =>
  ["restarting", "dead", "paused", "removing"].includes(service.State) ||
  service.Health === "unhealthy" ||
  (service.State === "exited" && service.ExitCode !== undefined && service.ExitCode !== 0);

export const statusState = (
  input: StatusReport
): "NOT INSTALLED" | "STATUS UNKNOWN" | "NEEDS ATTENTION" | "STOPPED" | "STARTING" | "RUNNING" => {
  if (input.issue?.notInstalled) return "NOT INSTALLED";
  if (input.issue || input.services === null) return "STATUS UNKNOWN";
  if (input.serverConflict) return "NEEDS ATTENTION";
  const required = input.services.filter(
    (s) => input.expected.includes(s.Service) || isSetupJob(s)
  );
  if (required.some(failed)) return "NEEDS ATTENTION";
  const containers = required.filter((s) => input.expected.includes(s.Service));
  if (!containers.some((s) => !["exited", "created"].includes(s.State))) return "STOPPED";
  const complete = input.expected.every((name) => containers.some((s) => s.Service === name));
  const transitioning = required.some(
    (s) =>
      s.Health === "starting" || s.State === "created" || (isSetupJob(s) && s.State === "running")
  );
  if (
    complete &&
    transitioning &&
    required.every(
      (s) =>
        ["created", "running"].includes(s.State) ||
        (isSetupJob(s) && s.State === "exited" && s.ExitCode === 0)
    )
  )
    return "STARTING";
  const ready =
    complete &&
    containers.every((s) => s.State === "running" && (!s.Health || s.Health === "healthy")) &&
    required.filter(isSetupJob).every((s) => s.State === "exited" && s.ExitCode === 0) &&
    input.health?.ok;
  return ready ? "RUNNING" : "NEEDS ATTENTION";
};

const serviceDescription = (
  service: ServiceState
): { text: string; tone: TerminalTone; mark: string } => {
  if (isSetupJob(service) && service.State === "exited" && service.ExitCode === 0)
    return { text: cliTranslate("Completed · exit 0"), tone: "muted", mark: "✓" };
  const state =
    (
      {
        running: cliTranslate("Running"),
        exited: cliTranslate("Stopped"),
        created: cliTranslate("Created; not started"),
        restarting: cliTranslate("Restarting"),
        paused: cliTranslate("Paused"),
        dead: cliTranslate("Dead"),
        removing: cliTranslate("Being removed"),
      } as Record<string, string>
    )[service.State] ||
    cliTranslate("Unknown state: {state}", {
      state: service.State || cliTranslate("not reported"),
    });
  const detail =
    service.State === "running"
      ? isSetupJob(service)
        ? cliTranslate("setup in progress")
        : service.Health === "healthy"
          ? cliTranslate("healthy")
          : service.Health === "starting"
            ? cliTranslate("health check starting")
            : service.Health === "unhealthy"
              ? cliTranslate("health check failing")
              : !service.Health
                ? cliTranslate("no Docker health check")
                : cliTranslate("health: {health}", { health: service.Health })
      : service.State === "exited" || service.State === "dead" || service.State === "restarting"
        ? service.ExitCode === undefined
          ? cliTranslate("exit code not reported")
          : cliTranslate("exit {code}", { code: service.ExitCode })
        : "";
  const ok =
    service.State === "running" &&
    !isSetupJob(service) &&
    (!service.Health || service.Health === "healthy");
  return {
    text: `${state}${detail ? ` · ${detail}` : ""}`,
    tone: failed(service) ? "error" : ok ? "success" : "warning",
    mark: failed(service) ? "✗" : ok ? "✓" : "!",
  };
};

export const renderStatus = (input: StatusReport, options: TerminalOptions = {}): string => {
  const state = statusState(input);
  const ready = state === "RUNNING";
  const view = new TerminalReport(options).header(
    "status",
    cliTranslate(state),
    ready ? "success" : state === "NEEDS ATTENTION" ? "error" : "warning"
  );
  const containers = input.services?.filter((s) => input.expected.includes(s.Service));
  const summary = input.issue
    ? input.issue.detail
    : containers
      ? cliTranslate(
          "{running}/{total} containers running · {healthy} passing Docker health checks",
          {
            running: containers.filter((s) => s.State === "running").length,
            total:
              containers.length +
              input.expected.filter((name) => !containers.some((s) => s.Service === name)).length,
            healthy: containers.filter((s) => s.State === "running" && s.Health === "healthy")
              .length,
          }
        )
      : cliTranslate("Container state could not be checked.");
  view.lines.push("");
  view.text(summary, ready ? "success" : "warning");
  const next = () =>
    view
      .section(cliTranslate(ready ? "Next" : "Next steps"))
      .text(input.nextDetail || cliTranslate(ready ? "For a deeper check:" : "Recommended action:"))
      .text(input.next, "info");
  if (!ready) next();
  if (input.issue) {
    view
      .section(cliTranslate("Check blocked"))
      // Labels are the same identifiers the doctor report groups and matches on.
      .row(input.issue.label, input.issue.detail, { mark: "✗", tone: "error" });
    if (input.issue.diagnostic) view.text(input.issue.diagnostic);
  }
  view.section(cliTranslate("Containers"));
  if (input.services === null)
    view.text(cliTranslate("Not checked. Resolve the issue above, then run status again."));
  else {
    for (const name of input.expected) {
      const instances = input.services.filter((s) => s.Service === name);
      if (!instances.length)
        view.row(name, cliTranslate("Not created"), { mark: "!", tone: "warning" });
      instances.forEach((service, index) => {
        const { text, ...style } = serviceDescription(service);
        view.row(
          instances.length > 1 ? `${name} (${index + 1}/${instances.length})` : name,
          text,
          style
        );
      });
    }
    const jobs = input.services.filter(isSetupJob);
    if (jobs.length) {
      view.section(cliTranslate("Setup jobs"));
      for (const job of jobs) {
        const { text, ...style } = serviceDescription(job);
        view.row(job.Service, text, style);
      }
      view.text(cliTranslate("Setup jobs finish and stop normally; exit 0 means success."));
    }
  }
  view
    .section(cliTranslate("Readiness"))
    .row(
      cliTranslate("Server"),
      input.health
        ? input.health.ok
          ? cliTranslate("Ready · responding with the installed release")
          : input.health.connectionFailed
            ? cliTranslate("Cannot reach the server: {detail}", { detail: input.health.detail })
            : input.health.detail
        : cliTranslate("Not checked"),
      {
        mark: input.health ? (input.health.ok ? "✓" : "✗") : "–",
        tone: input.health ? (input.health.ok ? "success" : "error") : "muted",
      }
    );
  if (input.health?.url) view.row(cliTranslate("Checked at"), input.health.url);
  for (const [name, value] of Object.entries(input.health?.components ?? {}))
    view.row(
      cliTranslate(
        name === "queue" ? "Queue database" : name === "database" ? "Database" : "Computer API"
      ),
      value === "ready" ? cliTranslate("Ready") : value,
      {
        mark: value === "ready" ? "✓" : "✗",
        tone: value === "ready" ? "success" : "error",
      }
    );
  if (input.health?.ok)
    view.row(
      cliTranslate("AI model"),
      input.health.inference === "ready"
        ? cliTranslate("Connected")
        : input.health.inference === "missing"
          ? cliTranslate("Not connected · connect one in the aiTeamOS app")
          : cliTranslate("Not ready ({status}) · check it in the aiTeamOS app", {
              status: input.health.inference ?? cliTranslate("Unknown"),
            }),
      { tone: input.health.inference === "ready" ? "muted" : "warning" }
    );
  view.section(cliTranslate("Connection")).row(cliTranslate("Server"), input.server, {
    tone: "info",
  });
  if (input.username) view.row(cliTranslate("Username"), input.username);
  view
    .row(cliTranslate("Access"), input.connection)
    .row(
      cliTranslate("Version"),
      input.version === "Unknown" ? cliTranslate("Unknown") : input.version
    );
  if (input.project) view.row(cliTranslate("Compose project"), input.project);
  view.row(cliTranslate("Installation"), input.directory);
  if (ready) next();
  view.lines.push("");
  return view.toString();
};
