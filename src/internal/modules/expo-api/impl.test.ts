import { afterAll, beforeAll, describe, expect, test as buntest } from "bun:test";
import { Effect, Layer, Option, Schema, pipe } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { effunct, type EffectGen } from "effective-modules";
import { AppExpoModules, appExpoModules } from "../index";
import { EXPO_GRAPHQL_URL, ExpoApiImpl } from "./impl";

/**
 * ExpoApiImpl against a fake HTTP client: it checks the request EAS CLI's own client would send (URL, bearer
 * token, GraphQL body) and how each kind of answer is classified. No request leaves the process.
 */

function test(name: string, body: () => EffectGen<void, any, never>) {
  buntest(name, async () => { await Effect.runPromise(effunct(body)()); });
}

interface SentRequest {
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

function withAnswer<A>(
  answer: { readonly status: number; readonly body: string },
  program: () => EffectGen<A, any, AppExpoModules.ExpoApi>,
) {
  const sent: Array<SentRequest> = [];
  const client = HttpClient.make((request, url) => Effect.sync(() => {
    const body = request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : undefined;
    sent.push({ url: url.href, authorization: request.headers["authorization"], body });
    return HttpClientResponse.fromWeb(request, new Response(answer.body, { status: answer.status }));
  }));
  return pipe(
    Effect.result(effunct(program)()),
    Effect.map((result) => ({ result, sent })),
    Effect.provide(pipe(ExpoApiImpl.Layer, Layer.provide(Layer.succeed(HttpClient.HttpClient, client)))),
  );
}

const query = function* () {
  return yield* (yield* appExpoModules.ExpoApi).graphql({
    operationName: "Probe",
    document: "query Probe($appId: String!) { app { byId(appId: $appId) { id } } }",
    variables: { appId: "project-1" },
    data: Schema.Struct({ app: Schema.Struct({ byId: Schema.Struct({ id: Schema.String }) }) }),
  });
};

let savedToken: string | undefined;
beforeAll(() => { savedToken = process.env["EXPO_TOKEN"]; process.env["EXPO_TOKEN"] = "test-token"; });
afterAll(() => { if (savedToken === undefined) delete process.env["EXPO_TOKEN"]; else process.env["EXPO_TOKEN"] = savedToken; });

describe("graphql", () => {
  test("posts the operation to Expo's GraphQL endpoint with the token as a bearer token, and decodes data", function* () {
    const { result, sent } = yield* withAnswer({ status: 200, body: JSON.stringify({ data: { app: { byId: { id: "project-1" } } } }) }, query);
    expect(result._tag === "Success" ? result.success : undefined).toEqual({ app: { byId: { id: "project-1" } } });
    expect(sent).toEqual([{
      url: EXPO_GRAPHQL_URL,
      authorization: "Bearer test-token",
      body: { operationName: "Probe", query: "query Probe($appId: String!) { app { byId(appId: $appId) { id } } }", variables: { appId: "project-1" } },
    }]);
  });

  test("reports GraphQL errors as a refusal with Expo's classification, even under a 4xx status", function* () {
    const errors = [{ message: "This feature requires a paid plan", extensions: { errorCode: "PLAN_REQUIRED", errorType: "USER" } }];
    const { result } = yield* withAnswer({ status: 400, body: JSON.stringify({ data: null, errors }) }, query);
    expect(result._tag).toBe("Failure");
    const failure = result._tag === "Failure" ? result.failure : undefined;
    expect(failure?._tag).toBe("ExpoApiRejected");
    expect(failure?._tag === "ExpoApiRejected" ? failure.errors : []).toEqual([
      { message: "This feature requires a paid plan", errorCode: Option.some("PLAN_REQUIRED"), errorType: Option.some("USER") },
    ]);
  });

  test("reports a body that is not JSON, and data of an unexpected shape, as a failed request", function* () {
    const notJson = yield* withAnswer({ status: 502, body: "<html>Bad gateway</html>" }, query);
    expect(notJson.result._tag === "Failure" ? notJson.result.failure.description : "").toContain("HTTP 502 with a body that is not JSON");
    const wrongShape = yield* withAnswer({ status: 200, body: JSON.stringify({ data: { app: null } }) }, query);
    expect(wrongShape.result._tag === "Failure" ? wrongShape.result.failure._tag : "").toBe("ExpoApiRequestFailed");
  });

  test("sends nothing without a token", function* () {
    delete process.env["EXPO_TOKEN"];
    const { result, sent } = yield* withAnswer({ status: 200, body: "{}" }, query);
    process.env["EXPO_TOKEN"] = "test-token";
    expect(result._tag === "Failure" ? result.failure.description : "").toContain("EXPO_TOKEN is not set");
    expect(sent).toEqual([]);
  });
});
