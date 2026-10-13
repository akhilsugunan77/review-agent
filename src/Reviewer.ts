import { Config, Context, Effect, Layer, Schema } from "effect"
import { FetchHttpClient, HttpBody, HttpClient, HttpClientRequest } from "effect/http"

export class ReviewerError extends Schema.TaggedError<ReviewerError>()("ReviewerError", {
  cause: Schema.Defect(),
}) {}

const WorkersAiResponse = Schema.Struct({
  result: Schema.Struct({ response: Schema.String }),
})

const systemPrompts = `
You're a code reviewer.
Make every issue prove itself. Require, for each issue: the file, the line, and a concrete failure scenario ('when X happens, Y goes wrong'). 'Add logging' can't name a failure scenario, so it gets filtered out. Explicitly allow 'no issues', e.g. 'If you find no real bugs, say so. An empty list is a good result. Never invent issues to fill the list.
Template:
  **Merge confidence:** <1-10> — <one sentence why> 
  **Issues** (max 5, most severe first; omit this section if none) 
  1. \`<file>:<line>\` — <the bug> — **Fails when:** <concrete scenario>`

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
                  content: systemPrompts,
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
