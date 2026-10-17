import { Config, Context, Effect, Layer, Option, Schema } from "effect"
import {
  FetchHttpClient,
  HttpBody,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http"

export class GithubError extends Schema.TaggedError<GithubError>()("GithubError", {
  cause: Schema.Defect(),
}) {}

export const PullRequestFile = Schema.Struct({
  filename: Schema.String,
  status: Schema.String,
  patch: Schema.optional(Schema.String),
})

export type PullRequestFile = typeof PullRequestFile.Type

export const PullRequest = Schema.Struct({
  state: Schema.String,
  head: Schema.Struct({ sha: Schema.String }),
})

export type PullRequest = typeof PullRequest.Type

export interface ReviewInput {
  /** The PR head sha the comment line numbers refer to */
  readonly commitId: string
  readonly body: string
  readonly comments: ReadonlyArray<{ path: string; line: number; body: string }>
}

export class Github extends Context.Service<
  Github,
  {
    getPullRequestDiff(
      repo: string,
      prNo: number,
    ): Effect.Effect<ReadonlyArray<PullRequestFile>, GithubError>
    getPullRequest(repo: string, prNo: number): Effect.Effect<PullRequest, GithubError>
    createReview(repo: string, prNo: number, review: ReviewInput): Effect.Effect<void, GithubError>
    /** The repo's README at `ref`, or none when the repo has no README */
    getReadme(repo: string, ref: string): Effect.Effect<Option.Option<string>, GithubError>
  }
>()("review-agent/Github") {
  static readonly layer = Layer.effect(
    Github,
    Effect.gen(function* () {
      const token = yield* Config.Redacted("GITHUB_TOKEN")
      const baseClient = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(HttpClientRequest.prependUrl("https://api.github.com")),
        HttpClient.mapRequest(HttpClientRequest.bearerToken(token)),
        HttpClient.mapRequest(HttpClientRequest.setHeader("user-agent", "review-agent")),
      )
      const client = baseClient.pipe(HttpClient.filterStatusOk)

      const getPullRequestDiff = Effect.fn("getPullRequestDiff")(
        function* (repo: string, prNo: number) {
          const response = yield* client.get(`/repos/${repo}/pulls/${prNo}/files`, {
            urlParams: { per_page: 100 },
          })
          const body = yield* response.json
          return yield* Schema.decodeUnknownEffect(Schema.Array(PullRequestFile))(body)
        },
        Effect.mapError((cause) => new GithubError({ cause })),
      )

      const getPullRequest = Effect.fn("getPullRequest")(
        function* (repo: string, prNo: number) {
          const response = yield* client.get(`/repos/${repo}/pulls/${prNo}`)
          const body = yield* response.json
          return yield* Schema.decodeUnknownEffect(PullRequest)(body)
        },
        Effect.mapError((cause) => new GithubError({ cause })),
      )

      // A review carries the overall comment plus every inline comment in one request
      const createReview = Effect.fn("createReview")(
        function* (repo: string, prNo: number, review: ReviewInput) {
          yield* client.post(`/repos/${repo}/pulls/${prNo}/reviews`, {
            body: HttpBody.jsonUnsafe({
              commit_id: review.commitId,
              event: "COMMENT",
              body: review.body,
              comments: review.comments.map((c) => ({ ...c, side: "RIGHT" })),
            }),
          })
        },
        Effect.mapError((cause) => new GithubError({ cause })),
      )

      // The /readme endpoint finds the README whatever its case or extension
      const getReadme = Effect.fn("getReadme")(
        function* (repo: string, ref: string) {
          const response = yield* baseClient.get(`/repos/${repo}/readme`, {
            urlParams: { ref },
            headers: { accept: "application/vnd.github.raw+json" },
          })
          if (response.status === 404) return Option.none()
          const ok = yield* HttpClientResponse.filterStatusOk(response)
          return Option.some(yield* ok.text)
        },
        Effect.mapError((cause) => new GithubError({ cause })),
      )

      return Github.of({ getPullRequestDiff, getPullRequest, createReview, getReadme })
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer))

  static readonly mockWithDiff = (diff: string) =>
    Layer.succeed(
      Github,
      Github.of({
        getPullRequestDiff: () =>
          Effect.succeed([{ filename: "hello.txt", patch: diff, status: "updated" }]),
        getPullRequest: () => Effect.succeed({ state: "open", head: { sha: "abc123" } }),
        createReview: () => Effect.void,
        getReadme: () => Effect.succeed(Option.none()),
      }),
    )

  static readonly fail = Layer.succeed(
    Github,
    Github.of({
      getPullRequestDiff: () => new GithubError({ cause: "failed test" }),
      getPullRequest: () => new GithubError({ cause: "Get pull request failed" }),
      createReview: () => new GithubError({ cause: "Create review failed" }),
      getReadme: () => new GithubError({ cause: "Get readme failed" }),
    }),
  )
}
