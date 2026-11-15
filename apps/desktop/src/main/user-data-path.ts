import { join } from "node:path";

export type ElectronAppPath = {
  isPackaged?: boolean;
  getPath(name: "appData" | "userData"): string;
  setPath(name: "userData", value: string): void;
};

export const outcomeGoUserDataPath = (appDataPath: string): string => join(appDataPath, "aiTeamOS");

export const pinOutcomeGoUserDataPath = (electronApp: ElectronAppPath): string => {
  if (electronApp.isPackaged === false) return electronApp.getPath("userData");
  const path = outcomeGoUserDataPath(electronApp.getPath("appData"));
  electronApp.setPath("userData", path);
  return path;
};
