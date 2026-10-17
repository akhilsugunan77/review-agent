import { Config, Context, Effect, Layer, Schema } from "effect"
import { FetchHttpClient, HttpBody, HttpClient, HttpClientRequest } from "effect/http"

export class ReviewerError extends Schema.TaggedError<ReviewerError>()("ReviewerError", {
  cause: Schema.Defect(),
}) {}

export const ReviewComment = Schema.Struct({
  path: Schema.String,
  line: Schema.Int,
  body: Schema.String,
})

export type ReviewComment = typeof ReviewComment.Type

export const Review = Schema.Struct({
  confidence: Schema.Int,
  summary: Schema.String,
  comments: Schema.Array(ReviewComment),
})

export type Review = typeof Review.Type

// JSON mode may hand back the object itself or a JSON string, so accept both
const WorkersAiResponse = Schema.Struct({
  result: Schema.Struct({ response: Schema.Union([Review, Schema.fromJsonString(Review)]) }),
})

// Only these Workers AI models support JSON mode (response_format)
const MODEL = "@cf/meta/llama-3.1-8b-instruct"

const systemPrompts = `
You're a code reviewer. You get a diff where each file starts with "--- <path>" and every line that exists in the new file is prefixed with its line number.
Make every issue prove itself. Each comment needs a concrete failure scenario ("when X happens, Y goes wrong"). "Add logging" can't name a failure scenario, so leave it out.
If you find no real bugs, return an empty comments list. That's a good result. Never invent issues to fill the list.
Respond with JSON:
- confidence: 1-10, how safely this can merge without a production issue
- summary: one sentence explaining the confidence
- comments: at most 5, most severe first. Each has path (exactly as written after "---"), line (a line number shown in the diff, on a "+" line when possible) and body ("<the bug>. **Fails when:** <concrete scenario>")`

export class Reviewer extends Context.Service<
  Reviewer,
  {
    review: (diff: string) => Effect.Effect<Review, ReviewerError>
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
      const jsonSchema = Schema.toJsonSchemaDocument(Review).schema

      const review = Effect.fn("review")(
        function* (diff: string) {
          const response = yield* client.post(`/${MODEL}`, {
            body: HttpBody.jsonUnsafe({
              messages: [
                {
                  role: "system",
                  content: systemPrompts,
                },
                { role: "user", content: diff },
              ],
              response_format: { type: "json_schema", json_schema: jsonSchema },
              max_tokens: 1024,
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

  static readonly mockWith = (comments: ReadonlyArray<ReviewComment>) =>
    Layer.succeed(
      Reviewer,
      Reviewer.of({
        review: (diff) =>
          Effect.succeed({
            confidence: 8,
            summary: `Fake review: this diff has ${diff.split("\n").length} lines look good`,
            comments,
          }),
      }),
    )

  static readonly mock = Reviewer.mockWith([])
}
