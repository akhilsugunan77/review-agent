import { Effect, Redacted, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { Github } from "./Github.ts"
import { Reviewer } from "./Reviewer.ts"
import { verifySignature } from "./verifySignature.ts"

export const PullRequestEventSchema = Schema.Struct({
  action: Schema.String,
  number: Schema.Finite,
  pull_request: Schema.Struct({ title: Schema.String }),
  repository: Schema.Struct({ full_name: Schema.String }),
})

export const makeHandler = (webhookSecret: Redacted.Redacted) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const { url, method } = request
    if (url === "/webhook" && method === "POST") {
      const body = yield* request.text
      const signature = request.headers["x-hub-signature-256"]
      yield* verifySignature(webhookSecret, body, signature)
      const event = yield* Schema.decodeEffect(Schema.fromJsonString(PullRequestEventSchema))(body)
      const github = yield* Github
      const diff = yield* github.getPullRequestDiff(event.repository.full_name, event.number)
      const reviewer = yield* Reviewer
      const review = yield* reviewer.review(diff)
      return HttpServerResponse.text(review)
    }
    return HttpServerResponse.text("Not found", { status: 404 })
  }).pipe(
    Effect.catchTags({
      HttpServerError: () =>
        Effect.succeed(HttpServerResponse.text("Invalid JSON", { status: 400 })),
      SchemaError: (error) =>
        Effect.succeed(HttpServerResponse.text(error.message, { status: 400 })),
      InvalidSignature: (error) =>
        Effect.succeed(HttpServerResponse.text(error.reason, { status: 401 })),
      GithubError: (_error) =>
        Effect.succeed(HttpServerResponse.text("Github error", { status: 502 })),
      ReviewerError: (_error) =>
        Effect.succeed(HttpServerResponse.text("Reviewer error", { status: 502 })),
    }),
  )
