import { Layer, pipe } from "effect";
import { FetchHttpClient } from "effect/http";
import { BunChildProcessSpawner, BunFileSystem, BunPath } from "@effect/platform-bun";
import { CustomDomainsImpl } from "../modules/custom-domains/impl";
import { DeployerImpl } from "../modules/deployer/impl";
import { EasImpl } from "../modules/eas/impl";
import { ExpoImpl } from "../modules/expo/impl";
import { ExpoApiImpl } from "../modules/expo-api/impl";
import { PackageImpl } from "../modules/package/impl";
import { ProcessImpl } from "../modules/process/impl";
import { SigningCredentialsImpl } from "../modules/signing-credentials/impl";

/** Every module this abstract owns, composed most-dependent first. */
export const layerLive = pipe(
  DeployerImpl.Layer,
  Layer.provideMerge(CustomDomainsImpl.Layer),
  Layer.provideMerge(SigningCredentialsImpl.Layer),
  Layer.provideMerge(ExpoApiImpl.Layer),
  Layer.provideMerge(EasImpl.Layer),
  Layer.provideMerge(ExpoImpl.Layer),
  Layer.provideMerge(PackageImpl.Layer),
  Layer.provideMerge(ProcessImpl.Layer),
  Layer.provideMerge(FetchHttpClient.layer),
  Layer.provideMerge(BunChildProcessSpawner.layer),
  Layer.provideMerge(BunFileSystem.layer),
  Layer.provideMerge(BunPath.layer),
) satisfies Layer.Layer<any, any, never>;
