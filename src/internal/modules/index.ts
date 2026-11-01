import { interfaces } from "effective-modules";
import type { ICustomDomains } from "./custom-domains/interface";
import type { IDeployer } from "./deployer/interface";
import type { IEas } from "./eas/interface";
import type { IExpo } from "./expo/interface";
import type { IExpoApi } from "./expo-api/interface";
import type { IPackage } from "./package/interface";
import type { IProcess } from "./process/interface";
import type { ISigningCredentials } from "./signing-credentials/interface";

export enum AppExpoModules {
  Process = "Process",
  Package = "Package",
  Expo = "Expo",
  Eas = "Eas",
  ExpoApi = "ExpoApi",
  CustomDomains = "CustomDomains",
  SigningCredentials = "SigningCredentials",
  Deployer = "Deployer",
}

export const appExpoModules = interfaces<AppExpoModules, {
  Process: IProcess;
  Package: IPackage;
  Expo: IExpo;
  Eas: IEas;
  ExpoApi: IExpoApi;
  CustomDomains: ICustomDomains;
  SigningCredentials: ISigningCredentials;
  Deployer: IDeployer;
}>(AppExpoModules);
