import { Data, type Option, type Schema } from "effect";
import type { EffectGen } from "effective-modules";

/** One entry of a GraphQL response's `errors`, with the classification Expo's API adds to it. */
export interface GraphqlError {
  readonly message: string;
  readonly errorCode: Option.Option<string>;
  /** `USER` when Expo attributes the error to the request: a rejected input, a missing permission or plan. */
  readonly errorType: Option.Option<string>;
}

/** Expo's API answered, and refused the operation. */
export class ExpoApiRejected extends Data.TaggedError("ExpoApiRejected")<{
  readonly operationName: string;
  readonly errors: ReadonlyArray<GraphqlError>;
}> {
  get description(): string {
    return `Expo's API refused ${this.operationName}: ${this.errors.map(({ message }) => message).join("; ")}`;
  }
}

/** The request could not be made (no token, no network) or its answer was unusable (not JSON, data of an unexpected shape). */
export class ExpoApiRequestFailed extends Data.TaggedError("ExpoApiRequestFailed")<{
  readonly operationName: string;
  readonly reason: string;
}> {
  get description(): string {
    return `${this.operationName} against Expo's API failed: ${this.reason}`;
  }
}

export type ExpoApiError = ExpoApiRejected | ExpoApiRequestFailed;

/**
 * Expo's GraphQL API, the one EAS CLI itself calls (https://api.expo.dev/graphql), for what EAS CLI has no
 * command for. Authenticates with `EXPO_TOKEN` as a bearer token, exactly as EAS CLI does.
 */
export interface IExpoApi {
  /** Runs one GraphQL operation and decodes its `data` with `data`. */
  graphql<S extends Schema.Top & { readonly DecodingServices: never }>(input: {
    readonly operationName: string;
    readonly document: string;
    readonly variables: Readonly<Record<string, unknown>>;
    readonly data: S;
  }): EffectGen<S["Type"], ExpoApiError>;
}
