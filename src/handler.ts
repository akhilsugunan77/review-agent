import { Effect, Redacted, Schedule, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { ReviewQueue } from "./ReviewQueue.ts"
import { verifySignature } from "./verifySignature.ts"

export const PullRequestEventSchema = Schema.Struct({
  action: Schema.String,
  number: Schema.Finite,
  pull_request: Schema.Struct({
    title: Schema.String,
    body: Schema.NullOr(Schema.String),
    head: Schema.Struct({ sha: Schema.String }),
    base: Schema.Struct({ sha: Schema.String }),
  }),
  repository: Schema.Struct({ full_name: Schema.String }),
})

// GitHub gives up on a webhook after 10s, so the review itself runs from the queue
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
      const reviewQueue = yield* ReviewQueue
      yield* reviewQueue.enqueue({
        repo: event.repository.full_name,
        number: event.number,
        headSha: event.pull_request.head.sha,
        baseSha: event.pull_request.base.sha,
        title: event.pull_request.title,
        body: event.pull_request.body,
      }).pipe(
        // The queue's send occasionally times out; try a couple more times before giving up with a 503
        Effect.retry({ schedule: Schedule.exponential("200 millis"), times: 2 }),
      )
      return HttpServerResponse.text("Review queued", { status: 202 })
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
      // A failed delivery shows in GitHub's webhook settings, where it can be redelivered
      ReviewQueueError: (error) =>
        Effect.logError("Enqueue failed", error.cause).pipe(
          Effect.as(HttpServerResponse.text("Queue error", { status: 503 })),
        ),
    }),
  )
