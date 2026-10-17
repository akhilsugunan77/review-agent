import { Effect, Redacted, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { Github } from "./Github.ts"
import { Reviewer } from "./Reviewer.ts"
import { verifySignature } from "./verifySignature.ts"
import { formatReviewBody, placeComments, reviewableFiles, toDiff } from "./reviewableFiles.ts"

export const PullRequestEventSchema = Schema.Struct({
  action: Schema.String,
  number: Schema.Finite,
  pull_request: Schema.Struct({
    title: Schema.String,
    head: Schema.Struct({ sha: Schema.String }),
  }),
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
      const files = reviewableFiles(
        yield* github.getPullRequestDiff(event.repository.full_name, event.number),
      )
      const reviewer = yield* Reviewer
      const review = yield* reviewer.review(toDiff(files))
      const { inline, unplaced } = placeComments(files, review.comments)
      const reviewBody = formatReviewBody(review, unplaced)
      yield* github.createReview(event.repository.full_name, event.number, {
        commitId: event.pull_request.head.sha,
        body: reviewBody,
        comments: inline,
      })
      return HttpServerResponse.text(reviewBody, { status: 200 })
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
      GithubError: (error) =>
        Effect.logError("Github request failed", error.cause).pipe(
          Effect.as(HttpServerResponse.text("Github error", { status: 502 })),
        ),
      ReviewerError: (error) =>
        Effect.logError("Reviewer request failed", error.cause).pipe(
          Effect.as(HttpServerResponse.text("Reviewer error", { status: 502 })),
        ),
    }),
  )
