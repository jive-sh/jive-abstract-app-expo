import { Effect, Option, Schema, SchemaIssue, pipe } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { effunct, implementing, type EffectGen } from "effective-modules";
import { readExpoToken } from "../../common/expo-token";
import { appExpoModules } from "../index";
import { ExpoApiRejected, ExpoApiRequestFailed, type ExpoApiError, type IExpoApi } from "./interface";

/** Where EAS CLI sends its GraphQL requests (`createGraphqlClient` in eas-cli 25.3.0). */
export const EXPO_GRAPHQL_URL = "https://api.expo.dev/graphql";

const formatSchemaError = SchemaIssue.makeFormatterDefault();

/** A GraphQL response: `data`, `errors`, or both when part of an operation failed. */
const Envelope = Schema.Struct({
  data: Schema.OptionFromOptionalNullOr(Schema.Unknown),
  errors: Schema.OptionFromOptionalNullOr(Schema.Array(Schema.Struct({
    message: Schema.String,
    extensions: Schema.OptionFromOptionalNullOr(Schema.Struct({
      errorCode: Schema.OptionFromOptionalNullOr(Schema.String),
      errorType: Schema.OptionFromOptionalNullOr(Schema.String),
    })),
  }))),
});

export class ExpoApiImpl extends implementing(appExpoModules.ExpoApi).uses(HttpClient.HttpClient) implements IExpoApi {
  *graphql<S extends Schema.Top & { readonly DecodingServices: never }>(input: {
    readonly operationName: string;
    readonly document: string;
    readonly variables: Readonly<Record<string, unknown>>;
    readonly data: S;
  }): EffectGen<S["Type"], ExpoApiError> {
    const { operationName } = input;
    const failed = (reason: string) => new ExpoApiRequestFailed({ operationName, reason });
    const token = yield* pipe(effunct(readExpoToken)(), Effect.mapError(failed));

    const response = yield* pipe(
      HttpClientRequest.post(EXPO_GRAPHQL_URL),
      HttpClientRequest.bearerToken(token),
      HttpClientRequest.acceptJson,
      HttpClientRequest.bodyJson({ operationName, query: input.document, variables: input.variables }),
      Effect.flatMap((request) => this.getDependency(HttpClient.HttpClient).execute(request)),
      Effect.mapError((e) => failed(e.message)),
    );
    // Expo answers a refused operation with its reason in `errors`, sometimes under a 4xx status, so the body
    // is read before the status decides anything.
    const body = yield* pipe(response.json, Effect.mapError(() => failed(`HTTP ${response.status} with a body that is not JSON`)));
    const envelope = yield* pipe(
      Schema.decodeUnknownEffect(Envelope)(body),
      Effect.mapError((e) => failed(`HTTP ${response.status} with a body that is not a GraphQL response:\n${formatSchemaError(e.issue)}`)),
    );
    if (Option.isSome(envelope.errors) && envelope.errors.value.length > 0) {
      return yield* new ExpoApiRejected({
        operationName,
        errors: envelope.errors.value.map(({ message, extensions }) => ({
          message,
          errorCode: Option.flatMap(extensions, ({ errorCode }) => errorCode),
          errorType: Option.flatMap(extensions, ({ errorType }) => errorType),
        })),
      });
    }
    if (Option.isNone(envelope.data)) return yield* failed(`HTTP ${response.status} with neither data nor errors`);
    return yield* pipe(
      Schema.decodeUnknownEffect(input.data, { onExcessProperty: "ignore" })(envelope.data.value),
      Effect.mapError((e) => failed(`data of an unexpected shape:\n${formatSchemaError(e.issue)}`)),
    );
  }
}
