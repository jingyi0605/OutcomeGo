import { spawn } from "node:child_process";
import { closeSync, lstatSync, mkdirSync, openSync, readSync } from "node:fs";
import { join, win32 } from "node:path";
import { clearDeployState, readDeployState, writeDeployState } from "../deploy-state";
import { cliTranslate } from "../localization";
import { ManagedEngine, type EngineStartOptions, type ManagedOptions } from "./managed";
import { MANAGED_ENGINE_NAME, supportsManagedHost, windowsLocalPath, wslPath } from "./managed-host";
import { EngineError, type EngineDetection } from "./types";

const system = (program: string) => win32.join(process.env.SystemRoot || "C:\\Windows", "System32", program);
const output = (value: string) => value.replace(/^\uFEFF/, "").replaceAll("\0", "");
const wsl = system("wsl.exe");
const powershell = system("WindowsPowerShell\\v1.0\\powershell.exe");
const registrationQuery = "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $ErrorActionPreference='Stop'; $key='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss'; if (Test-Path -LiteralPath $key) { Get-ChildItem -LiteralPath $key | Get-ItemProperty | Where-Object { $_.DistributionName -eq 'outcomego-engine' } | Select-Object BasePath,Version | ConvertTo-Json -Compress }";
const optionalFeaturesQuery = "$features=@(Get-CimInstance Win32_OptionalFeature -Filter \"Name='Microsoft-Windows-Subsystem-Linux' OR Name='VirtualMachinePlatform'\"); if ($features.Count -lt 2 -or @($features | Where-Object InstallState -ne 1).Count -gt 0) { 'disabled' } else { 'enabled' }";
const missingFeature = /0x8007019e|WSL_E_WSL_OPTIONAL_COMPONENT_REQUIRED|WSL_E_WSL_NOT_INSTALLED/i;
const networkingProbe = "/usr/bin/wslinfo";

export class ManagedWslEngine extends ManagedEngine {
  override readonly kind = "managed-wsl";
  private readonly data: string;
  protected override assetNames = ["outcomego-engine-windows-x64.tar.gz"];
  constructor(options: ManagedOptions & { keepAlive?: (command: string, args: readonly string[]) => void }) {
    super(options);
    this.data = win32.join(options.paths.directory, "engine", "wsl");
    this.keepAlive = options.keepAlive ?? ((command, args) => {
      const child = spawn(command, [...args], { detached: true, windowsHide: true, stdio: "ignore" });
      (child as unknown as NodeJS.EventEmitter).once("error", () => undefined);
      child.unref();
    });
  }

  private readonly keepAlive: (command: string, args: readonly string[]) => void;
  private runWsl(args: readonly string[]) { return this.runner.run(wsl, args, { timeoutMs: 15_000 }); }

  private registration(): "missing" | "owned" | "foreign" | "unknown" | "wrong-version" {
    const result = this.runner.run(powershell, ["-NoProfile", "-NonInteractive", "-Command", registrationQuery], { timeoutMs: 8_000 });
    if (result.status !== 0) return "unknown";
    const registration = result.stdout.trim();
    if (!registration) return "missing";
    try {
      const value = JSON.parse(registration);
      if (typeof value?.BasePath !== "string" || typeof value.Version !== "number") return "unknown";
      if (windowsLocalPath(value.BasePath) !== windowsLocalPath(this.data)) return "foreign";
      return value.Version === 2 ? "owned" : "wrong-version";
    } catch { return "unknown"; }
  }

  protected override owned() { return supportsManagedHost("win32", this.options.architecture, this.options.release) && this.registration() === "owned"; }
  override guestPath(path: string) { return wslPath(path); }
  protected override guest(args: readonly string[], cwd?: string) {
    const env = { ...process.env };
    delete env.WSLENV;
    const command = args[0] === "/usr/bin/env"
      ? ["/bin/sh", "-c", `[ "$(${networkingProbe} --networking-mode)" = nat ] || exit 2; exec "$@"`, "outcomego-engine", ...args]
      : args;
    return { command: wsl, args: ["--distribution", MANAGED_ENGINE_NAME, "--user", "root", ...(cwd ? ["--cd", cwd] : []), "--exec", ...command], env };
  }

  private hasNatNetwork() {
    const { args } = this.guest([networkingProbe, "--networking-mode"]);
    const result = this.runWsl(args);
    return result.status === 0 && output(result.stdout).trim() === "nat";
  }

  private networkIssue() {
    return this.blocked("ENGINE_INCOMPATIBLE", "unsupported", cliTranslate("The managed WSL engine requires NAT networking. Use an existing container engine or server if NAT is unavailable."));
  }

  override async detect(): Promise<EngineDetection> {
    if (!supportsManagedHost("win32", this.options.architecture, this.options.release)) return this.blocked("WINDOWS_UNSUPPORTED", "unsupported", cliTranslate("Managed deployment requires Windows x64 (Windows 10 22H2 or Windows 11 23H2 or later). Connect to an existing server on unsupported hardware."));
    const status = this.runWsl(["--status"]);
    const features = this.runner.run(powershell, ["-NoProfile", "-NonInteractive", "-Command", optionalFeaturesQuery], { timeoutMs: 8_000 });
    if (features.status === 0 && output(features.stdout).trim() === "disabled") {
      const virtualization = this.runner.run(powershell, ["-NoProfile", "-NonInteractive", "-Command", "$hostInfo=Get-CimInstance Win32_ComputerSystem; $cpu=Get-CimInstance Win32_Processor; if ($hostInfo.HypervisorPresent -eq $false -and $cpu.VirtualizationFirmwareEnabled -contains $false) { 'disabled' }"], { timeoutMs: 8_000 });
      if (virtualization.status === 0 && output(virtualization.stdout).trim() === "disabled") return this.blocked("VIRTUALIZATION_DISABLED", "unsupported", cliTranslate("Enable virtualization in your firmware, then retry."));
      if (readDeployState(this.options.paths)?.awaiting === "reboot") return this.blocked("REBOOT_REQUIRED", "needs-setup", cliTranslate("Restart your computer, then reopen OutcomeGo to continue deployment."));
      return this.blocked("WSL_NOT_ENABLED", "needs-setup", cliTranslate("Enable WSL before deploying the managed engine."));
    }
    if (status.status !== 0) {
      const virtualization = this.runner.run(powershell, ["-NoProfile", "-NonInteractive", "-Command", "$hostInfo=Get-CimInstance Win32_ComputerSystem; $cpu=Get-CimInstance Win32_Processor; if ($hostInfo.HypervisorPresent -eq $false -and $cpu.VirtualizationFirmwareEnabled -contains $false) { 'disabled' }"], { timeoutMs: 8_000 });
      if (virtualization.status === 0 && output(virtualization.stdout).trim() === "disabled") return this.blocked("VIRTUALIZATION_DISABLED", "unsupported", cliTranslate("Enable virtualization in your firmware, then retry."));
      if (readDeployState(this.options.paths)?.awaiting === "reboot") return this.blocked("REBOOT_REQUIRED", "needs-setup", cliTranslate("Restart your computer, then reopen OutcomeGo to continue deployment."));
      if (missingFeature.test(output(`${status.stderr}\n${status.stdout}`)) || (status.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT")
        return this.blocked("WSL_NOT_ENABLED", "needs-setup", cliTranslate("Enable WSL before deploying the managed engine."));
      return this.blocked("ENGINE_UNAVAILABLE", "unsupported", cliTranslate("Windows could not report the WSL status."));
    }
    const registration = this.registration();
    if (registration === "wrong-version") return this.blocked("ENGINE_INCOMPATIBLE", "unsupported", cliTranslate("The managed engine requires WSL 2."));
    if (registration === "unknown" || registration === "foreign") return this.blocked("ENGINE_UNAVAILABLE", "unsupported", cliTranslate("The managed engine could not verify ownership of outcomego-engine."));
    if (registration === "missing") return { state: "needs-setup", reasons: [] };
    const running = this.runWsl(["--list", "--running", "--quiet"]);
    if (running.status !== 0 || !output(running.stdout).split(/\r?\n/).some(line => line.trim().toLowerCase() === MANAGED_ENGINE_NAME)) return { state: "stopped", reasons: [] };
    return this.hasNatNetwork() ? super.detect() : this.networkIssue();
  }

  override async ensureReady(_onEvent?: (message: string) => void, { signal, assets }: EngineStartOptions = {}) {
    const detection = await this.detect();
    if (detection.code || detection.state === "unsupported") throw new EngineError(detection.code ?? "ENGINE_INCOMPATIBLE", detection.reasons.join(" "));
    if (detection.state === "needs-setup") {
      const [asset] = assets ?? await this.engineAssets(this.assetNames, signal);
      if (!asset) throw new EngineError("ASSET_VERIFICATION_FAILED");
      if (this.registration() !== "missing") throw new EngineError("ENGINE_UNAVAILABLE");
      mkdirSync(this.data, { recursive: true, mode: 0o700 });
      await this.invoke({ command: wsl, args: ["--import", MANAGED_ENGINE_NAME, this.data, asset, "--version", "2"], env: process.env }, signal);
    }
    if (!this.owned()) throw new EngineError("ENGINE_UNAVAILABLE");
    if (detection.state !== "ready") {
      if (!this.hasNatNetwork()) throw new EngineError("ENGINE_INCOMPATIBLE", this.networkIssue().reasons.join(" "));
      await this.invoke(this.guest(["/usr/bin/systemctl", "start", "docker.service"]), signal);
      await this.waitForDocker(signal);
    }
    const keep = this.guest(["/usr/bin/flock", "-n", "/run/outcomego-keepalive.lock", "/bin/sleep", "infinity"]);
    this.keepAlive(keep.command, keep.args);
  }

  override async stop() {
    if (!this.owned()) throw new EngineError("ENGINE_UNAVAILABLE");
    this.checkOperation(this.runWsl(["--terminate", MANAGED_ENGINE_NAME]));
  }

  override async remove({ purgeData }: { purgeData: boolean }) {
    if (!purgeData) throw new EngineError("INVALID_INPUT");
    const registration = this.registration();
    if (registration === "missing") return;
    if (registration !== "owned" || !this.owned()) throw new EngineError("ENGINE_UNAVAILABLE");
    this.checkOperation(this.runWsl(["--unregister", MANAGED_ENGINE_NAME]));
  }

  private checkpointFile(directory: string, verify: boolean) {
    const file = join(directory, "wsl.vhdx");
    if (verify) {
      if (!lstatSync(file, { throwIfNoEntry: false })?.isFile()) throw new EngineError("ENGINE_START_FAILED");
      const handle = openSync(file, "r");
      const header = Buffer.alloc(8);
      try {
        if (readSync(handle, header, 0, header.length, 0) !== 8 || header.toString() !== "vhdxfile") throw new EngineError("ENGINE_START_FAILED");
      } finally { closeSync(handle); }
    }
    return file;
  }

  override async checkpoint(directory: string) {
    await this.stop();
    await this.invoke({ command: wsl, args: ["--export", MANAGED_ENGINE_NAME, this.checkpointFile(directory, false), "--vhd"], env: process.env });
    this.checkpointFile(directory, true);
  }

  override async replaceEngine(directory: string) {
    this.checkpointFile(directory, true);
    await this.remove({ purgeData: true });
  }

  override async restoreEngine(directory: string) {
    const source = this.checkpointFile(directory, true);
    const registration = this.registration();
    if (registration === "owned") await this.remove({ purgeData: true });
    else if (registration !== "missing") throw new EngineError("ENGINE_UNAVAILABLE");
    mkdirSync(this.data, { recursive: true, mode: 0o700 });
    await this.invoke({ command: wsl, args: ["--import", MANAGED_ENGINE_NAME, this.data, source, "--vhd", "--version", "2"], env: process.env });
  }

  async enable() {
    const pending = readDeployState(this.options.paths);
    if (!pending || pending.awaiting !== "elevation") throw new EngineError("INVALID_INPUT");
    const detection = await this.detect();
    if (!detection.code) { clearDeployState(this.options.paths); return; }
    if (detection.code !== "WSL_NOT_ENABLED") throw new EngineError(detection.code);
    const result = this.runner.run(powershell, ["-NoProfile", "-NonInteractive", "-Command",
      "try { $p=Start-Process -Verb RunAs -FilePath (Join-Path $env:SystemRoot 'System32\\wsl.exe') -ArgumentList @('--install','--no-distribution') -Wait -PassThru -ErrorAction Stop; exit $p.ExitCode } catch { if ($_.Exception.NativeErrorCode -eq 1223) { exit 1223 }; exit 1 }"], { timeoutMs: 300_000 });
    if (result.status === 1223) throw new EngineError("ELEVATION_DENIED");
    if (result.status !== 0 && result.status !== 3010) throw new EngineError("ENGINE_START_FAILED");
    if (result.status === 3010 || (await this.detect()).code === "WSL_NOT_ENABLED") {
      writeDeployState(this.options.paths, { ...pending, awaiting: "reboot" });
      throw new EngineError("REBOOT_REQUIRED");
    }
    clearDeployState(this.options.paths);
  }
}
