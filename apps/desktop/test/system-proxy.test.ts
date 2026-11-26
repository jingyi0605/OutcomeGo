import { describe, expect, test } from "bun:test";
import {
  detectSystemProxy,
  parseElectronProxyResolution,
  parseScutilProxyOutput,
  parseWindowsInternetSettingsOutput,
} from "../src/main/system-proxy";

describe("system-proxy parsers", () => {
  test("parses Electron resolveProxy strings", () => {
    expect(parseElectronProxyResolution("DIRECT")).toBeNull();
    expect(parseElectronProxyResolution("PROXY 127.0.0.1:7890; DIRECT")).toBe("http://127.0.0.1:7890");
    expect(parseElectronProxyResolution("HTTPS proxy.corp.com:8443; DIRECT")).toBe("https://proxy.corp.com:8443");
    expect(parseElectronProxyResolution("SOCKS5 127.0.0.1:1080; DIRECT")).toBe("socks5://127.0.0.1:1080");
    expect(parseElectronProxyResolution("SOCKS 127.0.0.1:1081")).toBe("socks5://127.0.0.1:1081");
    expect(parseElectronProxyResolution("DIRECT; PROXY 10.0.0.2:8080")).toBe("http://10.0.0.2:8080");
  });

  test("parses macOS scutil --proxy output", () => {
    const sample = `<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
    1 : 169.254/16
  }
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7890
  HTTPSProxy : 127.0.0.1
  SOCKSEnable : 0
}`;
    expect(parseScutilProxyOutput(sample)).toEqual({
      httpProxy: "http://127.0.0.1:7890",
      httpsProxy: "http://127.0.0.1:7890",
      noProxy: "*.local,169.254/16",
    });
  });

  test("parses Windows Internet Settings JSON and reg output", () => {
    expect(
      parseWindowsInternetSettingsOutput(
        JSON.stringify({
          ProxyEnable: 1,
          ProxyServer: "127.0.0.1:7890",
          ProxyOverride: "localhost;127.*;*.corp.local;<local>",
        })
      )
    ).toEqual({
      httpProxy: "http://127.0.0.1:7890",
      httpsProxy: "http://127.0.0.1:7890",
      noProxy: "localhost,127.*,*.corp.local",
    });

    expect(
      parseWindowsInternetSettingsOutput(
        JSON.stringify({
          ProxyEnable: 1,
          ProxyServer: "http=127.0.0.1:8080;https=127.0.0.1:8443;socks=127.0.0.1:1080",
          ProxyOverride: "",
        })
      )
    ).toEqual({
      httpProxy: "http://127.0.0.1:8080",
      httpsProxy: "http://127.0.0.1:8443",
      noProxy: null,
    });

    expect(
      parseWindowsInternetSettingsOutput(
        JSON.stringify({ ProxyEnable: 0, ProxyServer: "127.0.0.1:7890" })
      )
    ).toEqual({ httpProxy: null, httpsProxy: null, noProxy: null });
  });

  test("detectSystemProxy merges Electron resolveProxy with platform noProxy", async () => {
    const result = await detectSystemProxy({
      platform: "darwin",
      resolveProxy: async () => "PROXY 127.0.0.1:7897; DIRECT",
      runCommand: async () =>
        "ExceptionsList : <array> {\n  0 : *.corp.local\n}\nHTTPEnable : 0\n",
    });
    expect(result).toEqual({
      httpProxy: "http://127.0.0.1:7897",
      httpsProxy: "http://127.0.0.1:7897",
      noProxy: "*.corp.local",
    });
  });
});
