import { Layer, pipe } from "effect";
import { BunChildProcessSpawner, BunFileSystem, BunPath } from "@effect/platform-bun";
import { DeployerImpl } from "../modules/deployer/impl";
import { EasImpl } from "../modules/eas/impl";
import { ExpoImpl } from "../modules/expo/impl";
import { PackageImpl } from "../modules/package/impl";
import { ProcessImpl } from "../modules/process/impl";

/** Every module this abstract owns, composed most-dependent first. */
export const layerLive = pipe(
  DeployerImpl.Layer,
  Layer.provideMerge(EasImpl.Layer),
  Layer.provideMerge(ExpoImpl.Layer),
  Layer.provideMerge(PackageImpl.Layer),
  Layer.provideMerge(ProcessImpl.Layer),
  Layer.provideMerge(BunChildProcessSpawner.layer),
  Layer.provideMerge(BunFileSystem.layer),
  Layer.provideMerge(BunPath.layer),
) satisfies Layer.Layer<any, any, never>;
