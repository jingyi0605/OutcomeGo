import type { IpcMain, IpcMainInvokeEvent } from "electron";
import type {
  DeployProgress,
  LocalAutostartStatus,
  LocalServerStatus,
  SystemProxySnapshot,
} from "../renderer/lib/local-deploy-contract";
import {
  type LocalDeployManager,
  type localServiceArguments,
  validateContainersRequest,
  validateLogsRequest,
  validateProxyUpdate,
  validateResourceUpdate,
  validateRestartService,
} from "./local-deploy";

export const registerLocalDeployIpc = (options: {
  handle: IpcMain["handle"];
  requireAuthSender(event: IpcMainInvokeEvent): void;
  load(): Promise<{ manager: LocalDeployManager; localServiceArguments: typeof localServiceArguments }>;
  isSupported(): boolean;
  currentServer(): string | undefined;
  onProgress(event: IpcMainInvokeEvent, progress: DeployProgress): void;
  onServiceChanged?(state: LocalServerStatus["stack"]["state"]): void;
  onAutostartChanged?(status: LocalAutostartStatus): void;
  openLogsFolder?(directory: string): Promise<void>;
  detectSystemProxy?(): Promise<SystemProxySnapshot>;
}) => {
  const { handle, requireAuthSender, load } = options;

  handle("outcomego:local-deploy:start", async (event, ...args: unknown[]) => {
    requireAuthSender(event);
    if (args.length !== 1 || !options.isSupported()) throw new Error("INVALID_INPUT");
    const { manager } = await load();
    requireAuthSender(event);
    return manager.start(
      args[0],
      (progress) => options.onProgress(event, progress),
      options.currentServer()
    );
  });

  handle("outcomego:local-deploy:cancel", async (event, ...args: unknown[]) => {
    requireAuthSender(event);
    if (args.length !== 1) throw new Error("INVALID_INPUT");
    const { manager } = await load();
    requireAuthSender(event);
    await manager.cancel(args[0]);
  });

  handle("outcomego:local-deploy:engines", async (event, ...args: unknown[]) => {
    requireAuthSender(event);
    if (args.length || !options.isSupported()) throw new Error("INVALID_INPUT");
    const { manager } = await load();
    requireAuthSender(event);
    return manager.engines();
  });

  handle("outcomego:local-deploy:enable-wsl", async (event, ...args: unknown[]) => {
    requireAuthSender(event);
    if (args.length !== 1 || args[0] !== true || !options.isSupported()) throw new Error("INVALID_INPUT");
    const { manager } = await load();
    requireAuthSender(event);
    return manager.enableWsl(options.currentServer());
  });

  for (const action of ["status", "start", "stop", "remove", "diagnostics", "resources"] as const) {
    handle(`outcomego:local-server:${action}`, async (event, ...args: unknown[]) => {
      requireAuthSender(event);
      if (!options.isSupported()) throw new Error("INVALID_INPUT");
      const { manager, localServiceArguments } = await load();
      requireAuthSender(event);
      if (action === "status" || action === "diagnostics") {
        if (args.length) throw new Error("INVALID_INPUT");
        return manager[action]();
      }
      const command = action === "remove" ? "uninstall" : action;
      const result = await manager.service(
        command,
        localServiceArguments(command, args),
        options.currentServer()
      );
      options.onServiceChanged?.(result.stack.state);
      return result;
    });
  }

  handle("outcomego:local-server:restart", async (event, ...args: unknown[]) => {
    requireAuthSender(event);
    if (args.length > 1 || !options.isSupported()) throw new Error("INVALID_INPUT");
    const service = validateRestartService(args[0]);
    const { manager } = await load();
    requireAuthSender(event);
    const result = await manager.restart(service, options.currentServer());
    options.onServiceChanged?.(result.stack.state);
    return result;
  });

  handle("outcomego:local-server:containers", async (event, ...args: unknown[]) => {
    requireAuthSender(event);
    if (args.length > 1 || !options.isSupported()) throw new Error("INVALID_INPUT");
    const req = validateContainersRequest(args[0]);
    const { manager } = await load();
    requireAuthSender(event);
    return manager.containers(req, options.currentServer());
  });

  handle("outcomego:local-server:logs", async (event, ...args: unknown[]) => {
    requireAuthSender(event);
    if (args.length !== 1 || !options.isSupported()) throw new Error("INVALID_INPUT");
    const req = validateLogsRequest(args[0]);
    const { manager } = await load();
    requireAuthSender(event);
    return manager.logs(req, options.currentServer());
  });

  handle("outcomego:local-server:open-logs-folder", async (event, ...args: unknown[]) => {
    requireAuthSender(event);
    if (args.length || !options.isSupported()) throw new Error("INVALID_INPUT");
    const { manager } = await load();
    requireAuthSender(event);
    await options.openLogsFolder?.(manager.logsDirectory());
  });

  handle("outcomego:local-server:autostart-status", async (event, ...args: unknown[]) => {
    requireAuthSender(event);
    if (args.length || !options.isSupported()) throw new Error("INVALID_INPUT");
    const { manager } = await load();
    requireAuthSender(event);
    const result = await manager.autostartStatus(options.currentServer());
    options.onAutostartChanged?.(result);
    return result;
  });

  handle("outcomego:local-server:autostart-set", async (event, ...args: unknown[]) => {
    requireAuthSender(event);
    if (args.length !== 1 || typeof args[0] !== "boolean" || !options.isSupported()) {
      throw new Error("INVALID_INPUT");
    }
    const { manager } = await load();
    requireAuthSender(event);
    const result = await manager.setAutostart(args[0], options.currentServer());
    options.onAutostartChanged?.(result);
    return result;
  });

  handle("outcomego:local-server:resources-status", async (event, ...args: unknown[]) => {
    requireAuthSender(event);
    if (args.length || !options.isSupported()) throw new Error("INVALID_INPUT");
    const { manager } = await load();
    requireAuthSender(event);
    return manager.resourcesStatus(options.currentServer());
  });

  handle("outcomego:local-server:resources-update", async (event, ...args: unknown[]) => {
    requireAuthSender(event);
    if (args.length !== 1 || !options.isSupported()) throw new Error("INVALID_INPUT");
    const validated = validateResourceUpdate(args[0]);
    const { manager } = await load();
    requireAuthSender(event);
    const result = await manager.updateResources(validated, options.currentServer());
    const status = await manager.status().catch(() => null);
    if (status) options.onServiceChanged?.(status.stack.state);
    return result;
  });

  handle("outcomego:local-server:proxy-status", async (event, ...args: unknown[]) => {
    requireAuthSender(event);
    if (args.length || !options.isSupported()) throw new Error("INVALID_INPUT");
    const { manager } = await load();
    requireAuthSender(event);
    return manager.proxyStatus(options.currentServer());
  });

  handle("outcomego:local-server:system-proxy", async (event, ...args: unknown[]) => {
    requireAuthSender(event);
    if (args.length || !options.isSupported()) throw new Error("INVALID_INPUT");
    return (
      (await options.detectSystemProxy?.()) ?? {
        httpProxy: null,
        httpsProxy: null,
        noProxy: null,
      }
    );
  });

  handle("outcomego:local-server:proxy-save", async (event, ...args: unknown[]) => {
    requireAuthSender(event);
    if (args.length !== 1 || !options.isSupported()) throw new Error("INVALID_INPUT");
    const validated = validateProxyUpdate(args[0]);
    const { manager } = await load();
    requireAuthSender(event);
    const result = await manager.saveProxy(validated, options.currentServer());
    const status = await manager.status().catch(() => null);
    if (status) options.onServiceChanged?.(status.stack.state);
    return result;
  });

  handle("outcomego:local-server:proxy-test", async (event, ...args: unknown[]) => {
    requireAuthSender(event);
    if (args.length !== 1 || !options.isSupported()) throw new Error("INVALID_INPUT");
    const validated = validateProxyUpdate(args[0]);
    const { manager } = await load();
    requireAuthSender(event);
    return manager.testProxy(validated, options.currentServer());
  });
};
