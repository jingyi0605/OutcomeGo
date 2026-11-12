import { join } from "node:path";

export type ElectronAppPath = {
  getPath(name: "appData"): string;
  setPath(name: "userData", value: string): void;
};

export const outcomeGoUserDataPath = (appDataPath: string): string => join(appDataPath, "aiTeamOS");

export const pinOutcomeGoUserDataPath = (electronApp: ElectronAppPath): string => {
  const path = outcomeGoUserDataPath(electronApp.getPath("appData"));
  electronApp.setPath("userData", path);
  return path;
};
