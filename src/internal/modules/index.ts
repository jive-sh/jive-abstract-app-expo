import { interfaces } from "effective-modules";
import type { IDeployer } from "./deployer/interface";
import type { IEas } from "./eas/interface";
import type { IExpo } from "./expo/interface";
import type { IPackage } from "./package/interface";
import type { IProcess } from "./process/interface";

export enum AppExpoModules {
  Process = "Process",
  Package = "Package",
  Expo = "Expo",
  Eas = "Eas",
  Deployer = "Deployer",
}

export const appExpoModules = interfaces<AppExpoModules, {
  Process: IProcess;
  Package: IPackage;
  Expo: IExpo;
  Eas: IEas;
  Deployer: IDeployer;
}>(AppExpoModules);
