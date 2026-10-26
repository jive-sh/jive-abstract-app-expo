import type { Layer } from "effect";
import { makeCicdCommandFactory, type CicdCommandFactory } from "jive-abstract-library";
import { layerLive } from "./layer";

/** Every hook runs against this abstract's whole module graph, platform services included. */
export const { makeCicdCommand, makePipelineCommand, makeDeployCommand, makeDeployPlanCommand }: CicdCommandFactory<Layer.Success<typeof layerLive>> =
  makeCicdCommandFactory(layerLive);
