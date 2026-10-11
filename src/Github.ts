import { Context, Effect, Layer, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"

export class GithubError extends Schema.TaggedError<GithubError>()("GithubError", {
  cause: Schema.Defect(),
}) {}

export class Github extends Context.Service<
  Github,
  {
    getPullRequestDiff(repo: string, prNo: number): Effect.Effect<string, GithubError>
  }
>()("review-agent/Github") {
  static readonly layer = Layer.effect(
    Github,
    Effect.gen(function* () {
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(HttpClientRequest.prependUrl("https://api.github.com")),
        HttpClient.filterStatusOk,
      )

      const getPullRequestDiff = Effect.fn("getPullRequestDiff")(
        function* (repo: string, prNo: number) {
          const response = yield* client.get(`/repos/${repo}/pulls/${prNo}`, {
            headers: {
              "user-agent": "review-agent",
              accept: "application/vnd.github.diff",
            },
          })
          return yield* response.text
        },
        Effect.mapError((cause) => new GithubError({ cause })),
      )

      return Github.of({ getPullRequestDiff })
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer))

  static readonly mock = Layer.succeed(
    Github,
    Github.of({
      getPullRequestDiff: () => Effect.succeed("line1\nline2"),
    }),
  )

  static readonly fail = Layer.succeed(
    Github,
    Github.of({
      getPullRequestDiff: () => new GithubError({ cause: "failed test" }),
    }),
  )
}
