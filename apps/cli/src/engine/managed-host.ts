import { win32 } from "node:path";

export const MANAGED_ENGINE_NAME = "outcomego-engine";

export const supportsManagedHost = (platform: NodeJS.Platform, architecture: string, version: string) => {
  const [major = 0, minor = 0, build = 0] = version.split(".").map(Number);
  if (platform === "win32") return architecture === "x64" && major >= 10 && ((build >= 19045 && build < 22000) || build >= 22631);
  return platform === "darwin" && ["x64", "arm64"].includes(architecture) && (major > 22 || (major === 22 && minor >= 5));
};

export const windowsLocalPath = (path: string) => win32.normalize(path.replace(/^\\\\\?\\/, "")).replace(/[\\/]$/, "").toLowerCase();

export const wslPath = (path: string) => {
  const match = /^([a-z]):[\\/](.*)$/i.exec(win32.normalize(path));
  if (!match) throw new Error("A local Windows drive is required.");
  return `/mnt/${match[1]!.toLowerCase()}/${match[2]!.replaceAll("\\", "/")}`;
};

export const wslRegistrationPath = (output: string) => {
  const path = /^\s*BasePath\s+REG_SZ\s+([^\r\n]+)/im.exec(output.replaceAll("\0", ""))?.[1]?.trim();
  return path ? windowsLocalPath(path) : null;
};
