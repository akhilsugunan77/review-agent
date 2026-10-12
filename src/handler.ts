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
      const githubEvent = request.headers["x-github-event"]
      if (githubEvent === "ping") {
        return HttpServerResponse.text("PONG", { status: 200 })
      }
      if (githubEvent !== "pull_request") {
        return HttpServerResponse.text(`ignored event: ${githubEvent}`, { status: 200 })
      }
      const event = yield* Schema.decodeEffect(Schema.fromJsonString(PullRequestEventSchema))(body)
      if (!["synchronize", "opened"].includes(event.action)) {
        return HttpServerResponse.text(`ignored action: ${event.action}`, { status: 200 })
      }
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
