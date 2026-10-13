import { Config, Context, Effect, Layer, Schema } from "effect"
import { FetchHttpClient, HttpBody, HttpClient, HttpClientRequest } from "effect/http"

export class ReviewerError extends Schema.TaggedError<ReviewerError>()("ReviewerError", {
  cause: Schema.Defect(),
}) {}

const WorkersAiResponse = Schema.Struct({
  result: Schema.Struct({ response: Schema.String }),
})

export class Reviewer extends Context.Service<
  Reviewer,
  {
    review: (diff: string) => Effect.Effect<string, ReviewerError>
  }
>()("review-agent/Reviewer") {
  static readonly layer = Layer.effect(
    Reviewer,
    Effect.gen(function* () {
      const accountId = yield* Config.String("CLOUDFLARE_ACCOUNT_ID")
      const token = yield* Config.Redacted("CLOUDFLARE_AI_TOKEN")
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(
          HttpClientRequest.prependUrl(
            `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run`,
          ),
        ),
        HttpClient.mapRequest(HttpClientRequest.bearerToken(token)),
        HttpClient.filterStatusOk,
      )

      const review = Effect.fn("review")(
        function* (diff: string) {
          const response = yield* client.post("/@cf/meta/llama-3.2-3b-instruct", {
            body: HttpBody.jsonUnsafe({
              messages: [
                {
                  role: "system",
                  content:
                    "You're a code reviewer, find critical bugs and issues, avoid nitpicks. I want this to properly formatted, First you tell the author how confident you are with the PR to be safely merged to root branch without causing any issues. Then you list you reviews based on criticality. And only list maximum 5 issues at a time. If you didn't find any issues you can add a approval comment",
                },
                { role: "user", content: diff },
              ],
              max_tokens: 512,
            }),
          })
          const json = yield* response.json
          const decoded = yield* Schema.decodeUnknownEffect(WorkersAiResponse)(json)
          return decoded.result.response
        },
        Effect.mapError((cause) => new ReviewerError({ cause })),
      )

      return Reviewer.of({
        review,
      })
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer))

  static readonly mock = Layer.succeed(
    Reviewer,
    Reviewer.of({
      review: (diff) =>
        Effect.succeed(`Fake review: this diff has ${diff.split("\n").length} lines look good`),
    }),
  )
}
