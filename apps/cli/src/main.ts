#!/usr/bin/env node

import "./runtime-compat";
import {
  ensureUpdateAgent,
  runUpdateAgent,
  stopUpdateAgent,
  UPDATE_AGENT_ENV,
} from "./update-agent";
import { renderHelp, renderCommandError } from "./command-ui";
import { colorEnabled } from "./ui";
import { resolve } from "node:path";
import { parseArguments } from "./arguments";
import { bootstrapCommand, watchBootstrapCancellation } from "./bootstrap";
import { DESKTOP_CLI_PREPARE_ENV, DESKTOP_CLI_VERSION_ENV, prepareDesktopCli, verifyDesktopCliVersion } from "./cli-update";
import {
  defaultInstallDirectory,
  installationExists,
  installationPaths,
  readManifest,
} from "./config";
import { CLI_VERSION } from "./constants";
import { requireComposeProject } from "./docker";
import {
  durableUpdateCommand,
  reportActiveUpdate,
  runUpdateWorker,
  updateWorkerJobId,
} from "./durable-update";
import { CliError, errorMessage } from "./errors";
import { engineStatus } from "./engine/status";
import { managedEngine, recordedEngine, requireRecordedEngine } from "./engine/select";
import { ManagedWslEngine } from "./engine/managed-wsl";
import { ManagedEngine } from "./engine/managed";
import { windowsLocalPath } from "./engine/managed-host";
import { EngineError } from "./engine/types";
import { assertNoEngineRecovery } from "./engine/upgrade-transaction";
import { acquireUpdateLock } from "./update-safety";
import { helpFor } from "./help";
import { cliTranslate } from "./localization";
import {
  doctorCommand,
  installCommand,
  logsCommand,
  resourcesSetCommand,
  startCommand,
  statusCommand,
  stopCommand,
  uninstallCommand,
} from "./lifecycle";
import { accountUpdateCommand } from "./password";
import { SystemCommandRunner } from "./process";
import {
  modelListCommand,
  modelUseCommand,
  providerAddCommand,
  providerListCommand,
  providerLoginCommand,
  providerLogoutCommand,
  providerRemoveCommand,
} from "./providers";
import { modelCommand } from "./model-command";
import { notificationsCommand } from "./notifications";
import { tailscaleCommand } from "./tailscale-command";
import { setupCommand } from "./setup";
import { statusJson } from "./status";

const main = async (): Promise<void> => {
  const options = parseArguments(process.argv.slice(2));
  if (options.language) process.env.OUTCOMEGO_LANGUAGE = options.language;
  if (options.command === "help") {
    console.log(renderHelp(helpFor(options.helpTopic)));
    return;
  }
  if (options.command === "version") {
    const prepareVersion = process.env[DESKTOP_CLI_PREPARE_ENV];
    if (prepareVersion !== undefined) {
      delete process.env[DESKTOP_CLI_PREPARE_ENV];
      verifyDesktopCliVersion(prepareVersion, CLI_VERSION);
      console.log(JSON.stringify({ executable: await prepareDesktopCli({ version: CLI_VERSION }) }));
    } else console.log(CLI_VERSION);
    return;
  }
  const directory = options.directory ? resolve(options.directory) : defaultInstallDirectory();
  const paths = installationPaths(directory);
  if (options.command !== "engine-rollback" && !["bootstrap", "status", "engine-status", "doctor", "logs"].includes(options.command)) assertNoEngineRecovery(paths);
  if (process.env[UPDATE_AGENT_ENV] === "1") {
    await runUpdateAgent(paths);
    return;
  }
  const runner = new SystemCommandRunner();
  const runLifecycle = async (action: () => void | Promise<void>) => {
    const kind = recordedEngine(paths);
    const unlock = kind && kind !== "external" ? acquireUpdateLock(paths) : undefined;
    try { await action(); } finally { unlock?.(); }
  };
  const desktopVersion = process.env[DESKTOP_CLI_VERSION_ENV];
  const defaultDirectory = defaultInstallDirectory();
  const desktopDirectory = process.platform === "win32"
    ? windowsLocalPath(paths.directory) === windowsLocalPath(defaultDirectory)
    : paths.directory === defaultDirectory;
  if (desktopVersion !== undefined && ["start", "stop", "uninstall", "resources-set"].includes(options.command)) {
    verifyDesktopCliVersion(desktopVersion, CLI_VERSION);
    const kind = recordedEngine(paths);
    if (!desktopDirectory || !kind || (kind === "external" && !requireRecordedEngine(paths, runner, kind).isLocal())) {
      throw new CliError("ENGINE_UNAVAILABLE", 2);
    }
  }
  switch (options.command) {
    case "tailscale-enable":
    case "tailscale-status":
    case "tailscale-disable":
      await tailscaleCommand(paths, options, runner);
      break;
    case "install":
      await installCommand(paths, options, runner);
      break;
    case "bootstrap": {
      const controller = new AbortController();
      const abort = () => controller.abort();
      const marker = process.env.OUTCOMEGO_BOOTSTRAP_CANCEL_FILE;
      delete process.env.OUTCOMEGO_BOOTSTRAP_CANCEL_FILE;
      const close = watchBootstrapCancellation(marker, controller);
      process.on("SIGINT", abort);
      process.on("SIGTERM", abort);
      try {
        process.exitCode = await bootstrapCommand(paths, options, runner, { signal: controller.signal });
      } finally {
        close();
        process.off("SIGINT", abort);
        process.off("SIGTERM", abort);
      }
      break;
    }
    case "setup":
      if (installationExists(paths))
        await setupCommand(paths, runner, { advanced: options.advanced });
      else await installCommand(paths, options, runner);
      break;
    case "doctor":
      await doctorCommand(paths, options, runner);
      break;
    case "status":
      if (options.json) {
        console.log(JSON.stringify(await statusJson(paths, runner)));
        break;
      }
      if (options.jsonProgress && reportActiveUpdate(paths, options)) break;
      await statusCommand(paths, runner);
      break;
    case "engine-status":
      console.log(JSON.stringify(await engineStatus(runner, paths, options.engine), null, options.json ? undefined : 2));
      break;
    case "engine-docker": {
      const manifest = readManifest(paths);
      if (!manifest) throw new EngineError("ENGINE_UNAVAILABLE");
      await runLifecycle(() => {
        const [tool, ...args] = options.dockerArgs!;
        const result = tool === "compose"
          ? requireComposeProject(paths, runner, manifest.projectName).run(args, { inherit: true })
          : requireRecordedEngine(paths, runner, manifest.engine.kind).docker(options.dockerArgs!, { inherit: true, timeoutMs: 0 });
        process.exitCode = result.status;
      });
      break;
    }
    case "engine-start":
    case "engine-stop":
    case "engine-remove":
    case "engine-enable-wsl": {
      if (options.command === "engine-enable-wsl") {
        if (!options.yes || (desktopVersion !== undefined && !desktopDirectory)) throw new EngineError("INVALID_INPUT");
        if (desktopVersion !== undefined) verifyDesktopCliVersion(desktopVersion, CLI_VERSION);
        const wsl = managedEngine(paths, runner);
        if (!(wsl instanceof ManagedWslEngine) || recordedEngine(paths) === "external") throw new EngineError("WINDOWS_UNSUPPORTED");
        const unlock = acquireUpdateLock(paths);
        try { await wsl.enable(); } finally { unlock(); }
        break;
      }
      const manifest = readManifest(paths);
      if (!manifest || manifest.engine.kind === "external") throw new EngineError("ENGINE_UNAVAILABLE");
      const engine = requireRecordedEngine(paths, runner);
      if (!(engine instanceof ManagedEngine)) throw new EngineError("ENGINE_UNAVAILABLE");
      const unlock = acquireUpdateLock(paths);
      try {
        if (options.command === "engine-start") {
          await engine.ensureReady();
          if (!manifest.uninstalledAt) engine.ensureAutostart();
        } else if (options.command === "engine-stop") {
          engine.removeAutostart();
          await engine.stop();
        } else {
          if (!options.purge || !manifest.uninstalledAt) throw new EngineError("INVALID_INPUT");
          await engine.remove({ purgeData: true });
        }
      } finally { unlock(); }
      break;
    }
    case "engine-upgrade":
    case "engine-rollback": {
      const engine = requireRecordedEngine(paths, runner);
      if (!(engine instanceof ManagedEngine) || desktopVersion !== undefined) throw new EngineError("ENGINE_UNAVAILABLE");
      const { upgradeEngineCommand } = await import("./engine/upgrade");
      const backup = await upgradeEngineCommand(paths, runner, engine, { yes: options.yes, version: options.version, rollback: options.command === "engine-rollback" });
      console.log(cliTranslate("Engine operation completed. Recovery files were retained at {path}.", { path: backup }));
      break;
    }
    case "resources-set":
      await resourcesSetCommand(paths, options, runner);
      break;
    case "update":
      {
        const workerJobId = updateWorkerJobId();
        if (workerJobId) await runUpdateWorker(paths, options, runner, workerJobId);
        else await durableUpdateCommand(paths, options);
      }
      break;
    case "stop":
      await runLifecycle(() => stopCommand(paths, runner));
      break;
    case "start":
      await runLifecycle(() => startCommand(paths, runner));
      break;
    case "logs":
      logsCommand(paths, runner, options);
      break;
    case "provider-login":
      await providerLoginCommand(paths, runner, options);
      break;
    case "provider-list":
      providerListCommand(paths, runner);
      break;
    case "provider-logout":
      providerLogoutCommand(paths, runner, options.providerId);
      break;
    case "provider-add":
      await providerAddCommand(paths, runner, options);
      break;
    case "provider-remove":
      if (!options.providerId) throw new CliError("Removing a provider requires its id");
      providerRemoveCommand(paths, runner, options.providerId);
      break;
    case "model":
      await modelCommand(paths);
      break;
    case "model-list":
      modelListCommand(paths, runner, options.providerId);
      break;
    case "model-use":
      await modelUseCommand(paths, runner, options);
      break;
    case "notifications-configure":
    case "notifications-status":
      await notificationsCommand(paths, options);
      break;
    case "account-update":
      await accountUpdateCommand(paths, runner, {
        username: options.username,
        password: options.password,
      });
      break;
    case "uninstall":
      await runLifecycle(() => uninstallCommand(paths, options, runner, { preserveCli: desktopVersion !== undefined }));
      break;
  }
  if (["install", "setup", "start", "update"].includes(options.command)) ensureUpdateAgent(paths);
  // A cancelled uninstall leaves the manifest as it was.
  if (
    options.command === "stop" ||
    (options.command === "uninstall" && (readManifest(paths)?.uninstalledAt ?? true))
  )
    stopUpdateAgent(paths);
};

main().catch((error) => {
  if (!(error instanceof CliError && error.reported)) {
    console.error(
      renderCommandError(errorMessage(error), {
        color: colorEnabled(process.env, Boolean(process.stderr.isTTY)),
        width: process.stderr.columns,
      })
    );
  }
  process.exitCode = error instanceof CliError ? error.exitCode : 1;
});
