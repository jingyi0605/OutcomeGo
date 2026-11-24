import type { IpcMain, IpcMainInvokeEvent } from "electron";
import type { DeployProgress } from "../renderer/lib/local-deploy-contract";
import type { LocalDeployManager, localServiceArguments } from "./local-deploy";

export const registerLocalDeployIpc = (options: {
  handle: IpcMain["handle"];
  requireAuthSender(event: IpcMainInvokeEvent): void;
  load(): Promise<{ manager: LocalDeployManager; localServiceArguments: typeof localServiceArguments }>;
  isSupported(): boolean;
  currentServer(): string | undefined;
  onProgress(event: IpcMainInvokeEvent, progress: DeployProgress): void;
  onServiceChanged?(state: Awaited<ReturnType<LocalDeployManager["status"]>>["stack"]["state"]): void;
}) => {
  const { handle, requireAuthSender, load } = options;
  handle("outcomego:local-deploy:start", async (event, ...args: unknown[]) => {
    requireAuthSender(event);
    if (args.length !== 1 || !options.isSupported()) throw new Error("INVALID_INPUT");
    const { manager } = await load();
    requireAuthSender(event);
    return manager.start(args[0], progress => options.onProgress(event, progress), options.currentServer());
  });
  handle("outcomego:local-deploy:cancel", async (event, ...args: unknown[]) => {
    requireAuthSender(event);
    if (args.length !== 1) throw new Error("INVALID_INPUT");
    const { manager } = await load();
    requireAuthSender(event);
    await manager.cancel(args[0]);
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
      const result = await manager.service(command, localServiceArguments(command, args), options.currentServer());
      options.onServiceChanged?.(result.stack.state);
      return result;
    });
  }
};
