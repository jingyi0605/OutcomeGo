import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SystemProxySnapshot } from "../renderer/lib/local-deploy-contract";

const execFileAsync = promisify(execFile);

const redactProxyUrl = (raw: string | null): string | null => {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.password) {
      parsed.password = "REDACTED";
      return parsed.toString().replace(/\/$/, "").replace(":REDACTED@", ":[REDACTED]@");
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
};

export const parseElectronProxyResolution = (raw: string): string | null => {
  if (!raw || typeof raw !== "string") return null;
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (!trimmed || /^DIRECT$/i.test(trimmed)) continue;
    const match = /^(PROXY|HTTP|HTTPS|SOCKS5|SOCKS4|SOCKS)\s+([^\s;]+)$/i.exec(trimmed);
    if (!match) continue;
    const scheme = match[1]!.toUpperCase();
    const target = match[2]!;
    const protocol =
      scheme === "SOCKS5" || scheme === "SOCKS"
        ? "socks5"
        : scheme === "HTTPS"
          ? "https"
          : "http";
    const candidate = `${protocol}://${target}`;
    const validated = redactProxyUrl(candidate);
    if (validated) return validated;
  }
  return null;
};

export const parseScutilProxyOutput = (stdout: string): SystemProxySnapshot => {
  const values = new Map<string, string>();
  const exceptions: string[] = [];
  let inExceptions = false;

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^ExceptionsList\s*:\s*<array>/.test(trimmed)) {
      inExceptions = true;
      continue;
    }
    if (inExceptions) {
      if (trimmed === "}") {
        inExceptions = false;
        continue;
      }
      const item = /^\d+\s*:\s*(.+)$/.exec(trimmed);
      if (item?.[1]) exceptions.push(item[1].trim());
      continue;
    }
    const kv = /^([A-Za-z0-9_]+)\s*:\s*(.+)$/.exec(trimmed);
    if (kv?.[1] && kv[2]) {
      values.set(kv[1], kv[2].trim());
    }
  }

  const build = (protocol: "http" | "https" | "socks5", hostKey: string, portKey: string, enableKey: string) => {
    if (values.get(enableKey) !== "1") return null;
    const host = values.get(hostKey);
    const port = values.get(portKey);
    if (!host || !port || !/^\d+$/.test(port)) return null;
    return redactProxyUrl(`${protocol}://${host}:${port}`);
  };

  const socks = build("socks5", "SOCKSProxy", "SOCKSPort", "SOCKSEnable");
  const httpProxy = build("http", "HTTPProxy", "HTTPPort", "HTTPEnable") ?? socks;
  const httpsProxy = build("http", "HTTPSProxy", "HTTPSPort", "HTTPSEnable") ?? httpProxy ?? socks;
  return {
    httpProxy,
    httpsProxy,
    noProxy: exceptions.length ? exceptions.join(",") : null,
  };
};

export const parseWindowsInternetSettingsOutput = (stdout: string): SystemProxySnapshot => {
  let proxyEnable = false;
  let proxyServer = "";
  let proxyOverride = "";

  const trimmed = stdout.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      proxyEnable = parsed.ProxyEnable === 1 || parsed.ProxyEnable === true || parsed.ProxyEnable === "1";
      proxyServer = typeof parsed.ProxyServer === "string" ? parsed.ProxyServer.trim() : "";
      proxyOverride = typeof parsed.ProxyOverride === "string" ? parsed.ProxyOverride.trim() : "";
    } catch {
      return { httpProxy: null, httpsProxy: null, noProxy: null };
    }
  } else {
    for (const line of stdout.split(/\r?\n/)) {
      const match = /^\s*(ProxyEnable|ProxyServer|ProxyOverride)\s+REG_\w+\s+(.+)$/i.exec(line);
      if (!match) continue;
      const key = match[1]!.toLowerCase();
      const val = match[2]!.trim();
      if (key === "proxyenable") proxyEnable = val === "0x1" || val === "1";
      if (key === "proxyserver") proxyServer = val;
      if (key === "proxyoverride") proxyOverride = val;
    }
  }

  if (!proxyEnable || !proxyServer) {
    return { httpProxy: null, httpsProxy: null, noProxy: null };
  }

  let httpProxy: string | null = null;
  let httpsProxy: string | null = null;
  let socksProxy: string | null = null;

  if (proxyServer.includes("=")) {
    for (const entry of proxyServer.split(";")) {
      const sep = entry.indexOf("=");
      if (sep <= 0) continue;
      const scheme = entry.slice(0, sep).trim().toLowerCase();
      const hostPort = entry.slice(sep + 1).trim();
      if (!hostPort) continue;
      if (scheme === "http") httpProxy = redactProxyUrl(hostPort.includes("://") ? hostPort : `http://${hostPort}`);
      else if (scheme === "https") httpsProxy = redactProxyUrl(hostPort.includes("://") ? hostPort : `http://${hostPort}`);
      else if (scheme === "socks" || scheme === "socks5") {
        socksProxy = redactProxyUrl(hostPort.includes("://") ? hostPort : `socks5://${hostPort}`);
      }
    }
  } else {
    const normalized = redactProxyUrl(
      proxyServer.includes("://") ? proxyServer : `http://${proxyServer}`
    );
    httpProxy = normalized;
    httpsProxy = normalized;
  }

  const noProxyList = proxyOverride
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter((item) => item && item.toLowerCase() !== "<local>");

  return {
    httpProxy: httpProxy ?? socksProxy,
    httpsProxy: httpsProxy ?? httpProxy ?? socksProxy,
    noProxy: noProxyList.length ? noProxyList.join(",") : null,
  };
};

export const detectSystemProxy = async (options: {
  resolveProxy?: (url: string) => Promise<string>;
  platform?: NodeJS.Platform;
  runCommand?: (command: string, args: readonly string[]) => Promise<string>;
} = {}): Promise<SystemProxySnapshot> => {
  const currentPlatform = options.platform ?? process.platform;
  const runCmd =
    options.runCommand ??
    (async (command: string, args: readonly string[]) => {
      const { stdout } = await execFileAsync(command, [...args], {
        timeout: 4_000,
        windowsHide: true,
      });
      return stdout;
    });

  let resolvedHttp: string | null = null;
  let resolvedHttps: string | null = null;
  if (options.resolveProxy) {
    try {
      const [httpsRaw, httpRaw] = await Promise.all([
        options.resolveProxy("https://api.deepseek.com").catch(() => "DIRECT"),
        options.resolveProxy("http://api.deepseek.com").catch(() => "DIRECT"),
      ]);
      resolvedHttps = parseElectronProxyResolution(httpsRaw);
      resolvedHttp = parseElectronProxyResolution(httpRaw);
    } catch {}
  }

  let osSnapshot: SystemProxySnapshot = { httpProxy: null, httpsProxy: null, noProxy: null };
  try {
    if (currentPlatform === "darwin") {
      const stdout = await runCmd("/usr/sbin/scutil", ["--proxy"]);
      osSnapshot = parseScutilProxyOutput(stdout);
    } else if (currentPlatform === "win32") {
      const stdout = await runCmd("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' | Select-Object ProxyEnable,ProxyServer,ProxyOverride | ConvertTo-Json -Compress",
      ]);
      osSnapshot = parseWindowsInternetSettingsOutput(stdout);
    }
  } catch {}

  const httpProxy = resolvedHttp ?? osSnapshot.httpProxy ?? resolvedHttps ?? osSnapshot.httpsProxy;
  const httpsProxy = resolvedHttps ?? osSnapshot.httpsProxy ?? resolvedHttp ?? osSnapshot.httpProxy;
  return {
    httpProxy,
    httpsProxy,
    noProxy: osSnapshot.noProxy,
  };
};
