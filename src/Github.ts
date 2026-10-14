import { Config, Context, Effect, Layer, Schema } from "effect"
import {
  FetchHttpClient,
  HttpBody,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http"
import { reviewableFiles } from "./reviewableFiles.ts"

export class GithubError extends Schema.TaggedError<GithubError>()("GithubError", {
  cause: Schema.Defect(),
}) {}

export const PullRequestFile = Schema.Struct({
  filename: Schema.String,
  status: Schema.String,
  patch: Schema.optional(Schema.String),
})

export type PullRequestFile = typeof PullRequestFile.Type

export class Github extends Context.Service<
  Github,
  {
    getPullRequestDiff(
      repo: string,
      prNo: number,
    ): Effect.Effect<ReadonlyArray<PullRequestFile>, GithubError>
    postComment(repo: string, prNo: number, body: string): Effect.Effect<void, GithubError>
  }
>()("review-agent/Github") {
  static readonly layer = Layer.effect(
    Github,
    Effect.gen(function* () {
      const token = yield* Config.Redacted("GITHUB_TOKEN")
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(HttpClientRequest.prependUrl("https://api.github.com")),
        HttpClient.mapRequest(HttpClientRequest.bearerToken(token)),
        HttpClient.mapRequest(HttpClientRequest.setHeader("user-agent", "review-agent")),
        HttpClient.filterStatusOk,
      )

      const getPullRequestDiff = Effect.fn("getPullRequestDiff")(
        function* (repo: string, prNo: number) {
          const response = yield* client.get(`/repos/${repo}/pulls/${prNo}/files`, {
            headers: {
              accept: "application/vnd.github.diff",
            },
          })
          const body = yield* response.json
          const rawFiles = yield* Schema.decodeUnknownEffect(Schema.Array(PullRequestFile))(body)
          const files = reviewableFiles(rawFiles)
          return files
        },
        Effect.mapError((cause) => new GithubError({ cause })),
      )

      const postComment = Effect.fn("postComment")(
        function* (repo: string, prNo: number, body: string) {
          yield* client.post(`/repos/${repo}/issues/${prNo}/comments`, {
            body: HttpBody.jsonUnsafe({ body }),
          })
        },
        Effect.mapError((cause) => new GithubError({ cause })),
      )

      return Github.of({ getPullRequestDiff, postComment })
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer))

  static readonly mockWithDiff = (diff: string) =>
    Layer.succeed(
      Github,
      Github.of({
        getPullRequestDiff: () =>
          Effect.succeed([{ filename: "hello.txt", patch: diff, status: "updated" }]),
        postComment: () => Effect.void,
      }),
    )

  static readonly fail = Layer.succeed(
    Github,
    Github.of({
      getPullRequestDiff: () => new GithubError({ cause: "failed test" }),
      postComment: () => new GithubError({ cause: "Post comment failed" }),
    }),
  )
}
